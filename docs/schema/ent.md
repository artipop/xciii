# Та же схема в ent

> **Решение принято 2026-08-17: ent не берём.** Причина — ровно та, которая
> названа ниже и которую этот файл собирался взвесить: он не заменит бордовый
> стор, значит получаются два слоя доступа к одной базе плюс ~30 тыс.
> сгенерированных строк, а покупается типизация для пятидесяти наших методов.
> Схему держит `tools/schemagen` — Go-данные и `ariga.io/atlas` как генератор
> DDL, без слоя доступа; запросы остаются на `database/sql` у нас и на squirrel
> у доски. Файл оставлен как разбор: если вопрос поднимут снова, вот цифры.

Целевая схема XCIII сущностями `entgo.io/ent`. Рядом лежит `app.hcl` — она же в
Atlas HCL; здесь то же самое, но так, как это выглядело бы, если генерировать
слой доступа.

Кода в дереве нет намеренно: `ent` в зависимостях не значится, а `.go` файлы,
которые не собираются, сломали бы `go build ./...` и утащили бы модуль в
`go mod tidy`. Когда будет решено — файлы переезжают в `ent/schema/` как есть.

## Кто из двух файлов главный

Не оба. Если брать ent, то **источник правды — эти сущности**: ent сам умеет
Atlas (`ent/migrate` поверх `ariga.io/atlas`), генерирует DDL под все три
диалекта и версионированные миграции. Тогда `app.hcl` — это то, что ent
выдаёт, а не то, что пишут руками, и держать его в репозитории стоит только как
снимок для чтения.

Обратный порядок — HCL как источник, ent поверх готовой базы — ent тоже умеет
(`entimport`), но тогда каждое изменение схемы делается дважды.

## Что ent даёт и чего стоит

**Даёт.** Типизированный слой вместо `database/sql` со строками; связи как
`edge`, а не как совпадение имён колонок; `go generate` вместо ручного
пересчёта; правила удаления объявлены рядом со связью, а не в DDL отдельно.

**Стоит.** Ещё один генератор в сборке и ~30 тысяч строк сгенерированного кода
в дереве. И главное — **бордовый стор он не заменит**: там squirrel, три
диалекта и две сотни запросов, которые никто не будет переписывать ради этого.
То есть ent реалистично покрывает наши таблицы, а бордовые остаются на своём
слое — при том что таблицы лежат в одной базе. Это рабочая конфигурация (ent
спокойно живёт рядом с чужими таблицами), но назвать её надо вслух: **два слоя
доступа к одной базе.**

Если это неприемлемо — тогда честнее без ent: Atlas для схемы, `database/sql`
для наших запросов, squirrel для бордовых.

## Общее

```go
// ent/schema/mixin.go
package schema

import (
    "time"

    "entgo.io/ent"
    "entgo.io/ent/schema/field"
    "entgo.io/ent/schema/mixin"
    "github.com/google/uuid"
)

// UUIDv7Mixin — идентификатор, который выдаёт создающая сторона. Именно
// поэтому не автоинкремент: страница создаёт карточку с готовым id и на этом
// стоит оптимистичный рендер. v7 упорядочен по времени, так что там, где нужен
// порядок в журнале, хватает ORDER BY id.
type UUIDv7Mixin struct{ mixin.Schema }

func (UUIDv7Mixin) Fields() []ent.Field {
    return []ent.Field{
        field.UUID("id", uuid.UUID{}).
            DefaultFunc(func() uuid.UUID {
                id, err := uuid.NewV7()
                if err != nil {
                    return uuid.New() // v4 — хуже порядок, но не отказ
                }
                return id
            }).
            Immutable(),
    }
}

// TimeMixin — настоящие моменты времени, а не unix-мс в BIGINT. Число остаётся
// форматом обмена: конвертация живёт на границе API, а не в хранении.
type TimeMixin struct{ mixin.Schema }

func (TimeMixin) Fields() []ent.Field {
    return []ent.Field{
        field.Time("created_at").Default(time.Now).Immutable(),
        field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
    }
}

// SoftDeleteMixin — только там, где удаление действительно мягкое: доска и
// блок. Всё остальное удаляется по-настоящему, и внешние ключи это подчищают.
type SoftDeleteMixin struct{ mixin.Schema }

func (SoftDeleteMixin) Fields() []ent.Field {
    return []ent.Field{
        field.Time("deleted_at").Optional().Nillable(),
    }
}
```

