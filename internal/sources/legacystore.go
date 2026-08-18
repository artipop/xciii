package sources

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"
)

// ImportLegacyStore carries a `sources.db` from before the move into the board's
// own database, once, and renames the file afterwards so it cannot be read
// twice. A missing file is the ordinary case and not an error.
//
// It reads the old schema — `source_event.id` an autoincrement, empty strings
// where absence was meant — because that is the only schema the file can have.
func ImportLegacyStore(db *sql.DB, path string) (rows int, err error) {
	old, err := openLegacy(path)
	if old == nil || err != nil {
		return 0, err
	}
	defer old.Close()

	s := &Store{db: db}
	// What a source decided outlives the card it produced — the keys onto blocks
	// here are SET NULL, not CASCADE — but a card id the board no longer has is
	// a dangling reference all the same, and the import must not write one. The
	// old file has no way of knowing: deleting a card is a real DELETE FROM
	// blocks and nothing ever told this side.
	known := map[string]bool{}
	hasCard := func(id string) bool {
		if id == "" {
			return false
		}
		if seen, ok := known[id]; ok {
			return seen
		}
		var one int
		seen := db.QueryRow(`SELECT 1 FROM blocks WHERE id=?`, id).Scan(&one) == nil
		known[id] = seen
		return seen
	}

	items, err := old.Query(`SELECT source, external_id, version, card_id, created_at, updated_at FROM source_item`)
	if err := skipMissingTable(err); err != nil {
		return 0, err
	}
	if items != nil {
		for items.Next() {
			var source, externalID, version, cardID string
			var created, updated int64
			if err := items.Scan(&source, &externalID, &version, &cardID, &created, &updated); err != nil {
				items.Close()
				return rows, err
			}
			if !hasCard(cardID) {
				cardID = ""
			}
			if _, err := s.exec(`INSERT INTO source_item (source, external_id, version, card_id, created_at, updated_at)
				VALUES (?,?,?,?,?,?) ON CONFLICT(source, external_id) DO NOTHING`,
				source, externalID, nullable(version), nullable(cardID), created, updated); err != nil {
				items.Close()
				return rows, err
			}
			rows++
		}
		err = items.Err()
		items.Close()
		if err != nil {
			return rows, err
		}
	}

	// Ordered by the old autoincrement so the new UUIDv7 ids come out in the
	// same order: the log is read newest first, and that has to keep meaning
	// what it meant.
	events, err := old.Query(`SELECT source, external_id, rule, outcome, card_id, detail, created_at
		FROM source_event ORDER BY id`)
	if err := skipMissingTable(err); err != nil {
		return rows, err
	}
	if events != nil {
		for events.Next() {
			var source, externalID, rule, outcome, cardID, detail string
			var created int64
			if err := events.Scan(&source, &externalID, &rule, &outcome, &cardID, &detail, &created); err != nil {
				events.Close()
				return rows, err
			}
			if !hasCard(cardID) {
				cardID = ""
			}
			if _, err := s.exec(`INSERT INTO source_event (id, source, external_id, rule, outcome, card_id, detail, created_at)
				VALUES (?,?,?,?,?,?,?,?)`,
				newID(), source, nullable(externalID), nullable(rule), outcome,
				nullable(cardID), nullable(detail), created); err != nil {
				events.Close()
				return rows, err
			}
			rows++
		}
		err = events.Err()
		events.Close()
		if err != nil {
			return rows, err
		}
	}

	if err := old.Close(); err != nil {
		return rows, err
	}
	return rows, os.Rename(path, path+".migrated")
}

func openLegacy(path string) (*sql.DB, error) {
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	driver, ok := sqliteDriver()
	if !ok {
		return nil, fmt.Errorf("cannot read the previous sources database %s: no SQLite driver in this build", path)
	}
	db, err := sql.Open(driver, path+"?_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("cannot read the previous sources database %s: %w", path, err)
	}
	return db, nil
}

// sqliteDriver is whichever SQLite driver this build registered: cgo mattn
// under the `sqlite3` tag, pure-Go modernc otherwise.
func sqliteDriver() (string, bool) {
	registered := sql.Drivers()
	for _, name := range []string{"sqlite3", "sqlite"} {
		if slices.Contains(registered, name) {
			return name, true
		}
	}
	return "", false
}

// nullable turns the old schema's empty strings back into absence: a card that
// was never made is NULL, not "".
func nullable(v string) any {
	if v == "" {
		return nil
	}
	return v
}

// skipMissingTable lets a file written by an older build through.
func skipMissingTable(err error) error {
	if err == nil {
		return nil
	}
	if strings.Contains(err.Error(), "no such table") || strings.Contains(err.Error(), "no such column") {
		return nil
	}
	return err
}
