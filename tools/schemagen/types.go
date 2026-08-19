// Package main is the schema generator: the app's own tables written once, as
// Go data, and rendered into the migration SQL for all three dialects.
//
// It exists because of one rule the board's migrations break on every line:
// a difference between SQLite, MySQL and Postgres must not be written by hand.
// Eighty-one hand-templated migrations is how the fork got here, and every one
// of `{{if.postgres}}JSON{{else}}TEXT{{end}}` is a place somebody has to
// remember three answers to one question. Here the question is asked once —
// what *is* this column — and the three answers come out of one table.
//
// The renderer is `ariga.io/atlas`: it takes a dialect-neutral description and
// emits the DDL each dialect actually wants, including the parts that are easy
// to get wrong by hand — MySQL putting indexes inside CREATE TABLE while the
// other two put them beside it, Postgres spelling varchar `character varying`,
// the charset clause MySQL needs or Cyrillic comes back as question marks.
// Atlas is a build-time dependency: what ships is the SQL it wrote, checked in
// and reviewable, and `go test./tools/schemagen` fails when the two disagree.
//
// Run it with `go generate./tools/schemagen`.
package main

// Type is what a column *is*, before any dialect has an opinion about it. The
// vocabulary is deliberately small: every entry below is a decision somebody
// would otherwise make three times.
type Type struct {
	kind Kind
	size int
}

// Kind is the closed set of column meanings this schema needs.
type Kind int

const (
	// KindID is an identifier as the board stores them today: the 27-character
	// string Utils.createGuid makes, in a VARCHAR(36). Our columns must match
	// it exactly, because MySQL refuses a foreign key whose column type differs
	// from the one it points at — which is also why this cannot become UUIDv7
	// on its own: the board's ids and ours change together or not at all.
	KindID Kind = iota
	// KindName is a short technical string: a status, a mode, a node id, a
	// source name. VARCHAR(n) everywhere — MySQL will not take TEXT in a key.
	KindName
	// KindText is free text a person or an agent wrote: a title, a summary, a
	// reason, a path.
	KindText
	// KindJSON is a JSON document. Rendered as text in all three for now: the
	// writers still put '' in these columns where they mean "nothing", and ''
	// is not a JSON document. Retyping them is deferred work — docs/deferred.md,
	// «Одна база: хвосты плана» — which is also where the writers are made to
	// say 'null'.
	KindJSON
	// KindMillis is a moment in time as unix milliseconds. A real timestamp is
	// what this should be, and the move is deferred (docs/deferred.md, «Одна
	// база: хвосты плана») — for the board's thirty columns and ours together,
	// because the conversion lives on one border or on none.
	KindMillis
	// KindInt is a whole number: an exit code, a sort order.
	KindInt
	// KindBool is a flag. SQLite and Postgres have a boolean; MySQL spells it
	// tinyint(1) and the driver hands back the same Go bool either way.
	KindBool
	// KindInt32 is a narrower whole number, and it exists only because the
	// fork's schema has some: reproducing that schema means reproducing its
	// widths, or the collapsed migration is not the same schema.
	KindInt32
	// KindTimestamp is a real moment, as opposed to KindMillis. The board's
	// history tables already use one — it is the one place the fork got this
	// right — and the collapse has to keep it.
	KindTimestamp
)

// ID is an identifier column, ours or the board's.
func ID() Type { return Type{kind: KindID} }

// Name is a short technical string of at most n characters.
func Name(n int) Type { return Type{kind: KindName, size: n} }

// Text is free text.
func Text() Type { return Type{kind: KindText} }

// JSON is a JSON document.
func JSON() Type { return Type{kind: KindJSON} }

// Millis is a moment, stored as unix milliseconds.
func Millis() Type { return Type{kind: KindMillis} }

// Int is a whole number.
func Int() Type { return Type{kind: KindInt} }

// Bool is a flag.
func Bool() Type { return Type{kind: KindBool} }

// Int32 is a narrower whole number: the fork has a few, and the collapse copies
// the schema rather than improving it.
func Int32() Type { return Type{kind: KindInt32} }

// Timestamp is a real moment in time.
func Timestamp() Type { return Type{kind: KindTimestamp} }

// Column is one column of one table.
type Column struct {
	Name string
	Type Type
	// Null says the value may be absent. Absent is NULL and never the empty
	// string: a card-less conversation has no card, and a foreign key can only
	// say so with NULL.
	Null bool
	// Default is what the column holds when nobody says. It is a closed set
	// rather than a string because the interesting one — "now" — is spelled
	// differently in each dialect, and that difference belongs in one place.
	Default Default
	// Why records the decision behind a column that is not obvious. It is
	// emitted as a comment above the table, not into the database.
	Why string
}

// Default is the closed set of column defaults this schema needs.
type Default int

const (
	// NoDefault is the ordinary case: absence is NULL.
	NoDefault Default = iota
	// DefaultNow is the database's own clock at insert. The board's history
	// tables use it, and it is the reason they cannot be written inside a
	// transaction on SQLite without colliding on their own primary key
	// (docs/sql-plan.md, point 1) — carried across unchanged because fixing
	// that is a change to how history is written, not to the schema's shape.
	DefaultNow
	// DefaultZero and DefaultFalse and DefaultEmptyString are the literals the
	// fork's own columns carry.
	DefaultZero
	DefaultFalse
	DefaultEmptyString
)

// Action is what happens to a row when what it points at is deleted.
type Action string

const (
	// Cascade takes the row with it. What our tables know about a card is only
	// true while the card is: this is the leak docs/db-erd.md is about.
	Cascade Action = "CASCADE"
	// SetNull keeps the row and forgets the reference. A conversation
	// outlives the agent that held it: it happened.
	SetNull Action = "SET NULL"
	// Restrict refuses the delete. A folder a card is working in cannot go
	// until the copy is folded away.
	Restrict Action = "RESTRICT"
)

// FK is a foreign key: the whole point of the tables moving into one database.
type FK struct {
	Name     string
	Columns  []string
	RefTable string
	RefCols  []string
	OnDelete Action
}

// Index is a secondary index.
type Index struct {
	Name    string
	Columns []string
	Unique  bool
}

// Check is a value constraint: the closed set a column may hold.
//
// Written only where the set is closed *by the model* — the three ways to work
// a folder, a session's lifecycle, what a rule did with an item. Not where it
// is a list that grows: an agent kind is a vendor CLI, a session_event kind is
// an event name, and a workspace kind is meant to grow past 'git' to a drive
// or a machine over ssh. SQLite cannot ALTER a check in, so one written on a
// growing set buys a table rebuild every time somebody adds a value — which is
// a worse trade than the typo it catches.
type Check struct {
	Name string
	// Column and Values render as `column IN (...)`, plus `OR column IS NULL`
	// when the column is nullable — a check is false for NULL, not unknown-but-
	// allowed, so a nullable column without that clause rejects every row that
	// leaves it out.
	Column string
	Values []string
}

// Table is one table.
type Table struct {
	Name string
	// Why is the paragraph above the CREATE: what this table is for, in the
	// terms the product uses.
	Why     string
	Columns []Column
	PK      []string
	FKs     []FK
	Indexes []Index
	Checks  []Check
}
