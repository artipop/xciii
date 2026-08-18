package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

// The checked-in migration is what runs; this generator is only how it was
// written. A change to the schema that nobody regenerated would be a schema
// nobody applied, and it would be invisible in review — the SQL in the diff
// would still look right.
func TestTheCheckedInMigrationIsWhatTheSchemaSays(t *testing.T) {
	up, down, err := render()
	if err != nil {
		t.Fatal(err)
	}
	root, err := moduleRoot()
	if err != nil {
		t.Fatal(err)
	}
	for name, want := range map[string]string{
		migrationName + ".up.sql":   up,
		migrationName + ".down.sql": down,
	} {
		got, err := os.ReadFile(filepath.Join(root, migrationsDir, name))
		if err != nil {
			t.Fatalf("%s: %v (run `go generate ./tools/schemagen`)", name, err)
		}
		if string(got) != want {
			t.Errorf("%s is out of date — run `go generate ./tools/schemagen`", name)
		}
	}
}

// Every dialect has to say the same thing about the same table, or the three
// databases are three different products. This is the cheapest form of that
// check: the same tables, named, in the same order.
func TestEveryDialectCreatesEveryTable(t *testing.T) {
	tables := appTables()
	for _, d := range dialects() {
		sql, err := renderUp(d, tables)
		if err != nil {
			t.Fatalf("%s: %v", d.name, err)
		}
		for _, tbl := range tables {
			if !strings.Contains(sql, "CREATE TABLE") || !strings.Contains(sql, tbl.Name) {
				t.Errorf("%s does not create %s", d.name, tbl.Name)
			}
		}
	}
}

// A foreign key onto the board's own tables is the whole reason our tables
// moved into its database: a deleted card used to leave its conversations, its
// stall and its place in the queue behind for ever.
func TestWhatBelongsToACardGoesWithIt(t *testing.T) {
	byName := map[string]Table{}
	for _, t := range appTables() {
		byName[t.Name] = t
	}
	for _, name := range []string{
		"conversation", "agent_session", "flow_state", "flow_event",
		"card_stall", "stage_queue",
	} {
		tbl, ok := byName[name]
		if !ok {
			t.Fatalf("no table %s", name)
		}
		var found bool
		for _, fk := range tbl.FKs {
			if fk.RefTable == tableBlocks && fk.OnDelete == Cascade {
				found = true
			}
		}
		if !found {
			t.Errorf("%s does not follow its card into the bin", name)
		}
	}
}

// What a source decided is a fact about the source, and it stays true after
// the card it produced is deleted.
func TestASourcesLogOutlivesTheCard(t *testing.T) {
	for _, tbl := range appTables() {
		if tbl.Name != "source_event" && tbl.Name != "source_item" {
			continue
		}
		for _, fk := range tbl.FKs {
			if fk.RefTable == tableBlocks && fk.OnDelete != SetNull {
				t.Errorf("%s.%s deletes the row rather than forgetting the card", tbl.Name, fk.Name)
			}
		}
	}
}

// MySQL will not have TEXT in a key, and it caps a composite key at about 750
// utf8mb4 characters. Both are silent on SQLite and both would be found by
// somebody else, on the one database we do not run.
func TestNoKeyIsWiderThanMySQLAllows(t *testing.T) {
	const innoDBKeyBytes = 3072
	const bytesPerChar = 4
	for _, tbl := range appTables() {
		byName := map[string]Column{}
		for _, c := range tbl.Columns {
			byName[c.Name] = c
		}
		total := 0
		for _, name := range tbl.PK {
			c := byName[name]
			switch c.Type.kind {
			case KindText, KindJSON:
				t.Errorf("%s: %s is free text and cannot be part of a key", tbl.Name, name)
			case KindID:
				total += idLen
			case KindName:
				total += c.Type.size
			default:
				total += 8 / bytesPerChar
			}
		}
		if total*bytesPerChar > innoDBKeyBytes {
			t.Errorf("%s: primary key is %d characters, more than InnoDB will index", tbl.Name, total)
		}
	}
}

