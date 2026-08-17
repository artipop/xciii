// Package appschema opens a database with this application's own tables in it,
// for tests and for tools.
//
// It exists because the tables moved: internal/acp and internal/sources used to
// create their own SQLite files and so could open one anywhere, and now their
// schema is a rung on the board's migration ladder. A test that wants a store
// needs that rung, and the one thing it must not do is carry a second copy of
// the DDL — a copy is a schema that drifts, and drift here is exactly the class
// of bug docs/store-plan.md is about.
//
// So it renders the migration itself. The SQL is the file the application runs,
// read out of the same embedded filesystem, through the same template.
//
// Nothing in the running application uses this: the app's tables are made by
// the migration engine on the board's own database.
package appschema

import (
	"bytes"
	"database/sql"
	"fmt"
	"io/fs"
	"strings"
	"text/template"

	_ "github.com/mattn/go-sqlite3" // the driver a test's scratch database needs

	"github.com/artipop/xciii/server/services/store/sqlstore"
)

// migration is the rung that creates the application's own tables. Named
// rather than searched for: when it is folded into a collapsed 000001_init
// (docs/store-plan.md, step 0) this is the one line that has to change, and it
// should fail loudly rather than quietly matching nothing.
const migration = "migrations/000041_app_tables.up.sql"

// boardStubs are the two board tables our foreign keys point at, reduced to the
// one column those keys name. The real ones are made by migration 000001 and
// have thirty columns between them; nothing on this side reads any of the
// others, and a test that needed them would be a test of the board.
//
// They are here rather than left out because the import of a pre-move database
// asks the board whether a card still exists — which is what stops it writing a
// dangling reference — and "there is no blocks table" is not an answer.
const boardStubs = `
CREATE TABLE IF NOT EXISTS boards (id VARCHAR(36) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS blocks (id VARCHAR(36) PRIMARY KEY, board_id VARCHAR(36));
`

// Open makes a SQLite database at path with the application's tables in it.
//
// The foreign keys onto blocks and boards resolve, but nothing enforces them:
// `foreign_keys` is off, here as in the application, until step 4 of
// docs/store-plan.md turns it on.
func Open(path string) (*sql.DB, error) {
	ddl, err := SQLite("")
	if err != nil {
		return nil, err
	}
	ddl = boardStubs + ddl
	db, err := sql.Open("sqlite3", path+"?_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	// Opening the same file twice is what a test does when it checks that
	// something survives a restart, and the migration is not written to be run
	// twice — the board's engine runs it once and records that it did. Here
	// there is no engine, so the check is a look at what is already there.
	made, err := alreadyMade(db)
	if err != nil {
		db.Close()
		return nil, err
	}
	if made {
		return db, nil
	}
	if _, err := db.Exec(ddl); err != nil {
		db.Close()
		return nil, fmt.Errorf("creating the application's tables: %w", err)
	}
	return db, nil
}

func alreadyMade(db *sql.DB) (bool, error) {
	var name string
	err := db.QueryRow(`SELECT name FROM sqlite_master WHERE type='table' AND name='conversation'`).Scan(&name)
	switch {
	case err == sql.ErrNoRows:
		return false, nil
	case err != nil:
		return false, err
	}
	return true, nil
}

// SQLite renders the migration for SQLite and the given table prefix — the
// same rendering the board's own migration source performs, minus the engine
// that runs it.
func SQLite(tablePrefix string) (string, error) {
	asset, err := fs.ReadFile(sqlstore.Assets, migration)
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", migration, err)
	}
	tmpl, err := template.New("schema").Parse(string(asset))
	if err != nil {
		return "", err
	}
	var out bytes.Buffer
	if err := tmpl.Execute(&out, map[string]any{
		"prefix":   tablePrefix,
		"sqlite":   true,
		"mysql":    false,
		"postgres": false,
	}); err != nil {
		return "", err
	}
	if !strings.Contains(out.String(), "CREATE TABLE") {
		return "", fmt.Errorf("%s rendered nothing for SQLite", migration)
	}
	return out.String(), nil
}

// AddCard puts a card on the board, which is all this side ever needs to know
// about one: our tables reference it by id and read nothing else off it.
func AddCard(db *sql.DB, boardID, cardID string) error {
	if err := AddBoard(db, boardID); err != nil {
		return err
	}
	_, err := db.Exec(`INSERT INTO blocks (id, board_id) VALUES (?,?) ON CONFLICT(id) DO NOTHING`, cardID, boardID)
	return err
}

// AddBoard puts a board in the database.
func AddBoard(db *sql.DB, boardID string) error {
	_, err := db.Exec(`INSERT INTO boards (id) VALUES (?) ON CONFLICT(id) DO NOTHING`, boardID)
	return err
}
