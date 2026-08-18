// Package appschema opens a database with this application's own tables in it,
// for tests and for tools.
//
// It exists because the tables moved: internal/acp and internal/sources used to
// create their own SQLite files and so could open one anywhere, and now their
// schema is a rung on the board's migration ladder. A test that wants a store
// needs that rung, and the one thing it must not do is carry a second copy of
// the DDL — a copy is a schema that drifts, and drift here is exactly the class
// of bug docs/model-graph.md is about.
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
// tables and ours, since the ladder was collapsed into it.
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
	ddl, err := SQLite()
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

// SQLite renders the migration for SQLite — the same rendering the board's own
// migration source performs, minus the engine that runs it.
func SQLite() (string, error) {
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

// OpenEnforcing is Open with the foreign keys enforced.
//
// The DSN is spelled for the driver *this package* registers, which is
// mattn/go-sqlite3 and is imported above with no build tag. sqlstore.SQLiteDSN
// looks like the right thing to call and is not: it is tag-selected beside the
// import that chooses the application's driver, so in a build without
// `-tags sqlite3` it answers with modernc's `_pragma=foreign_keys(1)` while the
// driver actually open here is still mattn, which ignores it. The keys were
// then off, and three cascade tests failed for a reason that had nothing to do
// with the constraints they were testing.
//
// The pragma is verified rather than assumed, because that mismatch was silent:
// a DSN parameter a driver does not recognise is not an error, it is nothing.
func OpenEnforcing(path string) (*sql.DB, error) {
	db, err := Open(path)
	if err != nil {
		return nil, err
	}
	if err := db.Close(); err != nil {
		return nil, err
	}
	enforcing, err := sql.Open("sqlite3", addParam(path, "_foreign_keys", "on"))
	if err != nil {
		return nil, err
	}
	var on int
	if err := enforcing.QueryRow("PRAGMA foreign_keys").Scan(&on); err != nil {
		_ = enforcing.Close()
		return nil, fmt.Errorf("reading back the foreign key pragma: %w", err)
	}
	if on != 1 {
		_ = enforcing.Close()
		return nil, fmt.Errorf("the sqlite driver did not take the foreign key setting from the DSN")
	}
	return enforcing, nil
}

// addParam appends one DSN setting, minding whether there is a query already.
func addParam(dsn, key, value string) string {
	if strings.Contains(dsn, key) {
		return dsn
	}
	sep := "?"
	if strings.Contains(dsn, "?") {
		sep = "&"
	}
	return dsn + sep + key + "=" + value
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