// The collapsed migration has to build the schema the eighty-one it replaced
// built. That is the entire claim the collapse rests on — an existing database
// is left alone precisely because it already has this schema — and it is the
// kind of claim that is worth checking rather than believing.
//
// Checked by shape rather than by text: SQLite reports a UNIQUE constraint as an
// anonymous autoindex and a CREATE UNIQUE INDEX under its own name, and the two
// enforce the same thing. Columns, types, nullability, defaults, primary keys
// and what each index covers all have to match.
//
// The reference is a database built by the old ladder, kept as a fixture because
// the ladder itself is gone: it cannot be rebuilt from this tree any more, which
// is exactly why the snapshot of what it produced is worth keeping.
func TestTheCollapsedMigrationBuildsTheSchemaTheLadderBuilt(t *testing.T) {
	root, err := moduleRoot()
	if err != nil {
		t.Fatal(err)
	}
	reference := filepath.Join(root, "tools", "schemagen", "testdata", "schema_before_collapse.sql")
	want, err := os.ReadFile(reference)
	if err != nil {
		t.Skipf("no snapshot of the pre-collapse schema: %v", err)
	}

	got, err := renderUp(dialects()[0], append(boardTables(), appTables()...))
	if err != nil {
		t.Fatal(err)
	}
	gotShape := shapeOf(t, got)
	wantShape := shapeOf(t, string(want))

	// The tables this schema deliberately differs from the ladder on, and why.
	// Declared here rather than by editing the snapshot: the snapshot is what
	// the ladder built and it stays true, so every deviation stays visible.
	intendedTables := map[string][]string{
		// Widened: utils.NewID was already overflowing varchar(26) by one
		// character, and UUIDv7 needs 36.
		"table file_info": {"id widened to hold the ids actually written to it"},
		// Four dead columns dropped, each with the code that fed it. See the
		// note at the top of board.go.
		"table blocks":             {deadColumns, tightenedKey},
		"table blocks_history":     {deadColumns},
		"table sharing":            {deadColumns, tightenedKey},
		"table subscriptions":      {deadColumns, tightenedKey},
		"table notification_hints": {deadColumns, tightenedKey},
		// Key columns the ladder left nullable on SQLite alone.
		"table users":           {tightenedKey},
		"table sessions":        {tightenedKey},
		"table teams":           {tightenedKey},
		"table system_settings": {tightenedKey},
	}

	for name, w := range wantShape {
		g, ok := gotShape[name]
		if !ok {
			t.Errorf("the collapsed schema has no %s", name)
			continue
		}
		if g != w {
			if why, ok := intendedTables[name]; ok {
				t.Logf("%s differs on purpose — %s", name, strings.Join(why, "; "))
				continue
			}
			t.Errorf("%s differs\n  ladder:    %s\n  collapsed: %s", name, w, g)
		}
	}
	for name := range gotShape {
		if _, ok := wantShape[name]; !ok {
			t.Errorf("the collapsed schema adds %s, which the ladder never made", name)
		}
	}
}

// deadColumns is why five tables are narrower than the ladder left them.
const deadColumns = "a remnant column dropped: root_id (always equal to " +
	"board_id, written only by the legacy block store nothing called) or " +
	"workspace_id (older than channel_id, named by no query for years)"

// tightenedKey is why some tables' key columns are NOT NULL where the ladder
// left them nullable. It is the one departure that is not a choice: MySQL
// refuses a nullable column in a PRIMARY KEY outright, so the ladder's SQLite
// shape is not a schema MySQL can be given at all. See build() in render.go.
const tightenedKey = "a primary key column tightened to NOT NULL, which MySQL requires"

