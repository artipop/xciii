// Целевая схема XCIII, одним файлом. Не применена и источником правды не
// является: это то, к чему ведёт docs/store-plan.md, а не то, что лежит в базе
// сегодня (сегодняшнее — docs/db-erd.md).
//
// Схему, которая правда применяется, держит tools/schemagen — как Go-данные с
// абстрактными типами, откуда ariga.io/atlas рендерит миграцию для всех трёх
// диалектов. Так, а не отсюда, потому что HCL у Atlas диалектно-зависим: `blob`
// против `uuid` пришлось бы написать трижды, то есть ровно те различия руками,
// ради ухода от которых генератор и заведён.
//
// Что здесь уже правда (миграция 000041_app_tables): наши таблицы в этой базе,
// внешние ключи на blocks и boards написаны, terminal_session стал
// conversation, `key` стал `token`, `at` — `changed_at`, автоинкрементов не
// осталось, а отсутствие у ключевых колонок — NULL.
//
// Что здесь ещё не правда и ждёт шага 0: id — VARCHAR(36), как у доски, а не
// UUIDv7 в шестнадцати байтах; время — BIGINT с unix-мс, а не timestamp;
// CHECK'ов нет; `workdir_claim` ключуется путём и владельцем одной колонкой;
// реестров (workdir, agent, proxy, deploy_target) в базе ещё нет — они в
// config.json, и это шаг 2.
//
// Диалект здесь SQLite: это то, на чём работает приложение. Что меняется в двух
// других — в конце файла, одной таблицей соответствий; сами по себе они
// отличаются только типами.
//
// Три решения, по которым читается всё остальное:
//
//   id     — UUIDv7, шестнадцать байт. Выдаёт клиент (страница создаёт карточку
//            с готовым id), поэтому автоинкремента нет нигде; упорядоченность
//            v7 по времени заменяет его и там, где нужен порядок в журнале.
//   время  — настоящий timestamp, а не unix-мс в BIGINT. Провод остаётся
//            числовым, конвертация на границе стора.
//   ссылка — внешний ключ. Всё, на что можно сослаться, лежит здесь.
//
// Имена бордовых таблиц оставлены как есть (множественное число): переименование
// стоит правки каждого запроса форка и не покупает ничего. Наши — единственное
// число, как и были. Одно исключение: terminal_session → conversation, потому
// что переименовалось само понятие.

schema "main" {}

// ─────────────────────────────────────────────────────────────────────────────
// Доска
// ─────────────────────────────────────────────────────────────────────────────

table "boards" {
  schema = schema.main
  column "id" { null = false, type = blob }
  column "created_by" { null = true, type = blob }
  column "modified_by" { null = true, type = blob }

  // O — открытая, P — приватная.
  column "type" { null = false, type = varchar(1) }
  column "title" { null = false, type = text }
  column "description" { null = true, type = text }
  column "icon" { null = true, type = varchar(256) }
  column "show_description" { null = false, type = boolean, default = false }
  column "is_template" { null = false, type = boolean, default = false }
  column "template_version" { null = false, type = integer, default = 0 }

  // Автоматика доски: xciiiColumns, xciiiFlows, xciiiPrompt, xciiiSetup и
  // записи «какое поле чем является» (xciiiColumnProperty, xciiiProjectProperty,
  // xciiiBranchProperty). Остаётся JSON намеренно: едет вместе с доской в
  // экспорт и в шаблон.
  column "properties" { null = true, type = json }

  // Схема полей карточки. Тоже JSON и тоже намеренно — разложить её по строкам
  // означает переписать webapp, см. store-plan.md.
  column "card_properties" { null = true, type = json }

  column "minimum_role" { null = false, type = varchar(36), default = "" }
  column "created_at" { null = false, type = datetime }
  column "updated_at" { null = false, type = datetime }

  // Мягкое удаление доски: карточки при этом остаются, доска прячется.
  column "deleted_at" { null = true, type = datetime }

  primary_key { columns = [column.id] }
  foreign_key "boards_created_by" {
    columns     = [column.created_by]
    ref_columns = [table.users.column.id]
    on_delete   = SET_NULL
  }
  index "idx_boards_is_template" { columns = [column.is_template] }
  check "boards_type" { expr = "type IN ('O','P')" }
}

