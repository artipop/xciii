# ERD: три базы и файл настроек

Снято со схем 2026-08-16 (`server/services/store/sqlstore/migrations/` для
бордовой, `internal/acp/store.go` и `internal/sources/store.go` для двух
наших). Обзор словами — в
`docs/db-schema-review.md`; здесь картинка.

Ни в одной из баз нет физических FOREIGN KEY — бордовая унаследовала от
Focalboard стиль soft-delete с history-таблицами, а `card_id`/`board_id` в
наших базах указывают в **другой файл**, куда FK физически невозможен. Все
линии ниже — логические связи, которые держит код.

## Как базы смотрят друг на друга

```mermaid
erDiagram
    XCIII_DB ||..o{ ACP_DB : "card_id / board_id"
    XCIII_DB ||..o{ SOURCES_DB : "card_id"
    CONFIG_JSON ||..o{ XCIII_DB : "id папки = id опции поля «Папка»"
    CONFIG_JSON ||..o{ ACP_DB : "путь папки = workdir_claim.workdir"
    XCIII_DB {
        file xciii_db "server/ — доска: boards, blocks, users"
    }
    ACP_DB {
        file acp_db "acp/ — агенты: сессии, терминалы, маршруты, рабочие места"
    }
    SOURCES_DB {
        file sources_db "sources/ — входящие: дедуп и журнал"
    }
    CONFIG_JSON {
        file config_json "acp/config.json — реестры машины: папки, агенты, деплой-цели"
    }
```

**Четвёртое хранилище — не база, а файл**, и связей у него две. Реестр папок
(`config.json`, ключ `projects`) держит `id` каждой записи, и **под этим же id
доска заводит опцию поля «Папка»** — то есть карточка называет папку значением
обычного select'а, которое оказывается ссылкой в реестр машины. Вторая связь
идёт по пути: `workdir_claim.workdir` — это `path` записи реестра.

Карточка — это `blocks.id` (type=card) в бордовой базе; наши базы помнят её по
id и переживают её переезд между досками (`MoveCardToBoard` сохраняет id).
Агент и источник существуют в бордовой базе как строки `users` — под своими
именами, без отдельной таблицы.

## xciii.db — доска (форк Focalboard)

Сердце — две таблицы: `boards` (доска, её свойства и схема карточных полей как
JSON) и `blocks` (всё содержимое: карточки, виды, комментарии, вложения —
дерево через `parent_id`). Наша автоматика живёт в `boards.properties`
(`xciiiColumns`, `xciiiFlows`, `xciiiPrompt`, `xciiiBranchProperty`, …) и в
`blocks.fields` карточки — отдельных таблиц у неё нет.

```mermaid
erDiagram
    boards ||--o{ blocks : "board_id"
    blocks |o--o{ blocks : "parent_id (дерево)"
    boards ||--o{ board_members : "board_id"
    users ||--o{ board_members : "user_id"
    users ||--o{ sessions : "user_id"
    users ||--o{ categories : "user_id"
    users ||--o{ preferences : "userid"
    categories ||--o{ category_boards : "category_id"
    boards ||--o{ category_boards : "board_id"
    boards |o--|| sharing : "id (публичная ссылка)"
    blocks ||--o{ subscriptions : "block_id"
    blocks ||--o{ notification_hints : "block_id"
    blocks ||--o{ file_info : "вложение (id в fields)"

    boards {
        varchar id PK
        varchar team_id "всегда '0': single-user"
        varchar created_by FK "users.id"
        varchar type "O/P — open/private"
        text title
        text properties "JSON: xciiiColumns, xciiiFlows, xciiiPrompt, ..."
        text card_properties "JSON: схема полей карточек"
        bool is_template
        bigint create_at "unix ms; и update/delete_at"
    }
    blocks {
        varchar id PK
        varchar board_id FK "boards.id"
        varchar parent_id FK "blocks.id: карточка -> текст/комментарий"
        text type "card | view | text | comment | attachment | ..."
        text title
        text fields "JSON: properties карточки, фильтры вида, ..."
        varchar created_by FK "users.id"
        bigint create_at "unix ms; и update/delete_at"
    }
    users {
        varchar id PK
        varchar username "агенты и источники — тоже строки здесь"
        varchar email
        text props
    }
    board_members {
        varchar board_id PK
        varchar user_id PK
        bool scheme_admin "и editor/commenter/viewer"
    }
    sessions {
        varchar id PK
        varchar token "то, что раздаёт proxy.go"
        varchar user_id FK
    }
    categories {
        varchar id PK
        varchar name "группа досок в сайдбаре"
        varchar user_id FK
    }
    category_boards {
        varchar id PK
        varchar category_id FK
        varchar board_id FK
        int sort_order
    }
    sharing {
        varchar id PK "= board id"
        bool enabled
        varchar token
    }
    subscriptions {
        varchar block_id PK
        varchar subscriber_id PK
        bigint notified_at
    }
    notification_hints {
        varchar block_id PK
        bigint notify_at
    }
    file_info {
        varchar id PK "см. review: до 000041 был без индекса"
        text name
        bigint size
        text path
    }
    preferences {
        varchar userid PK
        varchar category PK
        varchar name PK
        text value
    }
    teams {
        varchar id PK "рудимент апстрима"
    }
    system_settings {
        varchar id PK
        text value
    }
```

Не нарисованы три **history-таблицы** — `blocks_history`, `boards_history`,
`board_members_history`: та же форма плюс `insert_at` в первичном ключе, каждая
правка дописывает строку. Это апстримный механизм undo/аудита, связей своих у
них нет.

