package main

import (
	"fmt"
	"sort"
	"strings"
)

// The schema drawn rather than read. It comes out of the same Go data the
// migration does, which is the whole reason it is here rather than in a
// markdown file somebody edits: a hand-drawn diagram of a schema is a second
// description of it, and a second description is one that goes stale. The one
// thing it cannot show is what a column *means*, so `Why` is carried through
// as the comment on the field.
//
// Mermaid, because GitHub, the guide site and a published artifact all render
// it without a toolchain, and because an ER diagram is one of the shapes it
// knows natively.

// mermaidKind is what a column's type is called on the diagram. Deliberately
// not the SQL type: the diagram is for reading the model, and "millis" says
// more about what is in the column than "bigint" does.
func mermaidKind(t Type) string {
	switch t.kind {
	case KindID:
		return "id"
	case KindName:
		return fmt.Sprintf("name_%d", t.size)
	case KindText:
		return "text"
	case KindJSON:
		return "json"
	case KindMillis:
		return "millis"
	case KindInt:
		return "int"
	case KindBool:
		return "bool"
	case KindInt32:
		return "int32"
	case KindTimestamp:
		return "timestamp"
	}
	return "text"
}

// mermaidComment squeezes a column's reasoning onto one line. Mermaid puts the
// comment in quotes, so it can hold neither a quote nor a newline.
func mermaidComment(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	s = strings.ReplaceAll(s, `"`, "'")
	if len(s) > 110 {
		// Cut at a word rather than mid-word: the diagram is read, not parsed.
		cut := strings.LastIndex(s[:110], " ")
		if cut < 60 {
			cut = 110
		}
		s = s[:cut] + "…"
	}
	return s
}

// relationLabel is what an arrow says. The delete rule is the interesting half
// — it is the answer to "what happens to this row when the card goes" — and it
// is the thing the move into one database bought.
func relationLabel(fk FK) string {
	label := strings.Join(fk.Columns, "+")
	if fk.OnDelete != "" {
		label += " " + string(fk.OnDelete)
	}
	return label
}

// renderERD draws the tables as a mermaid erDiagram. Only tables in the given
// set are drawn, but a key pointing outside it still draws its target, so a
// diagram of our tables alone still shows that everything hangs off blocks.
func renderERD(tables []Table) string {
	drawn := map[string]bool{}
	for _, t := range tables {
		drawn[t.Name] = true
	}

	var b strings.Builder
	b.WriteString("```mermaid\nerDiagram\n")

	// Relations first, so the picture's shape is established before the detail.
	type rel struct{ from, to, label string }
	var rels []rel
	for _, t := range tables {
		for _, fk := range t.FKs {
			rels = append(rels, rel{fk.RefTable, t.Name, relationLabel(fk)})
		}
	}
	sort.SliceStable(rels, func(i, j int) bool {
		if rels[i].from != rels[j].from {
			return rels[i].from < rels[j].from
		}
		return rels[i].to < rels[j].to
	})
	for _, r := range rels {
		// One-to-many with an optional child: every key here is "this row is
		// about that one", and none of them is required to exist.
		fmt.Fprintf(&b, "    %s ||--o{ %s : \"%s\"\n", r.from, r.to, r.label)
	}
	b.WriteString("\n")

	for _, t := range tables {
		pk := map[string]bool{}
		for _, c := range t.PK {
			pk[c] = true
		}
		fkCols := map[string]bool{}
		for _, fk := range t.FKs {
			for _, c := range fk.Columns {
				fkCols[c] = true
			}
		}

		// A check is information about the column, so it is said on the column
		// rather than left in the DDL: "one of these" is what a reader of a
		// schema wants to know about a status or a mode.
		checked := map[string]string{}
		for _, ch := range t.Checks {
			checked[ch.Column] = strings.Join(ch.Values, " | ")
		}

		fmt.Fprintf(&b, "    %s {\n", t.Name)
		for _, c := range t.Columns {
			marks := ""
			switch {
			case pk[c.Name] && fkCols[c.Name]:
				marks = " PK, FK"
			case pk[c.Name]:
				marks = " PK"
			case fkCols[c.Name]:
				marks = " FK"
			}
			why := c.Why
			if set, ok := checked[c.Name]; ok {
				if why != "" {
					why = set + " — " + why
				} else {
					why = set
				}
			} else if why == "" && c.Null {
				why = "nullable"
			}
			line := fmt.Sprintf("        %s %s%s", mermaidKind(c.Type), c.Name, marks)
			if why != "" {
				line += fmt.Sprintf(" %q", mermaidComment(why))
			}
			b.WriteString(line + "\n")
		}
		b.WriteString("    }\n")
	}
	b.WriteString("```\n")
	return b.String()
}

// renderERDDoc is the whole page: a diagram per group, each under the heading
// that says what the group is for. Split rather than drawn as one picture
// because thirty-eight tables in one diagram is a picture nobody can read.
func renderERDDoc() string {
	var b strings.Builder
	b.WriteString(erdHeader)

	for _, g := range erdGroups() {
		fmt.Fprintf(&b, "\n## %s\n\n%s\n\n", g.title, g.why)
		b.WriteString(renderERD(g.tables))
	}
	return b.String()
}

type erdGroup struct {
	title  string
	why    string
	tables []Table
}

// pick returns the named tables in the order given, so a group's diagram reads
// in the order somebody would explain it rather than in declaration order.
func pick(all []Table, names ...string) []Table {
	byName := map[string]Table{}
	for _, t := range all {
		byName[t.Name] = t
	}
	out := make([]Table, 0, len(names))
	for _, n := range names {
		t, ok := byName[n]
		if !ok {
			panic("erd: no such table: " + n)
		}
		out = append(out, t)
	}
	return out
}