table "blocks" {
  schema = schema.main
  column "id" { null = false, type = blob }
  column "board_id" { null = false, type = blob }

  // Дерево внутри доски: текст и комментарий висят на карточке. Вложенность
  // карточки в карточку сюда вешать нельзя — это другое отношение, ему нужна
  // своя колонка (store-plan.md, «Направление»).
  column "parent_id" { null = true, type = blob }

  column "type" { null = false, type = varchar(32) }
  column "title" { null = true, type = text }

  // Значения полей карточки: {property_id: value}. Главная ненормализованность
  // продукта и осознанно оставленная — см. store-plan.md.
  column "fields" { null = true, type = json }

  column "created_by" { null = true, type = blob }
  column "modified_by" { null = true, type = blob }
  column "created_at" { null = false, type = datetime }
  column "updated_at" { null = false, type = datetime }
  column "deleted_at" { null = true, type = datetime }

  primary_key { columns = [column.id] }
  foreign_key "blocks_board" {
    columns     = [column.board_id]
    ref_columns = [table.boards.column.id]
    on_delete   = CASCADE
  }
  foreign_key "blocks_parent" {
    columns     = [column.parent_id]
    ref_columns = [table.blocks.column.id]
    on_delete   = CASCADE
  }
  index "idx_blocks_board_parent" { columns = [column.board_id, column.parent_id] }
  check "blocks_type" {
    expr = "type IN ('board','card','view','text','comment','image','attachment','divider','checkbox','h1','h2','h3','list-item','quote','video','unknown')"
  }
}

table "users" {
  schema = schema.main
  column "id" { null = false, type = blob }

  // Имя, под которым человек, агент или источник виден на доске. Уникально:
  // AgentUsername уже опирается на это, только раньше без гарантии.
  column "username" { null = false, type = varchar(100) }
  column "email" { null = true, type = varchar(255) }

  // Что это за учётка. Раньше различалось только по тому, кто её завёл.
  column "kind" { null = false, type = varchar(16), default = "person" }

  column "props" { null = true, type = json }
  column "created_at" { null = false, type = datetime }
  column "updated_at" { null = false, type = datetime }
  column "deleted_at" { null = true, type = datetime }

  primary_key { columns = [column.id] }
  index "idx_users_username" { columns = [column.username], unique = true }
  check "users_kind" { expr = "kind IN ('person','agent','source')" }
}

table "board_members" {
  schema = schema.main
  column "board_id" { null = false, type = blob }
  column "user_id" { null = false, type = blob }
  column "scheme_admin" { null = false, type = boolean, default = false }
  column "scheme_editor" { null = false, type = boolean, default = false }
  column "scheme_commenter" { null = false, type = boolean, default = false }
  column "scheme_viewer" { null = false, type = boolean, default = false }

  primary_key { columns = [column.board_id, column.user_id] }
  foreign_key "board_members_board" {
    columns     = [column.board_id]
    ref_columns = [table.boards.column.id]
    on_delete   = CASCADE
  }
  foreign_key "board_members_user" {
    columns     = [column.user_id]
    ref_columns = [table.users.column.id]
    on_delete   = CASCADE
  }
  index "idx_board_members_user" { columns = [column.user_id] }
}

table "sessions" {
  schema = schema.main
  column "id" { null = false, type = blob }
  column "token" { null = false, type = varchar(100) }
  column "user_id" { null = false, type = blob }
  column "props" { null = true, type = json }
  column "created_at" { null = false, type = datetime }
  column "updated_at" { null = false, type = datetime }

  primary_key { columns = [column.id] }
  foreign_key "sessions_user" {
    columns     = [column.user_id]
    ref_columns = [table.users.column.id]
    on_delete   = CASCADE
  }
  index "idx_sessions_token" { columns = [column.token], unique = true }
}

// Группы досок в сайдбаре.
table "categories" {
  schema = schema.main
  column "id" { null = false, type = blob }
  column "user_id" { null = false, type = blob }
  column "name" { null = false, type = varchar(100) }
  column "type" { null = true, type = varchar(64) }
  column "collapsed" { null = false, type = boolean, default = false }
  column "sort_order" { null = false, type = integer, default = 0 }
  column "created_at" { null = false, type = datetime }
  column "updated_at" { null = false, type = datetime }
  column "deleted_at" { null = true, type = datetime }

  primary_key { columns = [column.id] }
  foreign_key "categories_user" {
    columns     = [column.user_id]
    ref_columns = [table.users.column.id]
    on_delete   = CASCADE
  }
  index "idx_categories_user" { columns = [column.user_id] }
}