## Доска

```go
// ent/schema/board.go
type Board struct{ ent.Schema }

func (Board) Mixin() []ent.Mixin {
    return []ent.Mixin{UUIDv7Mixin{}, TimeMixin{}, SoftDeleteMixin{}}
}

func (Board) Annotations() []schema.Annotation {
    // Имя таблицы оставлено бордовым: переименование стоит правки каждого
    // запроса форка и не покупает ничего.
    return []schema.Annotation{entsql.Annotation{Table: "boards"}}
}

func (Board) Fields() []ent.Field {
    return []ent.Field{
        field.Enum("type").Values("open", "private"),
        field.Text("title"),
        field.Text("description").Optional(),
        field.String("icon").MaxLen(256).Optional(),
        field.Bool("show_description").Default(false),
        field.Bool("is_template").Default(false),
        field.Int("template_version").Default(0),

        // Автоматика доски: колонки, маршруты, промпт, и записи «какое поле
        // чем является». JSON намеренно — едет вместе с доской в экспорт и в
        // шаблон.
        field.JSON("properties", map[string]any{}).Optional(),

        // Схема полей карточки. Разложить её по строкам — это переписать
        // webapp, см. docs/deferred.md («Одна база: хвосты плана»).
        field.JSON("card_properties", []any{}).Optional(),

        field.String("minimum_role").MaxLen(36).Default(""),
    }
}

func (Board) Edges() []ent.Edge {
    return []ent.Edge{
        edge.To("blocks", Block.Type).
            Annotations(entsql.OnDelete(entsql.Cascade)),
        edge.To("members", BoardMember.Type),
        edge.From("creator", User.Type).Ref("boards").Unique().
            Annotations(entsql.OnDelete(entsql.SetNull)),
    }
}

func (Board) Indexes() []ent.Index {
    return []ent.Index{index.Fields("is_template")}
}
```

```go
// ent/schema/block.go — карточка и всё её содержимое
type Block struct{ ent.Schema }

func (Block) Mixin() []ent.Mixin {
    return []ent.Mixin{UUIDv7Mixin{}, TimeMixin{}, SoftDeleteMixin{}}
}

func (Block) Annotations() []schema.Annotation {
    return []schema.Annotation{entsql.Annotation{Table: "blocks"}}
}

func (Block) Fields() []ent.Field {
    return []ent.Field{
        field.Enum("type").Values(
            "board", "card", "view", "text", "comment", "image",
            "attachment", "divider", "checkbox", "h1", "h2", "h3",
            "list_item", "quote", "video", "unknown",
        ),
        field.Text("title").Optional(),

        // Значения полей карточки: {property_id: value}.
        field.JSON("fields", map[string]any{}).Optional(),
    }
}

func (Block) Edges() []ent.Edge {
    return []ent.Edge{
        edge.From("board", Board.Type).Ref("blocks").Unique().Required(),

        // Дерево внутри доски: текст и комментарий висят на карточке.
        // Вложенность карточки в карточку сюда вешать нельзя — это другое
        // отношение, ему нужна своя связь.
        edge.To("children", Block.Type).From("parent").Unique().
            Annotations(entsql.OnDelete(entsql.Cascade)),

        // Всё, что наша сторона знает про карточку. Каскад отсюда — это то,
        // ради чего базы и съезжаются в одну: сегодня удалённая карточка
        // оставляет всё это навсегда.
        edge.To("conversations", Conversation.Type).
            Annotations(entsql.OnDelete(entsql.Cascade)),
        edge.To("sessions", AgentSession.Type).
            Annotations(entsql.OnDelete(entsql.Cascade)),
        edge.To("flow_state", FlowState.Type).Unique().
            Annotations(entsql.OnDelete(entsql.Cascade)),
        edge.To("stall", CardStall.Type).Unique().
            Annotations(entsql.OnDelete(entsql.Cascade)),
    }
}

func (Block) Indexes() []ent.Index {
    return []ent.Index{index.Edges("board").Fields("type")}
}
```