// shapeOf is what a table is, as SQLite itself reports it after the DDL has been
// applied — which normalises away everything that is spelling rather than
// meaning.
func shapeOf(t *testing.T, ddl string) map[string]string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "schema.db")
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(ddl); err != nil {
		t.Fatalf("the DDL would not apply: %v", err)
	}

	out := map[string]string{}
	tables, err := db.Query(
		`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'schema_migrations'`)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for tables.Next() {
		var name string
		if err := tables.Scan(&name); err != nil {
			t.Fatal(err)
		}
		names = append(names, name)
	}
	tables.Close()

	for _, name := range names {
		var parts []string
		cols, err := db.Query(`SELECT name, type, "notnull", COALESCE(dflt_value,''), pk FROM pragma_table_info(?)`, name)
		if err != nil {
			t.Fatal(err)
		}
		for cols.Next() {
			var cname, ctype, dflt string
			var notnull, pk int
			if err := cols.Scan(&cname, &ctype, &notnull, &dflt, &pk); err != nil {
				t.Fatal(err)
			}
			parts = append(parts, fmt.Sprintf("%s:%s:%d:%s:%d",
				cname, normalizeType(ctype), notnull, normalizeDefault(dflt), pk))
		}
		cols.Close()

		var idx []string
		rows, err := db.Query(`SELECT name, "unique", origin FROM pragma_index_list(?)`, name)
		if err != nil {
			t.Fatal(err)
		}
		type indexRow struct {
			name   string
			unique int
			origin string
		}
		var found []indexRow
		for rows.Next() {
			var r indexRow
			if err := rows.Scan(&r.name, &r.unique, &r.origin); err != nil {
				t.Fatal(err)
			}
			found = append(found, r)
		}
		rows.Close()
		for _, r := range found {
			if r.origin == "pk" {
				continue
			}
			icols, err := db.Query(`SELECT name FROM pragma_index_info(?)`, r.name)
			if err != nil {
				t.Fatal(err)
			}
			var on []string
			for icols.Next() {
				var c string
				if err := icols.Scan(&c); err != nil {
					t.Fatal(err)
				}
				on = append(on, c)
			}
			icols.Close()
			idx = append(idx, fmt.Sprintf("(%s):%d", strings.Join(on, ","), r.unique))
		}
		sort.Strings(idx)
		out["table "+name] = strings.Join(parts, " ") + " | " + strings.Join(idx, " ")
	}
	return out
}

// normalizeType folds the spellings that mean the same thing to SQLite, which
// records the declared type verbatim and applies affinity rules to it.
func normalizeType(t string) string {
	t = strings.ToLower(strings.ReplaceAll(t, " ", ""))
	t = regexp.MustCompile(`^varchar\(\d+\)$`).ReplaceAllString(t, "varchar")
	if t == "int" {
		t = "integer"
	}
	return t
}

func normalizeDefault(d string) string {
	return strings.Trim(strings.ToLower(strings.ReplaceAll(d, " ", "")), "()")
}

// Column widths are checked separately, and they have to be: SQLite ignores
// them, so atlas does not even emit them there — which means the shape check
// above cannot see a varchar(64) that has become a varchar(32). On MySQL and
// Postgres that difference silently truncates somebody's data, and those are the
// two dialects nothing here can run. This is the only thing standing between a
// typo and a schema nobody would notice was wrong.
func TestTheColumnWidthsAreTheOnesTheLadderDeclared(t *testing.T) {
	root, err := moduleRoot()
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile(filepath.Join(root, "tools", "schemagen", "testdata", "schema_before_collapse.sql"))
	if err != nil {
		t.Skipf("no snapshot of the pre-collapse schema: %v", err)
	}

	// Where this schema deliberately differs from the ladder's. Declared here,
	// with the reason, rather than by editing the snapshot: the snapshot is what
	// the ladder built, and it stays true.
	intended := map[string]string{
		"file_info.id": "was too narrow for the 27-character ids already going into it, " +
			"and is now 36 for UUIDv7",
	}

	declared := widthsInDDL(string(want))
	if len(declared) < 50 {
		t.Fatalf("only %d widths read out of the snapshot; the parser has stopped working", len(declared))
	}
	for _, tbl := range append(boardTables(), appTables()...) {
		for _, c := range tbl.Columns {
			key := tbl.Name + "." + c.Name
			was, ok := declared[key]
			if !ok {
				continue // a column the snapshot has not got is the shape check's business
			}
			var is int
			switch c.Type.kind {
			case KindID:
				is = idLen
			case KindName:
				is = c.Type.size
			default:
				continue // only the sized types have a width to get wrong
			}
			if is == was {
				continue
			}
			if why, ok := intended[key]; ok {
				t.Logf("%s: varchar(%d) rather than the ladder's varchar(%d) — %s", key, is, was, why)
				continue
			}
			t.Errorf("%s is varchar(%d), and the ladder declared varchar(%d)", key, is, was)
		}
	}
}