table "category_boards" {
  schema = schema.main
  column "category_id" { null = false, type = blob }
  column "board_id" { null = false, type = blob }
  column "sort_order" { null = false, type = integer, default = 0 }
  column "hidden" { null = false, type = boolean, default = false }

  // Было (id PK + UNIQUE(user_id, board_id)) — суррогат, которым никто не
  // пользовался: строка и есть пара.
  primary_key { columns = [column.category_id, column.board_id] }
  foreign_key "category_boards_category" {
    columns     = [column.category_id]
    ref_columns = [table.categories.column.id]
    on_delete   = CASCADE
  }
  foreign_key "category_boards_board" {
    columns     = [column.board_id]
    ref_columns = [table.boards.column.id]
    on_delete   = CASCADE
  }
}

// Публичная ссылка на доску. id = id доски, поэтому это связь один-к-одному.
table "sharing" {
  schema = schema.main
  column "board_id" { null = false, type = blob }
  column "enabled" { null = false, type = boolean, default = false }
  column "token" { null = false, type = varchar(100) }
  column "modified_by" { null = true, type = blob }
  column "updated_at" { null = false, type = datetime }

  primary_key { columns = [column.board_id] }
  foreign_key "sharing_board" {
    columns     = [column.board_id]
    ref_columns = [table.boards.column.id]
    on_delete   = CASCADE
  }
}

table "file_info" {
  schema = schema.main
  column "id" { null = false, type = blob }

  // Вложение принадлежит доске: удалили доску — файлы её карточек не нужны.
  column "board_id" { null = false, type = blob }
  column "name" { null = false, type = text }
  column "extension" { null = false, type = varchar(50) }
  column "size" { null = false, type = integer }
  column "path" { null = false, type = varchar(512) }
  column "archived" { null = false, type = boolean, default = false }
  column "created_at" { null = false, type = datetime }
  column "deleted_at" { null = true, type = datetime }

  primary_key { columns = [column.id] }
  foreign_key "file_info_board" {
    columns     = [column.board_id]
    ref_columns = [table.boards.column.id]
    on_delete   = CASCADE
  }
}

table "preferences" {
  schema = schema.main
  column "user_id" { null = false, type = blob }
  column "category" { null = false, type = varchar(32) }
  column "name" { null = false, type = varchar(32) }
  column "value" { null = true, type = text }

  primary_key { columns = [column.user_id, column.category, column.name] }
  foreign_key "preferences_user" {
    columns     = [column.user_id]
    ref_columns = [table.users.column.id]
    on_delete   = CASCADE
  }
}

table "system_settings" {
  schema = schema.main
  column "id" { null = false, type = varchar(100) }
  column "value" { null = true, type = text }
  primary_key { columns = [column.id] }
}

// ─────────────────────────────────────────────────────────────────────────────
// Реестры машины: были массивами в config.json
// ─────────────────────────────────────────────────────────────────────────────

// Место, где работает агент. Не обязано быть каталогом на диске: id для того и
// заведён, чтобы завтра это был репозиторий, который надо склонировать, или
// диск, или машина по ssh.
table "workdir" {
  schema = schema.main
  column "id" { null = false, type = blob }

  // Подпись, а не ключ: её можно менять, карточки ссылаются на id.
  column "name" { null = false, type = varchar(200) }
  column "path" { null = true, type = text }

  // Что человеку было обещано при добавлении: git — доска требовала
  // репозиторий, и папка без git будет отвергнута.
  column "kind" { null = false, type = varchar(16), default = "plain" }

  column "base_branch" { null = true, type = varchar(200) }
  column "branch_prefix" { null = true, type = varchar(64) }

  // Папка «на всех досках»: одна запись, видная нескольким доскам.
  column "global" { null = false, type = boolean, default = false }
  column "created_at" { null = false, type = datetime }

  primary_key { columns = [column.id] }
  index "idx_workdir_name" { columns = [column.name], unique = true }
  index "idx_workdir_path" { columns = [column.path], unique = true }
  check "workdir_kind" { expr = "kind IN ('plain','git')" }
}

