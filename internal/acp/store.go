package acp

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// Store persists sessions, their event log and idempotency keys in a SQLite
// database separate from the board's own DB.
type Store struct {
	db *sql.DB
}

// SessionRecord mirrors one agent_session row.
type SessionRecord struct {
	ID           string        `json:"id"`
	CardID       string        `json:"cardId"`
	BoardID      string        `json:"boardId"`
	AgentKind    string        `json:"agentKind"`
	ACPSessionID string        `json:"acpSessionId"`
	Status       SessionStatus `json:"status"`
	Cwd          string        `json:"cwd"`
	WorktreePath string        `json:"worktreePath"`
	Branch       string        `json:"branch"`
	StartedAt    time.Time     `json:"startedAt"`
	FinishedAt   *time.Time    `json:"finishedAt,omitempty"`
	ErrorText    string        `json:"errorText,omitempty"`
}

// SessionEventRecord mirrors one session_event row.
type SessionEventRecord struct {
	ID        int64           `json:"id"`
	SessionID string          `json:"sessionId"`
	Seq       int64           `json:"seq"`
	Kind      string          `json:"kind"`
	Payload   json.RawMessage `json:"payload"`
	CreatedAt time.Time       `json:"createdAt"`
}

// OpenStore opens (creating if needed) the ACP database at path.
func OpenStore(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
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
	if err := s.evolve(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

// evolve adds what CREATE TABLE IF NOT EXISTS cannot: columns on tables that
// already exist. Every step must be safe to run twice, since nothing records
// which have run — a duplicate-column error is the step saying it has.
func (s *Store) evolve() error {
	// A terminal is a conversation on a stage of the card's route, so the
	// record carries the stage. Rows from before this column are the card's
	// one conversation from when it only had one, node '' — which is also what
	// a card outside any route uses, so they stay resumable.
	if _, err := s.db.Exec(`ALTER TABLE terminal_session ADD COLUMN node_id TEXT NOT NULL DEFAULT ''`); err != nil &&
		!strings.Contains(err.Error(), "duplicate column") {
		return err
	}
	if _, err := s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_terminal_session_card_node
		ON terminal_session(card_id, node_id, started_at)`); err != nil {
		return err
	}
	// What the agent said the conversation is about. Rows from before it have
	// none, which reads the same as an agent that has not said anything yet.
	if _, err := s.db.Exec(`ALTER TABLE terminal_session ADD COLUMN summary TEXT NOT NULL DEFAULT ''`); err != nil &&
		!strings.Contains(err.Error(), "duplicate column") {
		return err
	}
	return nil
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS agent_session (
	id TEXT PRIMARY KEY,
	card_id TEXT NOT NULL,
	board_id TEXT NOT NULL,
	agent_kind TEXT NOT NULL,
	acp_session_id TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL,
	cwd TEXT NOT NULL DEFAULT '',
	worktree_path TEXT NOT NULL DEFAULT '',
	branch TEXT NOT NULL DEFAULT '',
	started_at INTEGER NOT NULL,
	finished_at INTEGER,
	error_text TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_agent_session_card ON agent_session(card_id);
CREATE TABLE IF NOT EXISTS session_event (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id TEXT NOT NULL,
	seq INTEGER NOT NULL,
	kind TEXT NOT NULL,
	payload_json TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_event_session ON session_event(session_id, seq);
CREATE TABLE IF NOT EXISTS terminal_session (
	id TEXT PRIMARY KEY,
	card_id TEXT NOT NULL DEFAULT '',
	board_id TEXT NOT NULL DEFAULT '',
	title TEXT NOT NULL DEFAULT '',
	repo_path TEXT NOT NULL DEFAULT '',
	cwd TEXT NOT NULL DEFAULT '',
	branch TEXT NOT NULL DEFAULT '',
	agent TEXT NOT NULL DEFAULT '',
	kind TEXT NOT NULL DEFAULT '',
	started_at INTEGER NOT NULL,
	ended_at INTEGER,
	exit_code INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_terminal_session_card ON terminal_session(card_id, started_at);
CREATE TABLE IF NOT EXISTS idempotency (
	key TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS flow_state (
	card_id TEXT PRIMARY KEY,
	board_id TEXT NOT NULL DEFAULT '',
	flow TEXT NOT NULL,
	node_id TEXT NOT NULL,
	branch TEXT NOT NULL DEFAULT '',
	repo_path TEXT NOT NULL DEFAULT '',
	entered_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS flow_event (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	card_id TEXT NOT NULL,
	flow TEXT NOT NULL,
	from_node TEXT NOT NULL DEFAULT '',
	to_node TEXT NOT NULL,
	on_kind TEXT NOT NULL,
	detail TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flow_event_card ON flow_event(card_id, id);
CREATE TABLE IF NOT EXISTS card_stall (
	card_id TEXT PRIMARY KEY,
	node_id TEXT NOT NULL DEFAULT '',
	reason TEXT NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stage_queue (
	card_id TEXT PRIMARY KEY,
	board_id TEXT NOT NULL DEFAULT '',
	column_key TEXT NOT NULL,
	flow TEXT NOT NULL DEFAULT '',
	node_id TEXT NOT NULL DEFAULT '',
	queued_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stage_queue_column ON stage_queue(column_key, queued_at);
CREATE TABLE IF NOT EXISTS board_setup (
	board_id TEXT NOT NULL,
	step TEXT NOT NULL,
	status TEXT NOT NULL,
	at INTEGER NOT NULL,
	PRIMARY KEY (board_id, step)
);
CREATE TABLE IF NOT EXISTS vcs_seen (
	project TEXT NOT NULL,
	branch TEXT NOT NULL,
	kind TEXT NOT NULL,
	marker TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	PRIMARY KEY (project, branch, kind)
);
CREATE TABLE IF NOT EXISTS workdir_claim (
	workdir TEXT NOT NULL,
	owner TEXT NOT NULL,
	mode TEXT NOT NULL,
	branch TEXT NOT NULL DEFAULT '',
	path TEXT NOT NULL DEFAULT '',
	base TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	released_at INTEGER,
	PRIMARY KEY (workdir, owner)
);
CREATE INDEX IF NOT EXISTS idx_workdir_claim_live ON workdir_claim(workdir, released_at);`)
	return err
}

// SaveSetupStep records what was done with one step of a board's setup. It
// lives here rather than in the browser because it is about this machine: the
// same install seen from the server build, or after the page's storage is
// cleared, has to remember that a question was deliberately passed over.
func (s *Store) SaveSetupStep(st SetupStepState) error {
	if st.At.IsZero() {
		st.At = time.Now()
	}
	_, err := s.db.Exec(`INSERT INTO board_setup (board_id, step, status, at)
		VALUES (?,?,?,?)
		ON CONFLICT(board_id, step) DO UPDATE SET status=excluded.status, at=excluded.at`,
		st.BoardID, st.Step, st.Status, st.At.UnixMilli())
	return err
}

// SetupSteps returns what is recorded about a board's setup.
func (s *Store) SetupSteps(boardID string) ([]SetupStepState, error) {
	rows, err := s.db.Query(`SELECT board_id, step, status, at FROM board_setup WHERE board_id=?`, boardID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SetupStepState
	for rows.Next() {
		var st SetupStepState
		var at int64
		if err := rows.Scan(&st.BoardID, &st.Step, &st.Status, &at); err != nil {
			return nil, err
		}
		st.At = time.UnixMilli(at)
		out = append(out, st)
	}
	return out, rows.Err()
}

// ClaimVCSEvent reports whether a folder event is new, and remembers it. A
// watcher sees the same state on every poll — the branch stays merged — so the
// event fires once per marker (the commit it refers to) instead of once a minute.
func (s *Store) ClaimVCSEvent(project, branch, kind, marker string) (bool, error) {
	var seen string
	err := s.db.QueryRow(`SELECT marker FROM vcs_seen WHERE project=? AND branch=? AND kind=?`,
		project, branch, kind).Scan(&seen)
	switch {
	case err == sql.ErrNoRows:
	case err != nil:
		return false, err
	case seen == marker:
		return false, nil
	}
	_, err = s.db.Exec(`INSERT INTO vcs_seen (project, branch, kind, marker, created_at) VALUES (?,?,?,?,?)
		ON CONFLICT(project, branch, kind) DO UPDATE SET marker=excluded.marker, created_at=excluded.created_at`,
		project, branch, kind, marker, time.Now().UnixMilli())
	if err != nil {
		return false, err
	}
	return true, nil
}

// FlowState is where a card currently stands on its route.
//
// It lives on the card itself (BoardCardState) and is mirrored into the table
// below, which is this machine's index: the VCS watcher asks "which cards are
// parked and on what branch" every poll, and that is a question about all the
// cards at once. The card is the truth — it is what an export carries and an
// import renumbers — and the table is refilled from it.
type FlowState struct {
	CardID      string    `json:"cardId"`
	BoardID     string    `json:"boardId"`
	Flow        string    `json:"flow"`
	NodeID      string    `json:"nodeId"`
	Branch      string    `json:"branch"`
	WorkdirPath string    `json:"workdirPath"`
	EnteredAt   time.Time `json:"enteredAt"`
	// Visited are the stages the card has already left, which is what "done"
	// means on a route with a loop — the graph cannot say it, only the card's
	// own history can. Kept here rather than derived from flow_event so that it
	// travels with the card; flow_event stays as this machine's journal and is
	// still what answers for a card that predates this.
	Visited []string `json:"visited,omitempty"`
}

// FlowEventRecord is one transition, kept as the card's route history.
type FlowEventRecord struct {
	ID        int64     `json:"id"`
	CardID    string    `json:"cardId"`
	Flow      string    `json:"flow"`
	FromNode  string    `json:"fromNode"`
	ToNode    string    `json:"toNode"`
	On        string    `json:"on"`
	Detail    string    `json:"detail"`
	CreatedAt time.Time `json:"createdAt"`
}

// SaveFlowState records where the card is now, replacing any previous position.
func (s *Store) SaveFlowState(st FlowState) error {
	if st.EnteredAt.IsZero() {
		st.EnteredAt = time.Now()
	}
	_, err := s.db.Exec(`INSERT INTO flow_state (card_id, board_id, flow, node_id, branch, repo_path, entered_at)
		VALUES (?,?,?,?,?,?,?)
		ON CONFLICT(card_id) DO UPDATE SET
			board_id=excluded.board_id, flow=excluded.flow, node_id=excluded.node_id,
			branch=excluded.branch, repo_path=excluded.repo_path, entered_at=excluded.entered_at`,
		st.CardID, st.BoardID, st.Flow, st.NodeID, st.Branch, st.WorkdirPath, st.EnteredAt.UnixMilli())
	return err
}

// FlowStateForCard returns the card's position, if it is on a route at all.
func (s *Store) FlowStateForCard(cardID string) (FlowState, bool, error) {
	row := s.db.QueryRow(`SELECT card_id, board_id, flow, node_id, branch, repo_path, entered_at
		FROM flow_state WHERE card_id=?`, cardID)
	st, err := scanFlowState(row)
	if err == sql.ErrNoRows {
		return FlowState{}, false, nil
	}
	if err != nil {
		return FlowState{}, false, err
	}
	return st, true, nil
}

// FlowStates returns every card currently on a route — the input the VCS
// watcher builds its poll targets from.
func (s *Store) FlowStates() ([]FlowState, error) {
	rows, err := s.db.Query(`SELECT card_id, board_id, flow, node_id, branch, repo_path, entered_at FROM flow_state`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FlowState
	for rows.Next() {
		st, err := scanFlowState(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	return out, rows.Err()
}

// ClearFlowState forgets a card's position (it left its route).
func (s *Store) ClearFlowState(cardID string) error {
	_, err := s.db.Exec(`DELETE FROM flow_state WHERE card_id=?`, cardID)
	return err
}

// AppendFlowEvent records one transition.
func (s *Store) AppendFlowEvent(r FlowEventRecord) error {
	_, err := s.db.Exec(`INSERT INTO flow_event (card_id, flow, from_node, to_node, on_kind, detail, created_at)
		VALUES (?,?,?,?,?,?,?)`,
		r.CardID, r.Flow, r.FromNode, r.ToNode, r.On, r.Detail, time.Now().UnixMilli())
	return err
}

// FlowEvents returns a card's route history, oldest first.
func (s *Store) FlowEvents(cardID string) ([]FlowEventRecord, error) {
	rows, err := s.db.Query(`SELECT id, card_id, flow, from_node, to_node, on_kind, detail, created_at
		FROM flow_event WHERE card_id=? ORDER BY id`, cardID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FlowEventRecord
	for rows.Next() {
		var r FlowEventRecord
		var created int64
		if err := rows.Scan(&r.ID, &r.CardID, &r.Flow, &r.FromNode, &r.ToNode, &r.On, &r.Detail, &created); err != nil {
			return nil, err
		}
		r.CreatedAt = time.UnixMilli(created)
		out = append(out, r)
	}
	return out, rows.Err()
}

// StallRecord is why nothing is happening on a card that was asked to do
// something: a stage that could not start, a route that has nowhere to go. One
// per card — a newer reason replaces the old one, and any progress deletes it.
type StallRecord struct {
	CardID    string    `json:"cardId"`
	NodeID    string    `json:"nodeId,omitempty"`
	Reason    string    `json:"reason"`
	CreatedAt time.Time `json:"createdAt"`
}

// SetStall records the reason, replacing whatever was there.
func (s *Store) SetStall(r StallRecord) error {
	_, err := s.db.Exec(`INSERT INTO card_stall (card_id, node_id, reason, created_at)
		VALUES (?,?,?,?)
		ON CONFLICT(card_id) DO UPDATE SET
			node_id=excluded.node_id, reason=excluded.reason, created_at=excluded.created_at`,
		r.CardID, r.NodeID, r.Reason, time.Now().UnixMilli())
	return err
}

// ClearStall forgets the reason and reports whether there was one — the caller
// only announces a change that happened.
func (s *Store) ClearStall(cardID string) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM card_stall WHERE card_id=?`, cardID)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// Stall returns the card's recorded reason, if it has one.
func (s *Store) Stall(cardID string) (StallRecord, bool, error) {
	row := s.db.QueryRow(`SELECT card_id, node_id, reason, created_at FROM card_stall WHERE card_id=?`, cardID)
	var r StallRecord
	var created int64
	err := row.Scan(&r.CardID, &r.NodeID, &r.Reason, &created)
	if err == sql.ErrNoRows {
		return StallRecord{}, false, nil
	}
	if err != nil {
		return StallRecord{}, false, err
	}
	r.CreatedAt = time.UnixMilli(created)
	return r, true, nil
}

// scanner is satisfied by both *sql.Row and *sql.Rows.
type scanner interface{ Scan(dest ...any) error }

func scanFlowState(row scanner) (FlowState, error) {
	var st FlowState
	var entered int64
	if err := row.Scan(&st.CardID, &st.BoardID, &st.Flow, &st.NodeID, &st.Branch, &st.WorkdirPath, &entered); err != nil {
		return FlowState{}, err
	}
	st.EnteredAt = time.UnixMilli(entered)
	return st, nil
}

func (s *Store) Close() error { return s.db.Close() }

// InsertSession stores a new session row.
func (s *Store) InsertSession(r SessionRecord) error {
	_, err := s.db.Exec(`INSERT INTO agent_session
		(id, card_id, board_id, agent_kind, acp_session_id, status, cwd, worktree_path, branch, started_at, error_text)
		VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
		r.ID, r.CardID, r.BoardID, r.AgentKind, r.ACPSessionID, string(r.Status),
		r.Cwd, r.WorktreePath, r.Branch, r.StartedAt.UnixMilli(), r.ErrorText)
	return err
}

// UpdateSession updates the mutable fields of a session row.
func (s *Store) UpdateSession(id string, status SessionStatus, acpSessionID, cwd, worktreePath, branch, errorText string, finishedAt *time.Time) error {
	var fin any
	if finishedAt != nil {
		fin = finishedAt.UnixMilli()
	}
	_, err := s.db.Exec(`UPDATE agent_session
		SET status=?, acp_session_id=?, cwd=?, worktree_path=?, branch=?, error_text=?, finished_at=?
		WHERE id=?`,
		string(status), acpSessionID, cwd, worktreePath, branch, errorText, fin, id)
	return err
}

// SetSessionStatus updates only the status (and finished_at for terminal states).
func (s *Store) SetSessionStatus(id string, status SessionStatus, errorText string) error {
	var fin any
	if status.Terminal() {
		fin = time.Now().UnixMilli()
	}
	_, err := s.db.Exec(`UPDATE agent_session SET status=?, error_text=?, finished_at=COALESCE(?, finished_at) WHERE id=?`,
		string(status), errorText, fin, id)
	return err
}

// AppendEvent stores one session event.
func (s *Store) AppendEvent(sessionID string, seq int64, kind string, payload any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		b = []byte(fmt.Sprintf("%q", fmt.Sprint(payload)))
	}
	_, err = s.db.Exec(`INSERT INTO session_event (session_id, seq, kind, payload_json, created_at) VALUES (?,?,?,?,?)`,
		sessionID, seq, kind, string(b), time.Now().UnixMilli())
	return err
}

// SessionsForCard returns all sessions of a card, newest first, with events.
func (s *Store) SessionsForCard(cardID string) ([]SessionRecord, []SessionEventRecord, error) {
	rows, err := s.db.Query(`SELECT id, card_id, board_id, agent_kind, acp_session_id, status, cwd, worktree_path, branch, started_at, finished_at, error_text
		FROM agent_session WHERE card_id=? ORDER BY started_at DESC`, cardID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var sessions []SessionRecord
	for rows.Next() {
		r, err := scanSession(rows)
		if err != nil {
			return nil, nil, err
		}
		sessions = append(sessions, r)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	var events []SessionEventRecord
	for _, sess := range sessions {
		evRows, err := s.db.Query(`SELECT id, session_id, seq, kind, payload_json, created_at
			FROM session_event WHERE session_id=? ORDER BY seq`, sess.ID)
		if err != nil {
			return nil, nil, err
		}
		for evRows.Next() {
			var ev SessionEventRecord
			var payload string
			var created int64
			if err := evRows.Scan(&ev.ID, &ev.SessionID, &ev.Seq, &ev.Kind, &payload, &created); err != nil {
				evRows.Close()
				return nil, nil, err
			}
			ev.Payload = json.RawMessage(payload)
			ev.CreatedAt = time.UnixMilli(created)
			events = append(events, ev)
		}
		evRows.Close()
		if err := evRows.Err(); err != nil {
			return nil, nil, err
		}
	}
	return sessions, events, nil
}

// StaleSessions returns sessions left in a non-terminal state (e.g. after an
// app crash/restart).
func (s *Store) StaleSessions() ([]SessionRecord, error) {
	rows, err := s.db.Query(`SELECT id, card_id, board_id, agent_kind, acp_session_id, status, cwd, worktree_path, branch, started_at, finished_at, error_text
		FROM agent_session WHERE status IN (?,?,?)`,
		string(StatusQueued), string(StatusRunning), string(StatusWaitingPermission))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SessionRecord
	for rows.Next() {
		r, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ClaimIdempotency records key and reports whether it was free (true = first
// claim within the window; false = duplicate). Expired keys are purged first.
func (s *Store) ClaimIdempotency(key, sessionID string, window time.Duration) (bool, error) {
	cutoff := time.Now().Add(-window).UnixMilli()
	if _, err := s.db.Exec(`DELETE FROM idempotency WHERE created_at < ?`, cutoff); err != nil {
		return false, err
	}
	res, err := s.db.Exec(`INSERT OR IGNORE INTO idempotency (key, session_id, created_at) VALUES (?,?,?)`,
		key, sessionID, time.Now().UnixMilli())
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return n == 1, nil
}

func scanSession(rows *sql.Rows) (SessionRecord, error) {
	var r SessionRecord
	var status string
	var started int64
	var finished sql.NullInt64
	if err := rows.Scan(&r.ID, &r.CardID, &r.BoardID, &r.AgentKind, &r.ACPSessionID, &status,
		&r.Cwd, &r.WorktreePath, &r.Branch, &started, &finished, &r.ErrorText); err != nil {
		return r, err
	}
	r.Status = SessionStatus(status)
	r.StartedAt = time.UnixMilli(started)
	if finished.Valid {
		t := time.UnixMilli(finished.Int64)
		r.FinishedAt = &t
	}
	return r, nil
}

// QueuedStage is a card waiting for its column to free up a place.
type QueuedStage struct {
	CardID    string    `json:"cardId"`
	BoardID   string    `json:"boardId"`
	ColumnKey string    `json:"columnKey"`
	Flow      string    `json:"flow,omitempty"`
	NodeID    string    `json:"nodeId,omitempty"`
	QueuedAt  time.Time `json:"queuedAt"`
}

// EnqueueStage remembers that a card is waiting for a place in its column.
// Queueing the same card again keeps its original position: waiting longer must
// not cost it its turn.
func (s *Store) EnqueueStage(q QueuedStage) (bool, error) {
	res, err := s.db.Exec(`INSERT INTO stage_queue (card_id, board_id, column_key, flow, node_id, queued_at)
		VALUES (?,?,?,?,?,?) ON CONFLICT(card_id) DO NOTHING`,
		q.CardID, q.BoardID, q.ColumnKey, q.Flow, q.NodeID, time.Now().UnixMilli())
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// NextQueuedStage is the card that has waited longest for this column.
func (s *Store) NextQueuedStage(columnKey string) (QueuedStage, bool, error) {
	row := s.db.QueryRow(`SELECT card_id, board_id, column_key, flow, node_id, queued_at
		FROM stage_queue WHERE column_key=? ORDER BY queued_at LIMIT 1`, columnKey)
	var q QueuedStage
	var at int64
	err := row.Scan(&q.CardID, &q.BoardID, &q.ColumnKey, &q.Flow, &q.NodeID, &at)
	if err == sql.ErrNoRows {
		return QueuedStage{}, false, nil
	}
	if err != nil {
		return QueuedStage{}, false, err
	}
	q.QueuedAt = time.UnixMilli(at)
	return q, true, nil
}

// DequeueStage forgets a waiting card — it started, or it left the column.
func (s *Store) DequeueStage(cardID string) error {
	_, err := s.db.Exec(`DELETE FROM stage_queue WHERE card_id=?`, cardID)
	return err
}

// LatestBranchForCard is the branch the card was last worked on: the worktree
// branch of its most recent session. With worktrees on — the default — that is
// the branch the agent commits to, and the card itself never learns its name,
// so this is where anything watching the folder has to ask.
func (s *Store) LatestBranchForCard(cardID string) (string, error) {
	var branch string
	err := s.db.QueryRow(`SELECT branch FROM agent_session
		WHERE card_id=? AND branch<>'' ORDER BY started_at DESC LIMIT 1`, cardID).Scan(&branch)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return branch, nil
}

// TerminalRecord mirrors one terminal_session row: a CLI a human opened on a
// card. It is kept after the CLI exits, which is what makes a terminal
// resumable — the next one on that card goes back to the same directory and
// branch, and asks the CLI to continue the conversation it left there.
type TerminalRecord struct {
	ID     string `json:"id"`
	CardID string `json:"cardId,omitempty"`
	// NodeID is the stage of the card's route this conversation belongs to.
	// Empty for a card outside any route — and for every record from before
	// stages existed, which is the same thing: the card's one conversation.
	NodeID      string `json:"nodeId,omitempty"`
	BoardID     string `json:"boardId,omitempty"`
	Title       string `json:"title,omitempty"`
	WorkdirPath string `json:"workdirPath,omitempty"`
	Cwd         string `json:"cwd"`
	Branch      string `json:"branch,omitempty"`
	Agent       string `json:"agent,omitempty"`
	Kind        string `json:"kind,omitempty"`
	// Summary is the agent's own line about the conversation, kept so it comes
	// back with the conversation it describes.
	Summary   string     `json:"summary,omitempty"`
	StartedAt time.Time  `json:"startedAt"`
	EndedAt   *time.Time `json:"endedAt,omitempty"`
	ExitCode  int        `json:"exitCode"`
}

// InsertTerminal records a terminal session as it starts.
func (s *Store) InsertTerminal(r TerminalRecord) error {
	_, err := s.db.Exec(`INSERT INTO terminal_session
		(id, card_id, node_id, board_id, title, repo_path, cwd, branch, agent, kind, summary, started_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
		r.ID, r.CardID, r.NodeID, r.BoardID, r.Title, r.WorkdirPath, r.Cwd, r.Branch, r.Agent, r.Kind,
		r.Summary, r.StartedAt.UnixMilli())
	return err
}

// RenameTerminal records what a person called a conversation, so the name comes
// back when the conversation is resumed.
func (s *Store) RenameTerminal(id, title string) error {
	_, err := s.db.Exec(`UPDATE terminal_session SET title=? WHERE id=?`, title, id)
	return err
}

// SetTerminalSummary records what the agent said the conversation is about.
func (s *Store) SetTerminalSummary(id, summary string) error {
	_, err := s.db.Exec(`UPDATE terminal_session SET summary=? WHERE id=?`, summary, id)
	return err
}

// FinishTerminal records how a terminal session ended.
func (s *Store) FinishTerminal(id string, endedAt time.Time, exitCode int) error {
	_, err := s.db.Exec(`UPDATE terminal_session SET ended_at=?, exit_code=? WHERE id=?`,
		endedAt.UnixMilli(), exitCode, id)
	return err
}

const terminalColumns = `id, card_id, node_id, board_id, title, repo_path, cwd, branch, agent, kind, summary, started_at, ended_at, exit_code`

// LastTerminalForCardNode is the most recent conversation on one stage of the
// card — the one a new terminal there continues. When the stage has none yet
// and a stage was asked for, the card's node-less conversation answers: the
// planning that happened before the card had stages flows into its first one.
func (s *Store) LastTerminalForCardNode(cardID, nodeID string) (TerminalRecord, bool, error) {
	rec, ok, err := s.lastTerminal(cardID, nodeID)
	if err != nil || ok || nodeID == "" {
		return rec, ok, err
	}
	return s.lastTerminal(cardID, "")
}

func (s *Store) lastTerminal(cardID, nodeID string) (TerminalRecord, bool, error) {
	row := s.db.QueryRow(`SELECT `+terminalColumns+`
		FROM terminal_session WHERE card_id=? AND node_id=? ORDER BY started_at DESC LIMIT 1`, cardID, nodeID)
	rec, err := scanTerminal(row)
	if err == sql.ErrNoRows {
		return TerminalRecord{}, false, nil
	}
	if err != nil {
		return TerminalRecord{}, false, err
	}
	return rec, true, nil
}

// LastTerminalForCard is the card's most recent conversation on any stage —
// what "this card has been worked in a terminal" means.
func (s *Store) LastTerminalForCard(cardID string) (TerminalRecord, bool, error) {
	row := s.db.QueryRow(`SELECT `+terminalColumns+`
		FROM terminal_session WHERE card_id=? ORDER BY started_at DESC LIMIT 1`, cardID)
	rec, err := scanTerminal(row)
	if err == sql.ErrNoRows {
		return TerminalRecord{}, false, nil
	}
	if err != nil {
		return TerminalRecord{}, false, err
	}
	return rec, true, nil
}

// TerminalsForCard is the card's conversations, one per stage — the latest
// record of each. Newest first, which is the order a person left them in.
func (s *Store) TerminalsForCard(cardID string) ([]TerminalRecord, error) {
	rows, err := s.db.Query(`SELECT `+terminalColumns+` FROM terminal_session
		WHERE card_id=? AND started_at = (
			SELECT MAX(started_at) FROM terminal_session t2
			WHERE t2.card_id = terminal_session.card_id AND t2.node_id = terminal_session.node_id)
		ORDER BY started_at DESC`, cardID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TerminalRecord
	for rows.Next() {
		rec, err := scanTerminal(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func scanTerminal(row scanner) (TerminalRecord, error) {
	var (
		rec     TerminalRecord
		started int64
		ended   sql.NullInt64
	)
	if err := row.Scan(&rec.ID, &rec.CardID, &rec.NodeID, &rec.BoardID, &rec.Title, &rec.WorkdirPath, &rec.Cwd,
		&rec.Branch, &rec.Agent, &rec.Kind, &rec.Summary, &started, &ended, &rec.ExitCode); err != nil {
		return TerminalRecord{}, err
	}
	rec.StartedAt = time.UnixMilli(started)
	if ended.Valid {
		t := time.UnixMilli(ended.Int64)
		rec.EndedAt = &t
	}
	return rec, nil
}

// WorkspaceClaim is a folder handed to one owner: which branch was made for it,
// which directory the work happens in, and what it was cut from. A row exists
// only for a folder that is a repository — an ordinary folder creates nothing
// and so has nothing to record.
//
// The owner is a card, or "board:<id>" for a conversation with no card. It is
// what makes a workspace outlive the run that made it: the second stage of a
// route, and the terminal a person opens beside it, get the same branch and the
// same directory as the first, instead of each making its own.
type WorkspaceClaim struct {
	Workdir   string
	Owner     string
	Mode      string
	Branch    string
	Path      string
	Base      string
	CreatedAt time.Time
}

// ClaimWorkdir records a workspace. Called once, when it is created.
func (s *Store) ClaimWorkdir(c WorkspaceClaim) error {
	if c.CreatedAt.IsZero() {
		c.CreatedAt = time.Now()
	}
	_, err := s.db.Exec(`INSERT INTO workdir_claim (workdir, owner, mode, branch, path, base, created_at, released_at)
		VALUES (?,?,?,?,?,?,?,NULL)
		ON CONFLICT(workdir, owner) DO UPDATE SET
			mode=excluded.mode, branch=excluded.branch, path=excluded.path,
			base=excluded.base, created_at=excluded.created_at, released_at=NULL`,
		c.Workdir, c.Owner, c.Mode, c.Branch, c.Path, c.Base, c.CreatedAt.UnixMilli())
	return err
}

// WorkspaceOf is the workspace this owner holds in this folder, if it still
// holds one.
func (s *Store) WorkspaceOf(workdir, owner string) (WorkspaceClaim, bool, error) {
	row := s.db.QueryRow(`SELECT workdir, owner, mode, branch, path, base, created_at
		FROM workdir_claim WHERE workdir=? AND owner=? AND released_at IS NULL`, workdir, owner)
	return scanClaim(row)
}

// WorkdirHeldBy is whoever holds this folder now, for a mode where only one
// owner can. Empty when nobody does.
func (s *Store) WorkdirHeldBy(workdir string) (WorkspaceClaim, bool, error) {
	row := s.db.QueryRow(`SELECT workdir, owner, mode, branch, path, base, created_at
		FROM workdir_claim WHERE workdir=? AND released_at IS NULL
		ORDER BY created_at LIMIT 1`, workdir)
	return scanClaim(row)
}

// ReleaseWorkdir gives a folder back. The row stays: what branch a card worked
// on is worth remembering after the folder is free again.
func (s *Store) ReleaseWorkdir(workdir, owner string) error {
	_, err := s.db.Exec(`UPDATE workdir_claim SET released_at=?
		WHERE workdir=? AND owner=? AND released_at IS NULL`,
		time.Now().UnixMilli(), workdir, owner)
	return err
}

// ReleaseBranch gives back whatever workspace was on this branch, whoever holds
// it — how a merge frees the folder for the next card.
func (s *Store) ReleaseBranch(workdir, branch string) (string, error) {
	row := s.db.QueryRow(`SELECT owner FROM workdir_claim
		WHERE workdir=? AND branch=? AND released_at IS NULL`, workdir, branch)
	var owner string
	switch err := row.Scan(&owner); {
	case err == sql.ErrNoRows:
		return "", nil
	case err != nil:
		return "", err
	}
	return owner, s.ReleaseWorkdir(workdir, owner)
}

func scanClaim(row scanner) (WorkspaceClaim, bool, error) {
	var (
		c       WorkspaceClaim
		created int64
	)
	switch err := row.Scan(&c.Workdir, &c.Owner, &c.Mode, &c.Branch, &c.Path, &c.Base, &created); {
	case err == sql.ErrNoRows:
		return WorkspaceClaim{}, false, nil
	case err != nil:
		return WorkspaceClaim{}, false, err
	}
	c.CreatedAt = time.UnixMilli(created)
	return c, true, nil
}

// BranchForOwner is the branch this owner works on, in whichever folder it
// holds one — the card's own workspace, in other words. What a deploy
// publishes when the card names no branch itself.
func (s *Store) BranchForOwner(owner string) (string, error) {
	row := s.db.QueryRow(`SELECT branch FROM workdir_claim
		WHERE owner=? AND released_at IS NULL AND branch<>''
		ORDER BY created_at DESC LIMIT 1`, owner)
	var branch string
	switch err := row.Scan(&branch); {
	case err == sql.ErrNoRows:
		return "", nil
	case err != nil:
		return "", err
	}
	return branch, nil
}