```go
// ent/schema/user.go — человек, агент и источник одинаково являются людьми доски
type User struct{ ent.Schema }

func (User) Mixin() []ent.Mixin {
    return []ent.Mixin{UUIDv7Mixin{}, TimeMixin{}, SoftDeleteMixin{}}
}

func (User) Fields() []ent.Field {
    return []ent.Field{
        field.String("username").MaxLen(100).Unique(),
        field.String("email").MaxLen(255).Optional(),

        // Раньше различалось только по тому, кто завёл учётку.
        field.Enum("kind").Values("person", "agent", "source").Default("person"),

        field.JSON("props", map[string]any{}).Optional(),
    }
}

func (User) Edges() []ent.Edge {
    return []ent.Edge{
        edge.To("boards", Board.Type),
        edge.To("memberships", BoardMember.Type),
        edge.To("sessions", Session.Type).
            Annotations(entsql.OnDelete(entsql.Cascade)),

        // Учётка агента и запись реестра — разные вещи, связанные ключом, а не
        // совпадением имени. Ровно это и было противоречием 2.
        edge.From("agent", Agent.Type).Ref("account").Unique(),
    }
}
```

```go
// ent/schema/boardmember.go — составной ключ, ent называет это edge schema
type BoardMember struct{ ent.Schema }

func (BoardMember) Annotations() []schema.Annotation {
    return []schema.Annotation{
        field.ID("board_id", "user_id"),
        entsql.Annotation{Table: "board_members"},
    }
}

func (BoardMember) Fields() []ent.Field {
    return []ent.Field{
        field.UUID("board_id", uuid.UUID{}),
        field.UUID("user_id", uuid.UUID{}),
        field.Bool("scheme_admin").Default(false),
        field.Bool("scheme_editor").Default(false),
        field.Bool("scheme_commenter").Default(false),
        field.Bool("scheme_viewer").Default(false),
    }
}

func (BoardMember) Edges() []ent.Edge {
    return []ent.Edge{
        edge.To("board", Board.Type).Unique().Required().Field("board_id").
            Annotations(entsql.OnDelete(entsql.Cascade)),
        edge.To("user", User.Type).Unique().Required().Field("user_id").
            Annotations(entsql.OnDelete(entsql.Cascade)),
    }
}
```

Остальные бордовые — `Session`, `Category`, `CategoryBoard`, `Sharing`,
`FileInfo`, `Preference`, `SystemSetting` — той же формы и без неожиданностей;
`Preference` и `CategoryBoard`, как и `BoardMember`, объявляют составной ключ
через `field.ID`.

## Реестры машины

```go
// ent/schema/workdir.go — место, где работает агент
type Workdir struct{ ent.Schema }

func (Workdir) Mixin() []ent.Mixin { return []ent.Mixin{UUIDv7Mixin{}, TimeMixin{}} }

func (Workdir) Fields() []ent.Field {
    return []ent.Field{
        // Подпись, а не ключ: её можно менять, карточки ссылаются на id.
        field.String("name").MaxLen(200).Unique(),

        // Не обязано быть каталогом на диске: id для того и заведён, чтобы
        // завтра это был репозиторий для клонирования, диск или машина по ssh.
        field.Text("path").Optional().Unique(),

        field.Enum("kind").Values("plain", "git").Default("plain"),
        field.String("base_branch").MaxLen(200).Optional(),
        field.String("branch_prefix").MaxLen(64).Optional(),
        field.Bool("global").Default(false),
    }
}

func (Workdir) Edges() []ent.Edge {
    return []ent.Edge{
        edge.To("boards", WorkdirBoard.Type).
            Annotations(entsql.OnDelete(entsql.Cascade)),

        // Папку, в которой карточка работает, удалить нельзя — сначала надо
        // свернуть копию.
        edge.To("claims", WorkdirClaim.Type).
            Annotations(entsql.OnDelete(entsql.Restrict)),
    }
}
```