## acp.db — агенты (`internal/acp/store.go`)

Всё крутится вокруг карточки (`card_id` — сквозная логическая ось) и ноды —
option id колонки, на которой карточка стоит: разговор, позиция на маршруте и
очередь колонки ключуются ими.

```mermaid
erDiagram
    agent_session ||--o{ session_event : "session_id"
    CARD ||..o{ agent_session : "card_id"
    CARD ||..o{ terminal_session : "card_id + node_id"
    CARD ||..o| flow_state : "card_id (позиция на маршруте)"
    CARD ||..o{ flow_event : "card_id (журнал переходов)"
    CARD ||..o| card_stall : "card_id (почему стоит)"
    CARD ||..o| stage_queue : "card_id (ждёт места в колонке)"
    CARD ||..o{ workdir_claim : "owner = card_id"

    agent_session {
        text id PK
        text card_id "blocks.id в xciii.db"
        text board_id
        text agent_kind
        text status "queued/running/done/failed/cancelled"
        text cwd "и worktree_path, branch"
        int started_at "unix ms; finished_at NULL = живая"
        text error_text
    }
    session_event {
        int id PK "autoincrement"
        text session_id FK
        int seq "порядок внутри сессии"
        text kind
        text payload_json
    }
    terminal_session {
        text id PK
        text card_id "пусто у планирования"
        text node_id "род разговора: option id колонки — работа; @none — работа над карточкой без колонки; @talk — «Обсуждение», разговор о карточке"
        text column_name "имя колонки, заморожено на момент разговора"
        text board_id
        text title "имя разговора: человек или name_conversation"
        text summary "строка от describe_conversation"
        text repo_path "папка (Go: WorkdirPath)"
        text cwd "и branch"
        text agent "и kind"
        int started_at "ended_at NULL = живой; exit_code"
    }
    flow_state {
        text card_id PK
        text flow "имя маршрута"
        text node_id "текущая нода"
        text branch "какую ветку опрашивает VCS"
        text repo_path
        int entered_at
    }
    flow_event {
        int id PK
        text card_id
        text from_node "и to_node"
        text on_kind "success/failure/branch.merged/..."
        text detail
        text said "слова агента на переходе — бриф возврата"
    }
    card_stall {
        text card_id PK
        text node_id "стадия, к которой причина относится"
        text kind "conversation — единственная, у которой есть куда пойти"
        text reason "одна текущая причина, не журнал"
    }
    stage_queue {
        text card_id PK
        text board_id
        text column_key "board|option — очередь колонки"
        text flow "и node_id"
        int queued_at
    }
    workdir_claim {
        text workdir PK "папка"
        text owner PK "card_id или board:<id>"
        text mode "worktree | branch | plain"
        text branch "ветка карточки"
        text path "где копия"
        text base "от чего отрезана — FROM main на штампе"
        int created_at "released_at NULL = живое рабочее место"
    }
    idempotency {
        text key PK "flow|card|node|событие"
        text session_id
        int created_at "окно дедупликации"
    }
    vcs_seen {
        text project PK "и branch, kind в PK"
        text marker "base:branch tip — событие уже отработано"
    }
    board_setup {
        text board_id PK "и step в PK"
        text status "шаги мастера настройки"
    }
```

`idempotency`, `vcs_seen` и `board_setup` стоят отдельно — это защёлки («это
событие уже обработано», «этот шаг уже пройден»), а не сущности со связями.
`PRAGMA user_version = 1` проштампован под будущую лестницу ALTER'ов.

## sources.db — входящие (`internal/sources/store.go`)

Две таблицы: дедуп и журнал. Сам реестр источников — не здесь, а в
`config.json`.

```mermaid
erDiagram
    source_item ||..o{ source_event : "source + external_id (логически)"
    CARD ||..o| source_item : "card_id — что из этого вышло"

    source_item {
        text source PK "имя источника"
        text external_id PK "id записи в самом сервисе"
        text version "updated/etag — повтор не создаёт карточку"
        text card_id "blocks.id в xciii.db"
        int created_at "и updated_at"
    }
    source_event {
        int id PK
        text source
        text external_id
        text rule "какое правило сработало"
        text outcome "created/commented/skipped/dropped"
        text card_id
        text detail
    }
```

## Что здесь видно про устройство

- **Домены разнесены по файлам, а не по схемам.** Бордовая база не знает про
  агентов, агентская — про источники; общий язык — id карточки и id доски.
  Как эти id складываются в одну картину — `docs/model-graph.md`.
- **Ссылки между хранилищами идут по id, а не по именам.** Карточка называет
  папку id записи реестра, доска записывает, какое её поле — папка и какое —
  ветка (`xciiiProjectProperty`, `xciiiBranchProperty`), а не ищет по названию.
  Единственное, что ещё связывается путём, — `workdir_claim.workdir`.
- **Наша автоматика не добавила таблиц в бордовую базу.** Колонки, маршруты,
  промпты и запись «какое свойство — ветка» лежат в `boards.properties`, и
  потому едут с доской при экспорте/переезде; на этой же линии живёт и
  «позиция карточки на маршруте» — в `blocks.fields` карточки, а `flow_state`
  здесь — машинная копия.
- **Время везде unix-миллисекунды в INTEGER**, «живое» отличается от
  «закрытого» NULL'ом в `ended_at`/`released_at`/`finished_at`.
- **Журналы растут сознательно**: `session_event`, `flow_event`,
  `terminal_session` не чистятся (решение в `db-schema-review.md`).
