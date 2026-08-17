package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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
			if !strings.Contains(sql, "CREATE TABLE") || !strings.Contains(sql, prefixed(tbl.Name)) {
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
