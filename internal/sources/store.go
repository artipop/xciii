package sources

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
)

// Store keeps what has already been seen and what came of it. It lives in the
// board's own database, in tables of its own: a source works with the agent
// integration switched off, and that is a fact about packages rather than about
// files — internal/sources still imports nothing from internal/acp.
//
// The handle belongs to the board, which opened it and closes it.
type Store struct {
	db *sql.DB
}

// NewStore wraps the board's database handle. It creates nothing: the tables
// are rungs on the board's own migration ladder (tools/schemagen).
func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

func (s *Store) exec(q string, args ...any) (sql.Result, error) {
	return s.db.Exec(q, args...)
}

func (s *Store) query(q string, args ...any) (*sql.Rows, error) {
	return s.db.Query(q, args...)
}

func (s *Store) queryRow(q string, args ...any) *sql.Row {
	return s.db.QueryRow(q, args...)
}

// newID names a row of the log. UUIDv7 rather than an autoincrement, because
// v7 sorts by the moment it was made — which is what ORDER BY id meant here.
func newID() string {
	id, err := uuid.NewV7()
	if err != nil {
		return uuid.NewString()
	}
	return id.String()
}

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
	err := s.queryRow(`SELECT COALESCE(version,''), COALESCE(card_id,'') FROM source_item WHERE source=? AND external_id=?`,
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
	_, err := s.exec(`INSERT INTO source_item (source, external_id, version, card_id, created_at, updated_at)
		VALUES (?,?,?,?,?,?)
		ON CONFLICT(source, external_id) DO UPDATE SET
			version=excluded.version, card_id=excluded.card_id, updated_at=excluded.updated_at`,
		source, externalID, nullable(version), nullable(cardID), now, now)
	return err
}

// ForgetSource drops everything a removed source left behind, so a source
// created again under the same name starts clean rather than silently ignoring
// everything it brings.
func (s *Store) ForgetSource(source string) error {
	if _, err := s.exec(`DELETE FROM source_item WHERE source=?`, source); err != nil {
		return err
	}
	_, err := s.exec(`DELETE FROM source_event WHERE source=?`, source)
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
	ID         string    `json:"id"`
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
	_, err := s.exec(`INSERT INTO source_event (id, source, external_id, rule, outcome, card_id, detail, created_at)
		VALUES (?,?,?,?,?,?,?,?)`,
		newID(), r.Source, r.ExternalID, r.Rule, r.Outcome, nullable(r.CardID), r.Detail, time.Now().UnixMilli())
	return err
}

// Events returns a source's log, newest first.
func (s *Store) Events(source string, limit int) ([]EventRecord, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.query(`SELECT id, source, COALESCE(external_id,''), COALESCE(rule,''), outcome, COALESCE(card_id,''), COALESCE(detail,''), created_at
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
	_, err := s.exec(`DELETE FROM source_event WHERE id NOT IN (
		SELECT id FROM source_event ORDER BY id DESC LIMIT ?)`, keep)
	return err
}
