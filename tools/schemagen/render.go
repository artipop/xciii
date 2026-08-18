package main

import (
	"context"
	"fmt"
	"strings"

	"ariga.io/atlas/sql/migrate"
	"ariga.io/atlas/sql/mysql"
	"ariga.io/atlas/sql/postgres"
	"ariga.io/atlas/sql/schema"
	"ariga.io/atlas/sql/sqlite"
)

// dialect is one of the three databases the fork supports. Everything that
// differs between them is in this file and nowhere else — which is the whole
// reason the generator exists.
type dialect struct {
	// name is what the migration template's own condition is called:
	// {{if .sqlite}} … {{end}}.
	name string
	plan migrate.PlanApplier
	// column maps a Kind onto the type this dialect actually has.
	column func(Type) schema.Type
	// attrs are table attributes this dialect wants: MySQL needs the charset
	// spelled out or a Russian column name comes back as question marks.
	attrs []schema.Attr
	// now is this dialect's "the database's own clock", for DefaultNow.
	now string
	// quote wraps an identifier the way this dialect writes one. Only a check
	// expression needs it: atlas quotes everything else itself, but a check is
	// SQL text we hand it.
	quote func(string) string
}

func dialects() []dialect {
	return []dialect{
		{
			name: "sqlite",
			plan: sqlite.DefaultPlan,
			column: func(t Type) schema.Type {
				switch t.kind {
				case KindID:
					return &schema.StringType{T: "varchar", Size: idLen}
				case KindName:
					return &schema.StringType{T: "varchar", Size: t.size}
				case KindText, KindJSON:
					return &schema.StringType{T: "text"}
				case KindBool:
					return &schema.BoolType{T: "boolean"}
				case KindInt32:
					return &schema.IntegerType{T: "int"}
				case KindTimestamp:
					return &schema.TimeType{T: "datetime"}
				default:
					return &schema.IntegerType{T: "bigint"}
				}
			},
			now:   "STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')",
			quote: func(id string) string { return "`" + id + "`" },
		},
		{
			name: "mysql",
			plan: mysql.DefaultPlan,
			column: func(t Type) schema.Type {
				switch t.kind {
				case KindID:
					return &schema.StringType{T: "varchar", Size: idLen}
				case KindName:
					return &schema.StringType{T: "varchar", Size: t.size}
				case KindText, KindJSON:
					return &schema.StringType{T: "text"}
				case KindBool:
					// MySQL has no boolean of its own; tinyint(1) is what its
					// own driver reads back as a Go bool.
					return &schema.BoolType{T: "tinyint"}
				case KindInt32:
					return &schema.IntegerType{T: "int"}
				case KindTimestamp:
					return &schema.TimeType{T: "datetime", Precision: intp(6)}
				default:
					return &schema.IntegerType{T: "bigint"}
				}
			},
			attrs: []schema.Attr{
				&schema.Charset{V: "utf8mb4"},
				&schema.Collation{V: "utf8mb4_general_ci"},
			},
			// CURRENT_TIMESTAMP rather than the identical NOW(): atlas quotes a
			// raw expression on a time column unless it starts with
			// current_timestamp, so NOW(6) came out as the *string*
			// `DEFAULT "NOW(6)"` and MySQL answered "Invalid default value for
			// 'insert_at'" — the migration died on its first table.
			now:   "CURRENT_TIMESTAMP(6)",
			quote: func(id string) string { return "`" + id + "`" },
		},
		{
			name: "postgres",
			plan: postgres.DefaultPlan,
			column: func(t Type) schema.Type {
				switch t.kind {
				case KindID:
					return &schema.StringType{T: "varchar", Size: idLen}
				case KindName:
					return &schema.StringType{T: "varchar", Size: t.size}
				case KindText, KindJSON:
					return &schema.StringType{T: "text"}
				case KindBool:
					return &schema.BoolType{T: "boolean"}
				case KindInt32:
					return &schema.IntegerType{T: "integer"}
				case KindTimestamp:
					return &schema.TimeType{T: "timestamptz"}
				default:
					return &schema.IntegerType{T: "bigint"}
				}
			},
			now:   "NOW()",
			quote: func(id string) string { return `"` + id + `"` },
		},
	}
}

func intp(i int) *int { return &i }

