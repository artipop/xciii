package acp

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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
	return s, nil
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
);`)
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

// ClaimVCSEvent reports whether a project event is new, and remembers it. A
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
type FlowState struct {
	CardID      string    `json:"cardId"`
	BoardID     string    `json:"boardId"`
	Flow        string    `json:"flow"`
	NodeID      string    `json:"nodeId"`
	Branch      string    `json:"branch"`
	ProjectPath string    `json:"projectPath"`
	EnteredAt   time.Time `json:"enteredAt"`
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
		st.CardID, st.BoardID, st.Flow, st.NodeID, st.Branch, st.ProjectPath, st.EnteredAt.UnixMilli())
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

// scanner is satisfied by both *sql.Row and *sql.Rows.
type scanner interface{ Scan(dest ...any) error }

func scanFlowState(row scanner) (FlowState, error) {
	var st FlowState
	var entered int64
	if err := row.Scan(&st.CardID, &st.BoardID, &st.Flow, &st.NodeID, &st.Branch, &st.ProjectPath, &entered); err != nil {
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
// so this is where anything watching the project has to ask.
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
	ID          string     `json:"id"`
	CardID      string     `json:"cardId,omitempty"`
	BoardID     string     `json:"boardId,omitempty"`
	Title       string     `json:"title,omitempty"`
	ProjectPath string     `json:"projectPath,omitempty"`
	Cwd         string     `json:"cwd"`
	Branch      string     `json:"branch,omitempty"`
	Agent       string     `json:"agent,omitempty"`
	Kind        string     `json:"kind,omitempty"`
	StartedAt   time.Time  `json:"startedAt"`
	EndedAt     *time.Time `json:"endedAt,omitempty"`
	ExitCode    int        `json:"exitCode"`
}

// InsertTerminal records a terminal session as it starts.
func (s *Store) InsertTerminal(r TerminalRecord) error {
	_, err := s.db.Exec(`INSERT INTO terminal_session
		(id, card_id, board_id, title, repo_path, cwd, branch, agent, kind, started_at)
		VALUES (?,?,?,?,?,?,?,?,?,?)`,
		r.ID, r.CardID, r.BoardID, r.Title, r.ProjectPath, r.Cwd, r.Branch, r.Agent, r.Kind, r.StartedAt.UnixMilli())
	return err
}

// FinishTerminal records how a terminal session ended.
func (s *Store) FinishTerminal(id string, endedAt time.Time, exitCode int) error {
	_, err := s.db.Exec(`UPDATE terminal_session SET ended_at=?, exit_code=? WHERE id=?`,
		endedAt.UnixMilli(), exitCode, id)
	return err
}

// LastTerminalForCard is the most recent terminal opened on a card, whether or
// not it is still running — the one a new terminal continues.
func (s *Store) LastTerminalForCard(cardID string) (TerminalRecord, bool, error) {
	row := s.db.QueryRow(`SELECT id, card_id, board_id, title, repo_path, cwd, branch, agent, kind, started_at, ended_at, exit_code
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

func scanTerminal(row scanner) (TerminalRecord, error) {
	var (
		rec     TerminalRecord
		started int64
		ended   sql.NullInt64
	)
	if err := row.Scan(&rec.ID, &rec.CardID, &rec.BoardID, &rec.Title, &rec.ProjectPath, &rec.Cwd,
		&rec.Branch, &rec.Agent, &rec.Kind, &started, &ended, &rec.ExitCode); err != nil {
		return TerminalRecord{}, err
	}
	rec.StartedAt = time.UnixMilli(started)
	if ended.Valid {
		t := time.UnixMilli(ended.Int64)
		rec.EndedAt = &t
	}
	return rec, nil
}