// Какая папка предлагается какой доске и как в ней работать. Ключ по паре, а не
// по папке: папка «на всех досках» — одна запись, а ответ у каждой доски свой.
table "workdir_board" {
  schema = schema.main
  column "workdir_id" { null = false, type = blob }
  column "board_id" { null = false, type = blob }
  column "mode" { null = true, type = varchar(16) }

  primary_key { columns = [column.workdir_id, column.board_id] }
  foreign_key "workdir_board_workdir" {
    columns     = [column.workdir_id]
    ref_columns = [table.workdir.column.id]
    on_delete   = CASCADE
  }
  foreign_key "workdir_board_board" {
    columns     = [column.board_id]
    ref_columns = [table.boards.column.id]
    on_delete   = CASCADE
  }
  check "workdir_board_mode" { expr = "mode IS NULL OR mode IN ('worktree','branch')" }
}

table "proxy" {
  schema = schema.main
  column "id" { null = false, type = blob }
  column "name" { null = false, type = varchar(100) }
  column "url" { null = true, type = text }
  column "no_proxy" { null = true, type = text }
  column "ca_cert" { null = true, type = text }
  column "username" { null = true, type = varchar(100) }

  primary_key { columns = [column.id] }
  index "idx_proxy_name" { columns = [column.name], unique = true }
}

// Зарегистрированный агент. Учётка на доске — отдельная строка в users, и
// связаны они ключом, а не совпадением имени.
table "agent" {
  schema = schema.main
  column "id" { null = false, type = blob }
  column "name" { null = false, type = varchar(100) }
  column "kind" { null = false, type = varchar(32) }
  column "user_id" { null = true, type = blob }
  column "proxy_id" { null = true, type = blob }
  column "bin_path" { null = true, type = text }
  column "model" { null = true, type = varchar(100) }
  column "prompt" { null = true, type = text }

  // env, args, cliArgs, terminalCommand, mcpServers, autoAllowTools — настройки
  // процесса. JSON намеренно: ни на что не ссылаются и ни к чему не
  // присоединяются, это конфигурация запуска.
  column "settings" { null = true, type = json }

  primary_key { columns = [column.id] }
  foreign_key "agent_user" {
    columns     = [column.user_id]
    ref_columns = [table.users.column.id]
    on_delete   = SET_NULL
  }
  foreign_key "agent_proxy" {
    columns     = [column.proxy_id]
    ref_columns = [table.proxy.column.id]
    on_delete   = SET_NULL
  }
  index "idx_agent_name" { columns = [column.name], unique = true }
  check "agent_kind" { expr = "kind IN ('claude','codex','antigravity','copilot','junie','acp')" }
}

