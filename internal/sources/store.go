package sources

import (
	"database/sql"
	"os"
	"path/filepath"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// Store keeps what has already been seen and what came of it, in a SQLite
// database of its own — separate from the board's and from the ACP one, so a
// source works with the agent integration switched off.
type Store struct {
	db *sql.DB
}

// OpenStore opens (creating if needed) the sources database at path.
func OpenStore(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite3", path+"?_busy_timeout=5000&_journal_mode=WAL")
	if err != nil {
		return nil, err
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) migrate() error {
	// Additive and idempotent, like the ACP schema: there is no version column,
	// so a migration may only add.
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS source_item (
	source TEXT NOT NULL,
	external_id TEXT NOT NULL,
	version TEXT NOT NULL DEFAULT '',
	card_id TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	PRIMARY KEY (source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_source_item_card ON source_item(card_id);
CREATE TABLE IF NOT EXISTS source_event (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	source TEXT NOT NULL,
	external_id TEXT NOT NULL DEFAULT '',
	rule TEXT NOT NULL DEFAULT '',
	outcome TEXT NOT NULL,
	card_id TEXT NOT NULL DEFAULT '',
	detail TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_event_source ON source_event(source, id);`)
	return err
}

func (s *Store) Close() error { return s.db.Close() }

// ItemState says what an item is: never seen, seen in another state, or exactly
// what is already recorded.
type ItemState string

const (
	ItemNew     ItemState = "new"
	ItemChanged ItemState = "changed"
	ItemSeen    ItemState = "seen"
)

// StateOf reports what the store knows about an item, and the card it produced
// if it produced one.
//
// It only reads. Recording happens after the card exists (RememberItem), so an
// item lost to a failed write comes back on the next delivery instead of being
// marked as handled and never seen again.
func (s *Store) StateOf(source, externalID, version string) (ItemState, string, error) {
	var seenVersion, cardID string
	err := s.db.QueryRow(`SELECT version, card_id FROM source_item WHERE source=? AND external_id=?`,
		source, externalID).Scan(&seenVersion, &cardID)
	switch {
	case err == sql.ErrNoRows:
		return ItemNew, "", nil
	case err != nil:
		return "", "", err
	case seenVersion == version:
		return ItemSeen, cardID, nil
	default:
		return ItemChanged, cardID, nil
	}
}

// RememberItem records an item and the card it belongs to. Called once the
// board write has succeeded.
func (s *Store) RememberItem(source, externalID, version, cardID string) error {
	now := time.Now().UnixMilli()
	_, err := s.db.Exec(`INSERT INTO source_item (source, external_id, version, card_id, created_at, updated_at)
		VALUES (?,?,?,?,?,?)
		ON CONFLICT(source, external_id) DO UPDATE SET
			version=excluded.version, card_id=excluded.card_id, updated_at=excluded.updated_at`,
		source, externalID, version, cardID, now, now)
	return err
}

// ForgetSource drops everything a removed source left behind, so a source
// created again under the same name starts clean rather than silently ignoring
// everything it brings.
func (s *Store) ForgetSource(source string) error {
	if _, err := s.db.Exec(`DELETE FROM source_item WHERE source=?`, source); err != nil {
		return err
	}
	_, err := s.db.Exec(`DELETE FROM source_event WHERE source=?`, source)
	return err
}

// Outcomes an event can record.
const (
	OutcomeCreated   = "created"
	OutcomeCommented = "commented"
	OutcomeInbox     = "inbox"
	OutcomeDropped   = "dropped"
	OutcomeFailed    = "failed"
)

// EventRecord is one line of a source's log: what arrived, what was decided,
// and what came of it. It answers the only question anybody asks of a source —
// why nothing happened — the way flow_event answers it for routes.
type EventRecord struct {
	ID         int64     `json:"id"`
	Source     string    `json:"source"`
	ExternalID string    `json:"externalId,omitempty"`
	Rule       string    `json:"rule,omitempty"`
	Outcome    string    `json:"outcome"`
	CardID     string    `json:"cardId,omitempty"`
	Detail     string    `json:"detail,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
}

// AppendEvent records one decision.
func (s *Store) AppendEvent(r EventRecord) error {
	_, err := s.db.Exec(`INSERT INTO source_event (source, external_id, rule, outcome, card_id, detail, created_at)
		VALUES (?,?,?,?,?,?,?)`,
		r.Source, r.ExternalID, r.Rule, r.Outcome, r.CardID, r.Detail, time.Now().UnixMilli())
	return err
}

// Events returns a source's log, newest first.
func (s *Store) Events(source string, limit int) ([]EventRecord, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Query(`SELECT id, source, external_id, rule, outcome, card_id, detail, created_at
		FROM source_event WHERE source=? ORDER BY id DESC LIMIT ?`, source, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EventRecord
	for rows.Next() {
		var r EventRecord
		var created int64
		if err := rows.Scan(&r.ID, &r.Source, &r.ExternalID, &r.Rule, &r.Outcome,
			&r.CardID, &r.Detail, &created); err != nil {
			return nil, err
		}
		r.CreatedAt = time.UnixMilli(created)
		out = append(out, r)
	}
	return out, rows.Err()
}

// PruneEvents keeps the log bounded: it is a diagnostic, not an archive.
func (s *Store) PruneEvents(keep int) error {
	if keep <= 0 {
		keep = 500
	}
	_, err := s.db.Exec(`DELETE FROM source_event WHERE id NOT IN (
		SELECT id FROM source_event ORDER BY id DESC LIMIT ?)`, keep)
	return err
}
