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
				default:
					return &schema.IntegerType{T: "bigint"}
				}
			},
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
				default:
					return &schema.IntegerType{T: "bigint"}
				}
			},
			attrs: []schema.Attr{
				&schema.Charset{V: "utf8mb4"},
				&schema.Collation{V: "utf8mb4_general_ci"},
			},
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
				default:
					return &schema.IntegerType{T: "bigint"}
				}
			},
		},
	}
}

// idLen is the width of an id as the board stores one: VARCHAR(36), holding the
// 27 characters Utils.createGuid makes. Ours must match it to the character —
// MySQL refuses a foreign key whose column type differs from the one it points
// at, and that is exactly why our ids and the board's cannot become UUIDv7
// separately.
const idLen = 36

// prefixed puts the table prefix in front of a name as a template action. The
// migration is rendered by text/template before any database parses it, so the
// action can sit inside a quoted identifier: `{{.prefix}}conversation` comes
// out as `focalboard_conversation` or as `conversation`, and either is a legal
// identifier in all three dialects.
func prefixed(name string) string { return "{{.prefix}}" + name }

// indexName puts the prefix where the board's own migrations put it — after
// the idx_ — so `idx_focalboard_conversation_card` reads the same way as the
// eighty index names already in this database.
func indexName(name string) string {
	return "idx_" + prefixed(strings.TrimPrefix(name, "idx_"))
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
		t := schema.NewTable(prefixed(name)).
			AddColumns(schema.NewColumn("id").SetType(d.column(ID())))
		t.SetPrimaryKey(schema.NewPrimaryKey(t.Columns[0]))
		refs[name] = t
		return t
	}

	built := map[string]*schema.Table{}
	for _, tbl := range tables {
		at := schema.NewTable(prefixed(tbl.Name))
		at.AddAttrs(d.attrs...)
		for _, c := range tbl.Columns {
			at.AddColumns(schema.NewColumn(c.Name).SetType(d.column(c.Type)).SetNull(c.Null))
		}
		pk := make([]*schema.Column, 0, len(tbl.PK))
		for _, name := range tbl.PK {
			col, ok := at.Column(name)
			if !ok {
				return nil, fmt.Errorf("%s: primary key names a column that is not there: %s", tbl.Name, name)
			}
			pk = append(pk, col)
		}
		at.SetPrimaryKey(schema.NewPrimaryKey(pk...))
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
			i := schema.NewIndex(indexName(idx.Name)).SetUnique(idx.Unique)
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
		tableAt[prefixed(t.Name)] = t
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