```go
// ent/schema/workdirboard.go — какая папка какой доске предлагается и как в ней
// работать. Ключ по паре: папка «на всех досках» — одна запись, а ответ у
// каждой доски свой.
type WorkdirBoard struct{ ent.Schema }

func (WorkdirBoard) Annotations() []schema.Annotation {
    return []schema.Annotation{field.ID("workdir_id", "board_id")}
}

func (WorkdirBoard) Fields() []ent.Field {
    return []ent.Field{
        field.UUID("workdir_id", uuid.UUID{}),
        field.UUID("board_id", uuid.UUID{}),
        field.Enum("mode").Values("worktree", "branch").Optional(),
    }
}

func (WorkdirBoard) Edges() []ent.Edge {
    return []ent.Edge{
        edge.To("workdir", Workdir.Type).Unique().Required().Field("workdir_id").
            Annotations(entsql.OnDelete(entsql.Cascade)),
        edge.To("board", Board.Type).Unique().Required().Field("board_id").
            Annotations(entsql.OnDelete(entsql.Cascade)),
    }
}
```

```go
// ent/schema/agent.go
type Agent struct{ ent.Schema }

func (Agent) Mixin() []ent.Mixin { return []ent.Mixin{UUIDv7Mixin{}, TimeMixin{}} }

func (Agent) Fields() []ent.Field {
    return []ent.Field{
        field.String("name").MaxLen(100).Unique(),
        field.Enum("kind").Values("claude", "codex", "antigravity", "copilot", "junie", "acp"),
        field.Text("bin_path").Optional(),
        field.String("model").MaxLen(100).Optional(),
        field.Text("prompt").Optional(),

        // env, args, cliArgs, terminalCommand, mcpServers, autoAllowTools.
        // JSON намеренно: ни на что не ссылается и ни к чему не
        // присоединяется — это конфигурация запуска процесса.
        field.JSON("settings", map[string]any{}).Optional(),
    }
}

func (Agent) Edges() []ent.Edge {
    return []ent.Edge{
        edge.To("account", User.Type).Unique().
            Annotations(entsql.OnDelete(entsql.SetNull)),
        edge.From("proxy", Proxy.Type).Ref("agents").Unique().
            Annotations(entsql.OnDelete(entsql.SetNull)),
        edge.To("conversations", Conversation.Type).
            Annotations(entsql.OnDelete(entsql.SetNull)),
    }
}
```

`Proxy` и `DeployTarget` — той же формы: `name` уникален и остаётся подписью,
ссылаются на них по id.

## Работа

```go
// ent/schema/conversation.go — CLI агента в pty. Было terminal_session.
type Conversation struct{ ent.Schema }

func (Conversation) Mixin() []ent.Mixin { return []ent.Mixin{UUIDv7Mixin{}} }

func (Conversation) Fields() []ent.Field {
    return []ent.Field{
        // Род и место разом: option id колонки — работа; '@talk' — обсуждение
        // карточки; '@none' — работа над карточкой без колонки.
        field.String("node_id").MaxLen(64),

        // Как называлась колонка в момент разговора: её могли переименовать, а
        // строка в списке должна читаться так же.
        field.String("column_name").MaxLen(200).Optional(),

        // Имя разговора: дал человек или сам агент через name_conversation.
        field.Text("title").Optional(),

        // Одна строка агента о том, чем разговор занят.
        field.Text("summary").Optional(),

        field.Text("cwd").Optional(),
        field.String("branch").MaxLen(255).Optional(),
        field.Time("started_at").Default(time.Now).Immutable(),
        field.Time("ended_at").Optional().Nillable(),
        field.Int("exit_code").Optional().Nillable(),
    }
}

func (Conversation) Edges() []ent.Edge {
    return []ent.Edge{
        // Пусто у разговора планирования: карточки у него нет.
        edge.From("card", Block.Type).Ref("conversations").Unique(),
        edge.From("board", Board.Type).Ref("conversations").Unique().Required(),

        // Разговор переживает того, кто его вёл: он состоялся.
        edge.From("agent", Agent.Type).Ref("conversations").Unique(),

        edge.From("workdir", Workdir.Type).Ref("conversations").Unique(),
    }
}

func (Conversation) Indexes() []ent.Index {
    return []ent.Index{
        index.Edges("card").Fields("node_id", "started_at"),
    }
}
```