func erdGroups() []erdGroup {
	board := boardTables()
	app := appTables()
	return []erdGroup{
		{
			title: "Доска",
			why: "Форк Focalboard. Всё содержимое доски — строки `blocks`: карточка,\n" +
				"вид, комментарий, вложение; дерево внутри доски — через `parent_id`.\n" +
				"Наша автоматика лежит в `boards.properties` (`xciiiColumns`,\n" +
				"`xciiiFlows`, `xciiiPrompt`, …) и в `blocks.fields` карточки, своих\n" +
				"таблиц у неё нет — потому и едет с доской при экспорте и переезде.\n\n" +
				"Внешних ключей здесь нет, и намеренно: у форка наследный soft-delete,\n" +
				"так что настоящий ключ сработал бы ровно на тех путях, где удаление\n" +
				"настоящее.",
			tables: pick(board, "boards", "blocks", "board_members", "users", "sessions",
				"categories", "category_boards", "sharing", "subscriptions",
				"notification_hints", "file_info", "preferences", "teams",
				"system_settings"),
		},
		{
			title: "История доски",
			why: "Каждая правка дописывает строку. Механизм апстрима: undo этого\n" +
				"продукта живёт на странице (`webapp/src/undomanager.ts`), экрана\n" +
				"истории нет. `insert_at` — часть первичного ключа, и приходит он из\n" +
				"Go (`utils.NextInsertAt`), а не из часов базы: внутри транзакции\n" +
				"часы базы отдают всем строкам один и тот же момент.",
			tables: pick(board, "boards_history", "blocks_history", "board_members_history"),
		},
		{
			title: "Реестры",
			why: "Что знает эта машина: где работать, кем и куда публиковать. Были\n" +
				"массивами в `config.json`, где у записи не было id и ссылаться на\n" +
				"неё можно было только по имени — то есть нельзя было переименовать.",
			tables: pick(app, "workspace", "workspace_board", "agent", "proxy", "deploy_target"),
		},
		{
			title: "Разговоры и сессии",
			why: "Ось — карточка (`blocks.id`) и нода: id опции колонки, на которой\n" +
				"карточка стоит. Разговор переживает процесс, который его рисовал\n" +
				"(`claude --continue`), сессия — это один запуск и один вердикт;\n" +
				"поэтому таблицы две.",
			tables: pick(app, "conversation", "agent_session", "session_event"),
		},
		{
			title: "Маршруты",
			why: "Где карточка на маршруте, как она туда попала и почему стоит.\n" +
				"`card_stall` — одна текущая причина, а не журнал: «в колонке нет\n" +
				"места» верно только пока верно, и комментарий пережил бы её шумом.",
			tables: pick(app, "flow_state", "flow_event", "card_stall", "stage_queue"),
		},
		{
			title: "Работа в папке",
			why: "`checkout` — git-состояние: где копия, какая ветка, от чего\n" +
				"отрезана. Владелец — карточка либо доска («черновики доски»), ровно\n" +
				"одна из двух колонок заполнена; обычная папка не пишет строки вовсе.",
			tables: pick(app, "checkout", "vcs_seen"),
		},
		{
			title: "Входящие",
			why: "Дедуп и журнал. `card_id` здесь `SET NULL`, а не `CASCADE`: решение\n" +
				"источника переживает карточку, которая из него вышла.",
			tables: pick(app, "source_item", "source_event"),
		},
		{
			title: "Защёлки",
			why: "Не сущности, а ответы «это уже сделано»: событие обработано, шаг\n" +
				"мастера пройден. Связей между собой у них нет.",
			tables: pick(app, "idempotency", "board_setup"),
		},
	}
}

const erdHeader = `<!-- Generated by tools/schemagen. Do not edit by hand:
     change the schema in tools/schemagen and run ` + "`go generate ./tools/schemagen`" + `. -->

# Схема базы, картинкой

Одна база — ` + "`xciii.db`" + ` — и в ней всё: таблицы доски (форк Focalboard) и
таблицы этого приложения. Схему держит ` + "`tools/schemagen`" + ` как Go-данные;
оттуда же и миграция для трёх диалектов, и эта страница, так что разойтись им
негде.

Читается это словами в ` + "`docs/db-erd.md`" + ` (что где лежит, чем что
адресуется и почему) и ` + "`docs/db-schema-review.md`" + ` (разбор решений).

Типы на схеме — не типы SQL, а то, что в колонке: ` + "`id`" + `, ` + "`millis`" + `
(момент в unix-миллисекундах), ` + "`name_36`" + ` (короткая техническая строка),
` + "`json`" + `, ` + "`text`" + `. Как это ложится на SQLite, MySQL и Postgres — в
` + "`tools/schemagen/types.go`" + `.

Подписи у колонок английские, потому что это цитата: они взяты из
` + "`tools/schemagen`" + ` слово в слово, а перевод был бы вторым описанием —
ровно тем, что эта страница и заводится, чтобы не заводить.

Где у колонки закрытый набор значений, он написан вместо подписи: это ` + "`CHECK`" + ` в
схеме, а не соглашение. Ставится он только там, где набор закрыт **моделью**
(три способа работать с папкой, жизненный цикл сессии), и не ставится там, где
это список, который растёт, — вид агента, имя события.

На стрелках написано, что происходит со строкой, когда исчезает то, на что она
смотрит. Ради этого таблицы и съехались в одну базу: пока их было три файла,
удаление карточки не могло убрать за собой ничего.
`