// defaultOf renders a column default. `now` is the only one that differs
// between dialects, and it is the reason this is a closed set rather than a
// string somebody writes at each call site.
func defaultOf(d dialect, c Column) schema.Expr {
	switch c.Default {
	case DefaultNow:
		return &schema.RawExpr{X: d.now}
	case DefaultZero:
		return &schema.RawExpr{X: "0"}
	case DefaultFalse:
		return &schema.RawExpr{X: "false"}
	case DefaultEmptyString:
		return &schema.RawExpr{X: "''"}
	default:
		return nil
	}
}

// idLen is the width of an id as the board stores one: VARCHAR(36), holding the
// 27 characters Utils.createGuid makes. Ours must match it to the character —
// MySQL refuses a foreign key whose column type differs from the one it points
// at, and that is exactly why our ids and the board's cannot become UUIDv7
// separately.
const idLen = 36

// checkExpr writes `col IN (...)`, plus an IS NULL arm for a nullable column:
// a check is *false* for NULL rather than skipped, so without it every row that
// leaves the column out is refused. Identifiers are quoted the dialect's way,
// which is the one thing about a check expression that is not portable.
func checkExpr(d dialect, c Check, nullable bool) string {
	values := make([]string, 0, len(c.Values))
	for _, v := range c.Values {
		values = append(values, "'"+v+"'")
	}
	col := d.quote(c.Column)
	expr := col + " IN (" + strings.Join(values, ", ") + ")"
	if nullable {
		expr = col + " IS NULL OR " + expr
	}
	return expr
}

// build turns the dialect-neutral tables into an atlas schema. The schema is
// unnamed on purpose: a named one makes atlas qualify every identifier
// (`main`.`blocks`), and the migration runs in whatever schema the connection
// is already in, exactly as the board's own eighty do.
func build(d dialect, tables []Table) (*schema.Schema, error) {
	s := schema.New("")

	// Referenced-but-not-created tables: the board's own, made by migration
	// 000001. Atlas needs an object to point a foreign key at; nothing about
	// them is emitted.
	refs := map[string]*schema.Table{}
	ref := func(name string) *schema.Table {
		if t, ok := refs[name]; ok {
			return t
		}
		t := schema.NewTable(name).
			AddColumns(schema.NewColumn("id").SetType(d.column(ID())))
		t.SetPrimaryKey(schema.NewPrimaryKey(t.Columns[0]))
		refs[name] = t
		return t
	}

	built := map[string]*schema.Table{}
	for _, tbl := range tables {
		at := schema.NewTable(tbl.Name)
		at.AddAttrs(d.attrs...)

		// A key column is NOT NULL whatever the table said. SQLite allows a
		// nullable column in a table-level PRIMARY KEY and the fork's older
		// CREATEs simply never wrote NOT NULL, so reproducing the ladder
		// reproduced that — and MySQL refuses it outright: "Error 1171: All
		// parts of a PRIMARY KEY must be NOT NULL". The whole migration failed
		// on its first statement, which is why nothing after it ran either.
		//
		// The ladder got away with it by writing each dialect by hand, so its
		// MySQL file said NOT NULL where its SQLite file did not. One
		// description of the schema cannot say both, and NOT NULL is the true
		// one: a row with no primary key is not a row anybody wants.
		inKey := make(map[string]bool, len(tbl.PK))
		for _, name := range tbl.PK {
			inKey[name] = true
		}

		for _, c := range tbl.Columns {
			null := c.Null && !inKey[c.Name]
			col := schema.NewColumn(c.Name).SetType(d.column(c.Type)).SetNull(null)
			if def := defaultOf(d, c); def != nil {
				col.SetDefault(def)
			}
			at.AddColumns(col)
		}
		// A table with no primary key stays without one. file_info is the case,
		// and it is what the migrations leave: 000041 was where one would have
		// been added, and the collapse reproduces rather than repairs.
		if len(tbl.PK) > 0 {
			pk := make([]*schema.Column, 0, len(tbl.PK))
			for _, name := range tbl.PK {
				col, ok := at.Column(name)
				if !ok {
					return nil, fmt.Errorf("%s: primary key names a column that is not there: %s", tbl.Name, name)
				}
				pk = append(pk, col)
			}
			at.SetPrimaryKey(schema.NewPrimaryKey(pk...))
		}
		for _, c := range tbl.Checks {
			col, ok := at.Column(c.Column)
			if !ok {
				return nil, fmt.Errorf("%s: check %s names a column that is not there: %s",
					tbl.Name, c.Name, c.Column)
			}
			at.AddChecks(schema.NewCheck().SetName(c.Name).SetExpr(checkExpr(d, c, col.Type.Null)))
		}
		built[tbl.Name] = at
		s.AddTables(at)
	}

	// Keys and indexes in a second pass: a foreign key may point at a table
	// declared after it.
	for _, tbl := range tables {
		at := built[tbl.Name]
		for _, fk := range tbl.FKs {
			target, ok := built[fk.RefTable]
			if !ok {
				target = ref(fk.RefTable)
			}
			k := schema.NewForeignKey(fk.Name).
				SetRefTable(target).
				SetOnDelete(schema.ReferenceOption(fk.OnDelete))
			for _, name := range fk.Columns {
				col, ok := at.Column(name)
				if !ok {
					return nil, fmt.Errorf("%s: foreign key %s names a column that is not there: %s", tbl.Name, fk.Name, name)
				}
				k.AddColumns(col)
			}
			for _, name := range fk.RefCols {
				col, ok := target.Column(name)
				if !ok {
					return nil, fmt.Errorf("%s: foreign key %s points at a column that is not there: %s.%s", tbl.Name, fk.Name, fk.RefTable, name)
				}
				k.AddRefColumns(col)
			}
			at.AddForeignKeys(k)
		}
		for _, idx := range tbl.Indexes {
			i := schema.NewIndex(idx.Name).SetUnique(idx.Unique)
			for _, name := range idx.Columns {
				col, ok := at.Column(name)
				if !ok {
					return nil, fmt.Errorf("%s: index %s names a column that is not there: %s", tbl.Name, idx.Name, name)
				}
				i.AddColumns(col)
			}
			at.AddIndexes(i)
		}
	}
	return s, nil
}