```go
// ent/schema/workdirclaim.go — копия и ветка, взятые под владельца
type WorkdirClaim struct{ ent.Schema }

func (WorkdirClaim) Annotations() []schema.Annotation {
    return []schema.Annotation{field.ID("workdir_id", "owner")}
}

func (WorkdirClaim) Fields() []ent.Field {
    return []ent.Field{
        field.UUID("workdir_id", uuid.UUID{}),

        // Владелец — карточка или доска (черновики). В HCL это две колонки с
        // CHECK «ровно одна заполнена»; здесь строка вида "card:<uuid>" была бы
        // шагом назад, поэтому две необязательные связи и валидатор.
        field.UUID("card_id", uuid.UUID{}).Optional().Nillable(),
        field.UUID("board_id", uuid.UUID{}).Optional().Nillable(),

        field.Enum("mode").Values("worktree", "branch", "plain"),

        // NULL, а не пустая строка: у обычной папки ветки нет.
        field.String("branch").MaxLen(255).Optional().Nillable(),
        field.Text("path").Optional().Nillable(),
        field.String("base").MaxLen(255).Optional().Nillable(),
        field.Time("created_at").Default(time.Now).Immutable(),

        // NULL — рабочее место живое.
        field.Time("released_at").Optional().Nillable(),
    }
}

func (WorkdirClaim) Indexes() []ent.Index {
    return []ent.Index{index.Fields("workdir_id", "released_at")}
}
```

```go
// ent/schema/flowstate.go — где карточка стоит на маршруте.
// Это индекс для сборщика событий: правда живёт на самой карточке и потому
// едет вместе с доской.
type FlowState struct{ ent.Schema }

func (FlowState) Annotations() []schema.Annotation {
    return []schema.Annotation{field.ID("card_id")}
}

func (FlowState) Fields() []ent.Field {
    return []ent.Field{
        field.UUID("card_id", uuid.UUID{}),
        field.String("flow_id").MaxLen(64),
        field.String("node_id").MaxLen(64),
        field.String("branch").MaxLen(255).Optional().Nillable(),
        field.UUID("workdir_id", uuid.UUID{}).Optional().Nillable(),
        field.Time("entered_at").Default(time.Now),
    }
}
```

```go
// ent/schema/cardstall.go — почему карточка стоит.
// Одна текущая причина, а не журнал: она верна только пока не исправили то,
// о чём она.
type CardStall struct{ ent.Schema }

func (CardStall) Annotations() []schema.Annotation {
    return []schema.Annotation{field.ID("card_id")}
}

func (CardStall) Fields() []ent.Field {
    return []ent.Field{
        field.UUID("card_id", uuid.UUID{}),
        field.String("node_id").MaxLen(64).Optional(),

        // conversation — единственный род, у которого есть куда пойти:
        // открыть терминал. Остальным идти некуда, и кнопки у них нет.
        field.Enum("kind").Values("conversation", "column", "workdir", "route").Optional(),

        field.Text("reason"),
        field.Time("created_at").Default(time.Now),
    }
}
```

`AgentSession`, `SessionEvent`, `FlowEvent`, `StageQueue`, `BoardSetup`,
`VCSSeen`, `Idempotency`, `SourceItem`, `SourceEvent` — той же формы. У
журналов (`SessionEvent`, `FlowEvent`, `SourceEvent`) нет ни автоинкремента, ни
`seq`: `UUIDv7Mixin` даёт порядок сам.

## Три места, где ent придётся уговаривать

**Составные ключи.** Их у нас восемь (`board_members`, `preferences`,
`category_boards`, `workdir_board`, `workdir_claim`, `board_setup`, `vcs_seen`,
`source_item`). ent умеет их только у edge schema и только через
`field.ID("a","b")` в аннотациях — работает, но это не тот путь, по которому
ходят все, и на нём меньше сахара: нет `Create().SetX()` по связям, есть
`Create().SetAID().SetBID()`.

**«Ровно одна из двух связей».** `workdir_claim` принадлежит либо карточке,
либо доске. В HCL это `CHECK ((card_id IS NULL) <> (board_id IS NULL))`, в ent —
хук или валидатор в Go, потому что CHECK'и ent не генерирует. Проверка уезжает
из базы в приложение, и это шаг назад ровно там, где весь план идёт вперёд:
такие CHECK'и стоит дописывать в миграцию руками.

**Перечисления.** `field.Enum` в ent — это валидатор в Go и обычная строковая
колонка в базе. Чтобы база тоже отказывала, `CHECK` опять же дописывается в
миграцию.

Из чего следует, что даже с ent описание схемы не полностью декларативно:
`CHECK`-и живут отдельным слоем. Это аргумент не против ent, а против ожидания,
что генератор заменит собой схему.
