package sources

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/artipop/xciii/internal/appschema"
)

// An install that predates the move keeps its dedup — which is the half that
// matters here: losing it means every letter a source has ever brought arrives
// again as a new card.
func TestASourcesDatabaseFromBeforeTheMoveIsCarriedOver(t *testing.T) {
	driver, ok := sqliteDriver()
	if !ok {
		t.Skip("no SQLite driver in this build")
	}
	dir := t.TempDir()
	legacy := filepath.Join(dir, "sources.db")

	old, err := sql.Open(driver, legacy)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := old.Exec(`
CREATE TABLE source_item (source TEXT NOT NULL, external_id TEXT NOT NULL, version TEXT NOT NULL DEFAULT '',
	card_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
	PRIMARY KEY (source, external_id));
CREATE TABLE source_event (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL,
	external_id TEXT NOT NULL DEFAULT '', rule TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL,
	card_id TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);

INSERT INTO source_item VALUES ('почта','msg-1','v2','card-1',1000,2000);
INSERT INTO source_item VALUES ('почта','msg-2','','',1000,1000);
INSERT INTO source_event (source, external_id, rule, outcome, card_id, detail, created_at)
	VALUES ('почта','msg-1','правило','created','card-1','',1000);
INSERT INTO source_event (source, external_id, rule, outcome, card_id, detail, created_at)
	VALUES ('почта','msg-2','','dropped','','ничего не подошло',1001);
`); err != nil {
		t.Fatal(err)
	}
	old.Close()

	db, err := appschema.Open(filepath.Join(dir, "xciii.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if err := appschema.AddCard(db, "board-1", "card-1"); err != nil {
		t.Fatal(err)
	}

	if n, err := ImportLegacyStore(db, legacy); err != nil || n != 4 {
		t.Fatalf("carried %d rows: %v", n, err)
	}

	st := NewStore(db)
	if state, cardID, err := st.StateOf("почта", "msg-1", "v2"); err != nil || state != ItemSeen || cardID != "card-1" {
		t.Errorf("a letter already brought looks new: %v %q %v", state, cardID, err)
	}
	if state, _, err := st.StateOf("почта", "msg-1", "v3"); err != nil || state != ItemChanged {
		t.Errorf("a changed letter is not recognised: %v %v", state, err)
	}

	events, err := st.Events("почта", 10)
	if err != nil {
		t.Fatal(err)
	}
	// Newest first is what the log means, and the old ids were an autoincrement
	// while the new ones are UUIDv7: the order has to survive the change of key.
	if len(events) != 2 || events[0].Outcome != "dropped" || events[1].Outcome != "created" {
		t.Fatalf("the log came back wrong: %+v", events)
	}

	if _, err := os.Stat(legacy + ".migrated"); err != nil {
		t.Errorf("the old file was not kept: %v", err)
	}
}

// What a source decided is a fact about the source and survives the card, so
// these rows are carried — but a card id the board no longer has is a dangling
// reference all the same, and it arrives as absence.
func TestASourceLogAboutADeletedCardArrivesWithoutIt(t *testing.T) {
	driver, ok := sqliteDriver()
	if !ok {
		t.Skip("no SQLite driver in this build")
	}
	dir := t.TempDir()
	legacy := filepath.Join(dir, "sources.db")

	old, err := sql.Open(driver, legacy)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := old.Exec(`
CREATE TABLE source_item (source TEXT NOT NULL, external_id TEXT NOT NULL, version TEXT NOT NULL DEFAULT '',
	card_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
	PRIMARY KEY (source, external_id));
CREATE TABLE source_event (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL,
	external_id TEXT NOT NULL DEFAULT '', rule TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL,
	card_id TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
INSERT INTO source_item VALUES ('почта','msg-9','v1','card-удалена',1000,1000);
INSERT INTO source_event (source, external_id, rule, outcome, card_id, detail, created_at)
	VALUES ('почта','msg-9','','created','card-удалена','',1000);
`); err != nil {
		t.Fatal(err)
	}
	old.Close()

	db, err := appschema.Open(filepath.Join(dir, "xciii.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if _, err := ImportLegacyStore(db, legacy); err != nil {
		t.Fatal(err)
	}

	// The dedup is the half that matters: the letter is still known, so it does
	// not arrive again as a new card.
	if state, cardID, err := NewStore(db).StateOf("почта", "msg-9", "v1"); err != nil || state != ItemSeen || cardID != "" {
		t.Errorf("dedup lost or a deleted card carried in: %v %q %v", state, cardID, err)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM source_event WHERE card_id IS NOT NULL`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Errorf("the log kept %d references to a card the board has not got", count)
	}
}