// widthsInDDL reads `name varchar(n)` out of every CREATE TABLE in the snapshot,
// as table.column → n.
func widthsInDDL(ddl string) map[string]int {
	out := map[string]int{}
	tableAt := regexp.MustCompile(`(?i)^\s*CREATE TABLE(?: IF NOT EXISTS)?\s+"?(\w+)"?`)
	anyColumn := regexp.MustCompile(`(?i)"?(\w+)"?\s+varchar\((\d+)\)`)
	table := ""
	for _, line := range strings.Split(ddl, "\n") {
		if m := tableAt.FindStringSubmatch(line); m != nil {
			table = m[1]
			// A one-line CREATE carries its columns on the same line.
			for _, cm := range anyColumn.FindAllStringSubmatch(line, -1) {
				out[table+"."+cm[1]] = atoi(cm[2])
			}
			continue
		}
		if table == "" {
			continue
		}
		if m := anyColumn.FindStringSubmatch(line); m != nil {
			out[table+"."+m[1]] = atoi(m[2])
		}
		if strings.Contains(line, ");") {
			table = ""
		}
	}
	return out
}

func atoi(s string) int {
	n := 0
	for _, r := range s {
		n = n*10 + int(r-'0')
	}
	return n
}

// A table nobody drew is a table nobody reads about, and the diagram is the
// page somebody opens to find out what the database holds. The groups are
// hand-written — which tables belong together is a judgement, not something
// the schema knows — so this is what catches a new table added to schema.go
// and not to erdGroups.
func TestEveryTableIsOnTheDiagram(t *testing.T) {
	drawn := map[string]bool{}
	for _, g := range erdGroups() {
		for _, tbl := range g.tables {
			if drawn[tbl.Name] {
				t.Errorf("%s is drawn in more than one group", tbl.Name)
			}
			drawn[tbl.Name] = true
		}
	}
	for _, tbl := range append(boardTables(), appTables()...) {
		if !drawn[tbl.Name] {
			t.Errorf("%s is in the schema but on no diagram — add it to erdGroups", tbl.Name)
		}
	}
}

// The generated page is checked in, so it is what a reader opens; this fails
// when somebody changes the schema and does not run the generator, exactly as
// the migration check does.
func TestTheDiagramOnDiskIsTheOneTheSchemaDescribes(t *testing.T) {
	root, err := moduleRoot()
	if err != nil {
		t.Fatal(err)
	}
	want := renderERDDoc()
	got, err := os.ReadFile(filepath.Join(root, erdPath))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != want {
		t.Errorf("%s is stale — run `go generate ./tools/schemagen`", erdPath)
	}
}

// The HCL on disk is the same rendering, for the same reason as the diagram.
func TestTheHCLOnDiskIsTheOneTheSchemaDescribes(t *testing.T) {
	root, err := moduleRoot()
	if err != nil {
		t.Fatal(err)
	}
	want, err := renderHCL()
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(root, hclPath))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != want {
		t.Errorf("%s is stale — run `go generate ./tools/schemagen`", hclPath)
	}
}