// renderUp renders the CREATE side for one dialect.
func renderUp(d dialect, tables []Table) (string, error) {
	s, err := build(d, tables)
	if err != nil {
		return "", err
	}
	changes := make([]schema.Change, 0, len(s.Tables))
	for _, t := range s.Tables {
		changes = append(changes, &schema.AddTable{T: t})
	}
	plan, err := d.plan.PlanChanges(context.Background(), "app_tables", changes)
	if err != nil {
		return "", err
	}

	// The comments are keyed by table so each CREATE keeps the paragraph that
	// says what the table is for. Atlas emits one statement per change in the
	// order they were given, so the mapping is positional and checked below.
	var b strings.Builder
	tableAt := map[string]Table{}
	for _, t := range tables {
		tableAt[t.Name] = t
	}
	for _, c := range plan.Changes {
		if add, ok := c.Source.(*schema.AddTable); ok {
			if t, ok := tableAt[add.T.Name]; ok {
				b.WriteString(comment(t.Why))
				b.WriteString(columnNotes(t))
			}
		}
		b.WriteString(c.Cmd)
		b.WriteString(";\n\n")
	}
	return b.String(), nil
}

// renderDown renders the DROP side, newest table first so a foreign key never
// outlives what it points at.
func renderDown(d dialect, tables []Table) (string, error) {
	s, err := build(d, tables)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	for i := len(s.Tables) - 1; i >= 0; i-- {
		changes := []schema.Change{&schema.DropTable{T: s.Tables[i]}}
		plan, err := d.plan.PlanChanges(context.Background(), "app_tables", changes)
		if err != nil {
			return "", err
		}
		for _, c := range plan.Changes {
			b.WriteString(c.Cmd)
			b.WriteString(";\n")
		}
	}
	return b.String(), nil
}

func comment(text string) string {
	if text == "" {
		return ""
	}
	var b strings.Builder
	for _, line := range strings.Split(text, "\n") {
		b.WriteString("-- ")
		b.WriteString(line)
		b.WriteString("\n")
	}
	return b.String()
}

// columnNotes carries a column's reasoning into the SQL, because the SQL is
// what somebody reads when they are looking at the database rather than at
// this generator.
func columnNotes(t Table) string {
	var b strings.Builder
	for _, c := range t.Columns {
		if c.Why == "" {
			continue
		}
		for i, line := range strings.Split(c.Why, "\n") {
			if i == 0 {
				fmt.Fprintf(&b, "--   %s: %s\n", c.Name, line)
				continue
			}
			fmt.Fprintf(&b, "--     %s\n", line)
		}
	}
	return b.String()
}
