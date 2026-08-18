# Диалекты: что именно различается

Инвентарь. `docs/sql-plan.md` — план и его история; здесь список того, что в
коде **сейчас** зависит от вендора, по группам, с настоящими кусками кода и с
решением по каждой группе.

Снято 2026-08-18, после того как тесты впервые прогнались на всех трёх базах
(`internal/dbtest`, `wails3 task test:db:all`). До этого прогона говорить о
диалектах было нельзя: две ветки из трёх не исполнялись никогда, и как они себя
ведут, было неизвестно.

## Счёт

60 упоминаний `dbType` во всём дереве. В **самих запросах** — 15:

| группа | веток | что делать |
|---|---|---|
| [upsert](#1-upsert--десять-раз-одна-форма) | 10 | хелпер |
| [время](#2-время--две-ветки-из-за-строкового-insert_at) | 2 | уходят вместе с `time.Time` |
| [плейсхолдеры](#3-плейсхолдеры--билдер-это-уже-сделал) | 1 | запрос через билдер |
| [поиск по JSON](#оставляем-поиск-по-json) | 1 | **оставить** |
| [`DELETE … LIMIT`](#оставляем-delete--limit) | 1 | **оставить** |

Плюс обвязка вне запросов: `escapeField` (10 вызовов), `castInt` (4),
`GetSchemaName` (1) — и две мёртвые функции, см. ниже.

Главное, что видно из таблицы: это **не «три диалекта», а «MySQL против
двух»**. Postgres и SQLite согласны про `ON CONFLICT`, про `$N` и про `"` в
кавычках. Цена не в трёх вендорах, а в одном, и это меняет форму решения:
нужно не абстракция на три реализации, а одно место, где MySQL расходится.

## 0. Мёртвые: три арма на функцию, вызывают только тесты

`sqlstore.go`:

```go
func (s *SQLStore) concatenationSelector(field, delimiter string) string {
	if s.dbType == model.SqliteDBType   { return fmt.Sprintf("group_concat(%s)", field) }
	if s.dbType == model.PostgresDBType { return fmt.Sprintf("string_agg(%s, '%s')", field, delimiter) }
	if s.dbType == model.MysqlDBType    { return fmt.Sprintf("GROUP_CONCAT(%s SEPARATOR '%s')", field, delimiter) }
	return ""
}

func (s *SQLStore) elementInColumn(column string) string {
	if s.dbType == model.SqliteDBType || s.dbType == model.MysqlDBType {
		return fmt.Sprintf("instr(%s, ?) > 0", column)
	}
	if s.dbType == model.PostgresDBType {
		return fmt.Sprintf("position(? in %s) > 0", column)
	}
	return ""
}
```

Единственные вызовы — `TestConcatenationSelector` и `TestElementInColumn`,
которые проверяют, что функция вернула ту строку, которую вернула. Тест на код,
которого нет в продукте.

**Решение: удалить обе вместе с тестами.** Ничего не заменяем — заменять нечего.

## 1. Upsert — десять раз одна форма

`system.go`, и так же в `sharing.go`, `subscriptions.go`, `team.go` (дважды),
`notificationhints.go`, `category_boards.go`, `board.go`, `cloud.go`, `user.go`:

```go
query := s.getQueryBuilder(db).Insert("system_settings").Columns("id","value").Values(id, value)

if s.dbType == model.MysqlDBType {
	query = query.Suffix("ON DUPLICATE KEY UPDATE value = ?", value)
} else {
	query = query.Suffix("ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value")
}
```

**И это не только про красоту.** В `category_boards.go` две ветки делают
разное:

```go
if s.dbType == model.MysqlDBType {
	query = query.Suffix("ON DUPLICATE KEY UPDATE category_id = ?", categoryID)
} else {
	query = query.Suffix(`ON CONFLICT (user_id, board_id)
		 DO UPDATE SET category_id = EXCLUDED.category_id, update_at = EXCLUDED.update_at`)
}
```

MySQL не трогает `update_at`. Перенос доски между категориями оставляет там
протухшую метку — молча, и никто этого не видел, потому что жил только SQLite.
Ровно тот класс ошибок, ради которого писать SQL по вендору руками и не хочется.

**Решение: `s.upsert(query, onConflict []string, set ...)`.** Десять веток → одна
функция, и расхождение становится невозможным по построению. Перед этим надо
решить, какое поведение у `category_boards` правильное, а не просто слить ветки.

## 2. Время — две ветки из-за строкового `insert_at`

`blocks.go` форматирует дату в строку:

```go
func (s *SQLStore) timestampToCharField(name, as string) string {
	switch s.dbType {
	case model.MysqlDBType:    return fmt.Sprintf("date_format(%s, '%%Y-%%m-%%d %%H:%%i:%%S') AS %s", name, as)
	case model.PostgresDBType: return fmt.Sprintf("to_char(%s, 'YYYY-MM-DD HH:MI:SS.MS') AS %s", name, as)
	default:                   return fmt.Sprintf("%s AS %s", name, as)
	}
}
```

`board.go` разбирает её обратно:

```go
dateTemplate := "2006-01-02T15:04:05Z0700"
if s.dbType == model.MysqlDBType {
	dateTemplate = "2006-01-02 15:04:05.000000"
}
ts, err := time.Parse(dateTemplate, insertAt.String)
```

Обе существуют только потому, что дата гоняется через строку. Драйвер отдаёт
`time.Time` сам, если колонка объявлена датой.

**Решение: ничего специально не делать — они уйдут вместе с переводом времени на
`time.Time`** (`docs/store-plan.md`, шаг 0). Это единственная группа, где работа
по диалектам и работа по типам — одна работа.

## 3. Плейсхолдеры — билдер это уже сделал

`blocks.go`:

```go
// if we're using postgres or sqlite, we need to replace the
// question mark placeholder with the numbered dollar one
if s.dbType == model.PostgresDBType || s.dbType == model.SqliteDBType {
	sql, rErr = sq.Dollar.ReplacePlaceholders(sql)
}
```

`getQueryBuilder` уже ставит `sq.Dollar` для этих двух. Здесь запрос собран
сырым SQL мимо билдера, поэтому пришлось повторить руками.

**Решение: провести запрос через билдер.** Сначала понять, почему он собран
мимо, — возможно, есть причина.

## Оставляем: поиск по JSON

`board.go`:

```go
case model.PostgresDBType:
	where := "NULLIF(b.properties, '')::json->? is not null"
case model.MysqlDBType, model.SqliteDBType:
	where := "JSON_EXTRACT(b.properties, ?) IS NOT NULL"
```

Свести можно только одним способом — разложить свойства карточки по строкам
вместо JSON в `blocks.fields` / `boards.card_properties`. Это переделка доски, а
не миграция; `docs/store-plan.md` называет её и откладывает. Одна ветка на весь
продукт — нормальная цена.

Каст здесь появился 2026-08-18: `properties` — колонка типа text во всех трёх
диалектах, а у Postgres нет `->` для text, так что **поиск по имени свойства на
Postgres не работал никогда**. `NULLIF` — потому что доска, у которой свойств не
было, держит там `''`, и голый каст бросил бы исключение вместо «ничего не
нашлось».

## Оставляем: `DELETE … LIMIT`

`data_retention.go`: `DELETE … LIMIT` есть только у MySQL, остальным нужен
подзапрос по первичному ключу. Разница настоящая и в SQL не сводится.

## Про интерфейс `dialect`

`docs/sql-plan.md`, пункт 2, предлагает интерфейс с шестью методами. Идея
правильная, список — нет: он перечисляет сегодняшние ветки, а не те, что должны
выжить.

После групп 0–3 живыми остаются **три** helper'а: `escapeField` (10 вызовов),
`castInt` (4), `GetSchemaName` (1). `timestampToCharField` умирает вместе с
группой 2, `concatenationSelector` и `elementInColumn` — мёртвые.

Три функции на структуре — это не проблема, которую решает интерфейс. **Правило:
сначала убить, потом абстрагировать.** Интерфейс поверх веток, которых не должно
быть, делает их вечными и труднее заметными.

## Порядок

1. группа 0 — удалить мёртвое (пятнадцать минут, ничего не ломает);
2. группа 1 — upsert-хелпер (минус десять веток, закрывает расхождение);
3. группа 3 — один запрос через билдер;
4. группа 2 — отдельным заходом, вместе с типами, потому что это про типы;
5. интерфейс — не делать.

Каждый шаг проверяется `wails3 task test:db:all`: sqlite ~10 c, postgres ~40 c,
mysql ~95 c. Полная сверка — около пяти минут, и это теперь цена одной итерации.