table "deploy_target" {
  schema = schema.main
  column "id" { null = false, type = blob }
  column "name" { null = false, type = varchar(100) }
  column "host" { null = false, type = varchar(255) }
  column "ssh_user" { null = true, type = varchar(64) }
  column "domain" { null = true, type = varchar(255) }
  column "settings" { null = true, type = json }

  primary_key { columns = [column.id] }
  index "idx_deploy_target_name" { columns = [column.name], unique = true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Работа
// ─────────────────────────────────────────────────────────────────────────────

// Рабочее место: копия и ветка, взятые под владельца. Владелец — карточка или
// доска (черновики), поэтому две колонки, из которых заполнена одна.
table "workdir_claim" {
  schema = schema.main
  column "workdir_id" { null = false, type = blob }
  column "card_id" { null = true, type = blob }
  column "board_id" { null = true, type = blob }
  column "mode" { null = false, type = varchar(16) }

  // NULL, а не пустая строка: у обычной папки ветки нет.
  column "branch" { null = true, type = varchar(255) }
  column "path" { null = true, type = text }
  column "base" { null = true, type = varchar(255) }
  column "created_at" { null = false, type = datetime }

  // NULL — рабочее место живое.
  column "released_at" { null = true, type = datetime }

  primary_key { columns = [column.workdir_id, column.card_id, column.board_id] }
  foreign_key "workdir_claim_workdir" {
    columns     = [column.workdir_id]
    ref_columns = [table.workdir.column.id]
    on_delete   = RESTRICT
  }
  foreign_key "workdir_claim_card" {
    columns     = [column.card_id]
    ref_columns = [table.blocks.column.id]
    on_delete   = CASCADE
  }
  foreign_key "workdir_claim_board" {
    columns     = [column.board_id]
    ref_columns = [table.boards.column.id]
    on_delete   = CASCADE
  }
  index "idx_workdir_claim_live" { columns = [column.workdir_id, column.released_at] }
  check "workdir_claim_owner" { expr = "(card_id IS NULL) <> (board_id IS NULL)" }
  check "workdir_claim_mode" { expr = "mode IN ('worktree','branch','plain')" }
}

// Разговор: CLI агента в pty. Было terminal_session.
table "conversation" {
  schema = schema.main
  column "id" { null = false, type = blob }

  // NULL — разговор планирования, у него карточки нет.
  column "card_id" { null = true, type = blob }
  column "board_id" { null = false, type = blob }

  // Род и место разом: option id колонки — работа; '@talk' — обсуждение
  // карточки; '@none' — работа над карточкой, у которой нет колонки.
  column "node_id" { null = false, type = varchar(64) }

  // Как называлась колонка в момент разговора: она могла быть переименована, а
  // строка в списке должна читаться так же.
  column "column_name" { null = true, type = varchar(200) }

  column "agent_id" { null = true, type = blob }
  column "workdir_id" { null = true, type = blob }

  // Имя разговора: его дал человек или сам агент через name_conversation.
  column "title" { null = true, type = text }

  // Одна строка агента о том, чем разговор занят (describe_conversation).
  column "summary" { null = true, type = text }

  column "cwd" { null = true, type = text }
  column "branch" { null = true, type = varchar(255) }
  column "started_at" { null = false, type = datetime }
  column "ended_at" { null = true, type = datetime }
  column "exit_code" { null = true, type = integer }

  primary_key { columns = [column.id] }
  foreign_key "conversation_card" {
    columns     = [column.card_id]
    ref_columns = [table.blocks.column.id]
    on_delete   = CASCADE
  }
  foreign_key "conversation_board" {
    columns     = [column.board_id]
    ref_columns = [table.boards.column.id]
    on_delete   = CASCADE
  }
  // Разговор переживает того, кто его вёл: он состоялся.
  foreign_key "conversation_agent" {
    columns     = [column.agent_id]
    ref_columns = [table.agent.column.id]
    on_delete   = SET_NULL
  }
  foreign_key "conversation_workdir" {
    columns     = [column.workdir_id]
    ref_columns = [table.workdir.column.id]
    on_delete   = SET_NULL
  }
  index "idx_conversation_card_node" { columns = [column.card_id, column.node_id, column.started_at] }
}

// Сессия по протоколу: деплой и тест. Агентские стадии — это conversation.
table "agent_session" {
  schema = schema.main
  column "id" { null = false, type = blob }
  column "card_id" { null = false, type = blob }
  column "board_id" { null = false, type = blob }
  column "agent_id" { null = true, type = blob }
  column "node_id" { null = false, type = varchar(64) }
  column "status" { null = false, type = varchar(16) }
  column "acp_session_id" { null = true, type = varchar(100) }
  column "cwd" { null = true, type = text }
  column "branch" { null = true, type = varchar(255) }
  column "error_text" { null = true, type = text }
  column "started_at" { null = false, type = datetime }
  column "finished_at" { null = true, type = datetime }

  primary_key { columns = [column.id] }
  foreign_key "agent_session_card" {
    columns     = [column.card_id]
    ref_columns = [table.blocks.column.id]
    on_delete   = CASCADE
  }
  foreign_key "agent_session_agent" {
    columns     = [column.agent_id]
    ref_columns = [table.agent.column.id]
    on_delete   = SET_NULL
  }
  index "idx_agent_session_card" { columns = [column.card_id, column.started_at] }
  check "agent_session_status" {
    expr = "status IN ('queued','running','finished','failed','cancelled')"
  }
}

// Журнал сессии. Порядок держится на id: UUIDv7 упорядочен по времени, поэтому
// seq больше не нужен.
table "session_event" {
  schema = schema.main
  column "id" { null = false, type = blob }
  column "session_id" { null = false, type = blob }
  column "kind" { null = false, type = varchar(32) }
  column "payload" { null = true, type = json }
  column "created_at" { null = false, type = datetime }

  primary_key { columns = [column.id] }
  foreign_key "session_event_session" {
    columns     = [column.session_id]
    ref_columns = [table.agent_session.column.id]
    on_delete   = CASCADE
  }
  index "idx_session_event_session" { columns = [column.session_id, column.id] }
}

// Где карточка стоит на маршруте. Это индекс для сборщика событий: правда — на
// самой карточке, в её полях, и потому едет вместе с доской.
table "flow_state" {
  schema = schema.main
  column "card_id" { null = false, type = blob }
  column "board_id" { null = false, type = blob }
  column "flow_id" { null = false, type = varchar(64) }
  column "node_id" { null = false, type = varchar(64) }
  column "branch" { null = true, type = varchar(255) }
  column "workdir_id" { null = true, type = blob }
  column "entered_at" { null = false, type = datetime }

  primary_key { columns = [column.card_id] }
  foreign_key "flow_state_card" {
    columns     = [column.card_id]
    ref_columns = [table.blocks.column.id]
    on_delete   = CASCADE
  }
  foreign_key "flow_state_workdir" {
    columns     = [column.workdir_id]
    ref_columns = [table.workdir.column.id]
    on_delete   = SET_NULL
  }
  index "idx_flow_state_branch" { columns = [column.workdir_id, column.branch] }
}

table "flow_event" {
  schema = schema.main
  column "id" { null = false, type = blob }
  column "card_id" { null = false, type = blob }
  column "flow_id" { null = false, type = varchar(64) }
  column "from_node" { null = true, type = varchar(64) }
  column "to_node" { null = false, type = varchar(64) }
  column "on_kind" { null = false, type = varchar(32) }
  column "detail" { null = true, type = text }

  // Слова агента на переходе: из них собирается бриф, когда карточка вернётся.
  column "said" { null = true, type = text }
  column "created_at" { null = false, type = datetime }

  primary_key { columns = [column.id] }
  foreign_key "flow_event_card" {
    columns     = [column.card_id]
    ref_columns = [table.blocks.column.id]
    on_delete   = CASCADE
  }
  index "idx_flow_event_card" { columns = [column.card_id, column.id] }
}

// Почему карточка стоит. Одна текущая причина, а не журнал: причина верна
// только до тех пор, пока не исправили то, о чём она.
table "card_stall" {
  schema = schema.main
  column "card_id" { null = false, type = blob }
  column "node_id" { null = true, type = varchar(64) }

  // conversation — единственный род, у которого есть куда пойти: открыть
  // терминал. Остальным идти некуда, и кнопки у них нет.
  column "kind" { null = true, type = varchar(32) }
  column "reason" { null = false, type = text }
  column "created_at" { null = false, type = datetime }

  primary_key { columns = [column.card_id] }
  foreign_key "card_stall_card" {
    columns     = [column.card_id]
    ref_columns = [table.blocks.column.id]
    on_delete   = CASCADE
  }
}

// Карточка ждёт свободного места в колонке.
table "stage_queue" {
  schema = schema.main
  column "card_id" { null = false, type = blob }
  column "board_id" { null = false, type = blob }
  column "node_id" { null = false, type = varchar(64) }
  column "flow_id" { null = true, type = varchar(64) }
  column "queued_at" { null = false, type = datetime }

  primary_key { columns = [column.card_id] }
  foreign_key "stage_queue_card" {
    columns     = [column.card_id]
    ref_columns = [table.blocks.column.id]
    on_delete   = CASCADE
  }
  foreign_key "stage_queue_board" {
    columns     = [column.board_id]
    ref_columns = [table.boards.column.id]
    on_delete   = CASCADE
  }
  index "idx_stage_queue_node" { columns = [column.board_id, column.node_id, column.queued_at] }
}

// Что уже спросили у человека при настройке доски.
table "board_setup" {
  schema = schema.main
  column "board_id" { null = false, type = blob }
  column "step" { null = false, type = varchar(32) }
  column "status" { null = false, type = varchar(16) }

  // Было `at` — слово, которое стоит не заводить: в Postgres AT ключевое.
  column "changed_at" { null = false, type = datetime }

  primary_key { columns = [column.board_id, column.step] }
  foreign_key "board_setup_board" {
    columns     = [column.board_id]
    ref_columns = [table.boards.column.id]
    on_delete   = CASCADE
  }
}

// Защёлка наблюдателя за git: это событие по этой ветке уже отработано.
// Ключ по папке, а не по пути — путь в ключе MySQL и не даст.
table "vcs_seen" {
  schema = schema.main
  column "workdir_id" { null = false, type = blob }
  column "branch" { null = false, type = varchar(255) }
  column "kind" { null = false, type = varchar(32) }
  column "marker" { null = true, type = varchar(64) }
  column "created_at" { null = false, type = datetime }

  primary_key { columns = [column.workdir_id, column.branch, column.kind] }
  foreign_key "vcs_seen_workdir" {
    columns     = [column.workdir_id]
    ref_columns = [table.workdir.column.id]
    on_delete   = CASCADE
  }
}

// Защёлка движка: это событие маршрута уже обработано. Было `key` — слово,
// зарезервированное в MySQL.
table "idempotency" {
  schema = schema.main
  column "token" { null = false, type = varchar(255) }
  column "session_id" { null = true, type = blob }
  column "created_at" { null = false, type = datetime }

  primary_key { columns = [column.token] }
  index "idx_idempotency_created" { columns = [column.created_at] }
}

// ─────────────────────────────────────────────────────────────────────────────
// Входящие
// ─────────────────────────────────────────────────────────────────────────────

// Дедуп: повтор того же письма не заводит вторую карточку.
table "source_item" {
  schema = schema.main
  column "source" { null = false, type = varchar(100) }
  column "external_id" { null = false, type = varchar(255) }

  // updated/etag сервиса: изменилось — есть что дописать.
  column "version" { null = true, type = varchar(255) }

  column "card_id" { null = true, type = blob }
  column "created_at" { null = false, type = datetime }
  column "updated_at" { null = false, type = datetime }

  primary_key { columns = [column.source, column.external_id] }
  foreign_key "source_item_card" {
    columns     = [column.card_id]
    ref_columns = [table.blocks.column.id]
    on_delete   = SET_NULL
  }
  index "idx_source_item_card" { columns = [column.card_id] }
}

table "source_event" {
  schema = schema.main
  column "id" { null = false, type = blob }
  column "source" { null = false, type = varchar(100) }
  column "external_id" { null = true, type = varchar(255) }
  column "rule" { null = true, type = varchar(100) }
  column "outcome" { null = false, type = varchar(16) }
  column "card_id" { null = true, type = blob }
  column "detail" { null = true, type = text }
  column "created_at" { null = false, type = datetime }

  primary_key { columns = [column.id] }
  foreign_key "source_event_card" {
    columns     = [column.card_id]
    ref_columns = [table.blocks.column.id]
    on_delete   = SET_NULL
  }
  index "idx_source_event_source" { columns = [column.source, column.id] }
  check "source_event_outcome" {
    expr = "outcome IN ('created','commented','skipped','dropped')"
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Что здесь не появилось, и почему
// ─────────────────────────────────────────────────────────────────────────────
//
//   teams, team_id          — всегда '0'. Единственный аргумент против сноса:
//                             колонка есть в двух сотнях запросов форка.
//   channel_id, workspace_id — остатки Mattermost-плагина.
//   root_id у blocks        — всегда равен board_id.
//   password, mfa_secret,
//   auth_data, auth_service — учётки заводит приложение, паролей нет.
//   insert_at               — половина механизма history-таблиц (ниже).
//   blocks_history,
//   boards_history,
//   board_members_history   — апстримный аудит: строка дублируется на каждой
//                             правке и не чистится никогда. Undo в продукте
//                             клиентский (webapp/src/undomanager.ts), экрана
//                             истории нет. Убраны, но это решение стоит принять
//                             отдельно, а не заодно.
//   schema_migrations       — заводит сам инструмент миграций.
//
// ─────────────────────────────────────────────────────────────────────────────
// Типы по диалектам
// ─────────────────────────────────────────────────────────────────────────────
//
//   здесь (SQLite)   Postgres        MySQL
//   ──────────────────────────────────────────────────
//   blob (16 байт)   uuid            binary(16)
//   datetime         timestamptz     datetime(6)
//   json             jsonb           json
//   text             text            text / longtext
//   varchar(n)       varchar(n)      varchar(n)
//   boolean          boolean         tinyint(1)
//   integer          bigint          bigint
//
// Больше ничего не расходится: время в UTC, id — байты, перечисления —
// CHECK (в MySQL работает с 8.0.16).
