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

// migration is the one that creates the schema — the whole of it, the fork's
// tables and ours, since the ladder was collapsed (docs/store-plan.md, step 0).
// Named rather than searched for, so that renaming it fails loudly here instead
// of quietly matching nothing.
const migration = "migrations/000001_init.up.sql"

// The board's own tables used to be stubbed here, because the migration that
// made ours did not make them. Since the collapse there is one migration and it
// makes everything, so a test database is now the real schema — which is
// strictly better: a fixture that inserts a card inserts it into the same
// blocks table the application uses.

// Open makes a SQLite database at path with the application's tables in it,
// with the foreign keys written but not enforced.
//
// Not enforced because a test is about behaviour, not about bookkeeping: the
// fixtures name cards like "card-1" and boards like "board1", which no board
// ever had, and making every one of them insert a row into blocks first would
// turn each test into a small model of the board and test the model. In the
// application the cards are real, so the constraint costs nothing there.
//
// What the constraint itself does is tested where it belongs, on a database
// opened with OpenEnforcing.
func Open(path string) (*sql.DB, error) {
	ddl, err := SQLite("")
	if err != nil {
		return nil, err
	}
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

// OpenEnforcing is Open with the keys enforced, through the same DSN helper the
// application uses — so a test of the constraints cannot pass on a rule the app
// does not actually apply.
func OpenEnforcing(path string) (*sql.DB, error) {
	db, err := Open(path)
	if err != nil {
		return nil, err
	}
	if err := db.Close(); err != nil {
		return nil, err
	}
	return sql.Open("sqlite3", sqlstore.SQLiteDSN(path))
}

// AddCard puts a card on the board, which is all this side ever needs to know
// about one: our tables reference it by id and read nothing else off it.
func AddCard(db *sql.DB, boardID, cardID string) error {
	if err := AddBoard(db, boardID); err != nil {
		return err
	}
	_, err := db.Exec(`INSERT INTO blocks (id, board_id, type) VALUES (?,?,'card') ON CONFLICT(id) DO NOTHING`,
		cardID, boardID)
	return err
}

// AddBoard puts a board in the database, filling in the columns the board's own
// schema insists on. Since the migrations were collapsed these tables are the
// real ones rather than stubs, so a fixture has to make a board a board: one
// team ('0', the only one this product has), a type, and a title.
func AddBoard(db *sql.DB, boardID string) error {
	_, err := db.Exec(`INSERT INTO boards (id, team_id, type, title, minimum_role)
		VALUES (?, '0', 'P', ?, '') ON CONFLICT(id) DO NOTHING`, boardID, boardID)
	return err
}
