package acp

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Store is what this application knows about a card: its conversations, its
// place on a route, why it is standing still, the workspace it holds.
//
// It lives in the board's own database and not beside it. Everything here is
// about a card or a board, and while it was a file of its own there was nowhere
// for a foreign key to point: deleting a card is a real DELETE FROM blocks, and
// this side never heard about it, so a deleted card left its conversations, its
// stall and its place in the queue behind for ever. The keys are in the schema
// now (tools/schemagen) and enforced: `foreign_keys` travels in the SQLite
// DSN the board opens the handle with (server.NewStore).
//
// It does not own the handle. The board opened it, the board closes it, and on
// SQLite it is one connection for the whole application — which is what makes a
// card moving, its route being recorded and its stall being lifted able to
// become one transaction rather than three writes that can stop halfway.
type Store struct {
	db *sql.DB

	// board and carriedSessions belong to the one-off import of a pre-move
	// acp.db (legacystore.go) and are nil at every other moment. They sit on
	// the store rather than being threaded through ten carry functions, which
	// would be ten signatures carrying something none of them is about.
	board           *presence
	carriedSessions map[string]bool
}

// NewStore wraps the board's database handle. It creates nothing: the tables
// are rungs on the board's own migration ladder.
func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

func (s *Store) exec(query string, args ...any) (sql.Result, error) {
	return s.db.Exec(query, args...)
}

func (s *Store) query(q string, args ...any) (*sql.Rows, error) {
	return s.db.Query(q, args...)
}

func (s *Store) queryRow(q string, args ...any) *sql.Row {
	return s.db.QueryRow(q, args...)
}

// newID is what a row of ours is called. UUIDv7 rather than an autoincrement,
// because v7 sorts by the time it was made: `ORDER BY id` still means "as it
// happened" in the journals, and the three spellings of AUTO_INCREMENT are
// gone with the single column that needed them.
func newID() string {
	id, err := uuid.NewV7()
	if err != nil {
		// A worse order, never a refused write: the caller is recording
		// something that already happened.
		return uuid.NewString()
	}
	return id.String()
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

// SessionEventRecord mirrors one session_event row. There is no `seq`: the id
// is a UUIDv7 and so already sorts by the moment the event was recorded, which
// is the only thing the sequence number ever meant.
type SessionEventRecord struct {
	ID        string          `json:"id"`
	SessionID string          `json:"sessionId"`
	Kind      string          `json:"kind"`
	Payload   json.RawMessage `json:"payload"`
	CreatedAt time.Time       `json:"createdAt"`
}

// SaveSetupStep records what was done with one step of a board's setup. It
// lives here rather than in the browser because it is about this machine: the
// same install seen from the server build, or after the page's storage is
// cleared, has to remember that a question was deliberately passed over.
func (s *Store) SaveSetupStep(st SetupStepState) error {
	if st.At.IsZero() {
		st.At = time.Now()
	}
	_, err := s.exec(`INSERT INTO board_setup (board_id, step, status, changed_at)
		VALUES (?,?,?,?)
		ON CONFLICT(board_id, step) DO UPDATE SET status=excluded.status, changed_at=excluded.changed_at`,
		st.BoardID, st.Step, st.Status, st.At.UnixMilli())
	return err
}

// SetupSteps returns what is recorded about a board's setup.
func (s *Store) SetupSteps(boardID string) ([]SetupStepState, error) {
	rows, err := s.query(`SELECT board_id, step, status, changed_at FROM board_setup WHERE board_id=?`, boardID)
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
func (s *Store) ClaimVCSEvent(workspaceID, branch, kind, marker string) (bool, error) {
	var seen string
	err := s.queryRow(`SELECT COALESCE(marker,'') FROM vcs_seen WHERE workspace_id=? AND branch=? AND kind=?`,
		workspaceID, branch, kind).Scan(&seen)
	switch {
	case err == sql.ErrNoRows:
	case err != nil:
		return false, err
	case seen == marker:
		return false, nil
	}
	_, err = s.exec(`INSERT INTO vcs_seen (workspace_id, branch, kind, marker, created_at) VALUES (?,?,?,?,?)
		ON CONFLICT(workspace_id, branch, kind) DO UPDATE SET marker=excluded.marker, created_at=excluded.created_at`,
		workspaceID, branch, kind, marker, time.Now().UnixMilli())
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
	ID       string `json:"id"`
	CardID   string `json:"cardId"`
	Flow     string `json:"flow"`
	FromNode string `json:"fromNode"`
	ToNode   string `json:"toNode"`
	On       string `json:"on"`
	Detail   string `json:"detail"`
	// Said is the agent's own closing words on the transition that raised this
	// event — what the reviewer reported, in full where Detail is a label. It
	// is what a conversation resumed on a return is told instead of its task.
	Said      string    `json:"said,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// SaveFlowState records where the card is now, replacing any previous position.
func (s *Store) SaveFlowState(st FlowState) error {
	if st.EnteredAt.IsZero() {
		st.EnteredAt = time.Now()
	}
	_, err := s.exec(`INSERT INTO flow_state (card_id, board_id, flow, node_id, branch, workdir_path, entered_at)
		VALUES (?,?,?,?,?,?,?)
		ON CONFLICT(card_id) DO UPDATE SET
			board_id=excluded.board_id, flow=excluded.flow, node_id=excluded.node_id,
			branch=excluded.branch, workdir_path=excluded.workdir_path, entered_at=excluded.entered_at`,
		st.CardID, nullable(st.BoardID), st.Flow, st.NodeID, st.Branch, st.WorkdirPath, st.EnteredAt.UnixMilli())
	return err
}

// FlowStateForCard returns the card's position, if it is on a route at all.
func (s *Store) FlowStateForCard(cardID string) (FlowState, bool, error) {
	row := s.queryRow(`SELECT card_id, COALESCE(board_id,''), flow, node_id, COALESCE(branch,''), COALESCE(workdir_path,''), entered_at
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
	rows, err := s.query(`SELECT card_id, COALESCE(board_id,''), flow, node_id, COALESCE(branch,''), COALESCE(workdir_path,''), entered_at FROM flow_state`)
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
	_, err := s.exec(`DELETE FROM flow_state WHERE card_id=?`, cardID)
	return err
}

// AppendFlowEvent records one transition.
func (s *Store) AppendFlowEvent(r FlowEventRecord) error {
	_, err := s.exec(`INSERT INTO flow_event (id, card_id, flow, from_node, to_node, on_kind, detail, said, created_at)
		VALUES (?,?,?,?,?,?,?,?,?)`,
		newID(), r.CardID, r.Flow, r.FromNode, r.ToNode, r.On, r.Detail, r.Said, time.Now().UnixMilli())
	return err
}

// FlowEvents returns a card's route history, oldest first.
func (s *Store) FlowEvents(cardID string) ([]FlowEventRecord, error) {
	rows, err := s.query(`SELECT id, card_id, flow, COALESCE(from_node,''), to_node, on_kind, COALESCE(detail,''), COALESCE(said,''), created_at
		FROM flow_event WHERE card_id=? ORDER BY id`, cardID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FlowEventRecord
	for rows.Next() {
		var r FlowEventRecord
		var created int64
		if err := rows.Scan(&r.ID, &r.CardID, &r.Flow, &r.FromNode, &r.ToNode, &r.On, &r.Detail, &r.Said, &created); err != nil {
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
	CardID string `json:"cardId"`
	NodeID string `json:"nodeId,omitempty"`
	// Kind says what the reason is *about*, because one of them has somewhere
	// to go and the rest do not. See StallKindConversation.
	Kind      string    `json:"kind,omitempty"`
	Reason    string    `json:"reason"`
	CreatedAt time.Time `json:"createdAt"`
}

// StallKindConversation marks the one stall a person can act on directly: the
// card's own conversation stopped without a verdict — the CLI was closed, or
// the app was. Everything else recorded here is about the machinery around the
// card — a column with no free place, a folder another card holds, a route with
// no edge for what arrived — and none of those is opened by opening a terminal.
//
// It is a field rather than a reading of the reason, because the reason is a
// sentence for a person and nothing may branch on one.
const StallKindConversation = "conversation"

// SetStall records the reason, replacing whatever was there.
func (s *Store) SetStall(r StallRecord) error {
	_, err := s.exec(`INSERT INTO card_stall (card_id, node_id, kind, reason, created_at)
		VALUES (?,?,?,?,?)
		ON CONFLICT(card_id) DO UPDATE SET
			node_id=excluded.node_id, kind=excluded.kind, reason=excluded.reason, created_at=excluded.created_at`,
		r.CardID, r.NodeID, r.Kind, r.Reason, time.Now().UnixMilli())
	return err
}

// StallsOfKind is every card standing still for one kind of reason, as card id
// → reason. One query rather than one per card, for the same reason
// LiveTerminals is one call: the board draws this on every card it has.
func (s *Store) StallsOfKind(kind string) (map[string]string, error) {
	rows, err := s.query(`SELECT card_id, reason FROM card_stall WHERE kind=?`, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var cardID, reason string
		if err := rows.Scan(&cardID, &reason); err != nil {
			return nil, err
		}
		out[cardID] = reason
	}
	return out, rows.Err()
}

// ClearStall forgets the reason and reports whether there was one — the caller
// only announces a change that happened.
func (s *Store) ClearStall(cardID string) (bool, error) {
	res, err := s.exec(`DELETE FROM card_stall WHERE card_id=?`, cardID)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// Stall returns the card's recorded reason, if it has one.
func (s *Store) Stall(cardID string) (StallRecord, bool, error) {
	row := s.queryRow(`SELECT card_id, COALESCE(node_id,''), COALESCE(kind,''), reason, created_at FROM card_stall WHERE card_id=?`, cardID)
	var r StallRecord
	var created int64
	err := row.Scan(&r.CardID, &r.NodeID, &r.Kind, &r.Reason, &created)
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

// InsertSession stores a new session row.
func (s *Store) InsertSession(r SessionRecord) error {
	_, err := s.exec(`INSERT INTO agent_session
		(id, card_id, board_id, agent_kind, acp_session_id, status, cwd, worktree_path, branch, started_at, error_text)
		VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
		r.ID, nullable(r.CardID), nullable(r.BoardID), r.AgentKind, r.ACPSessionID, string(r.Status),
		r.Cwd, r.WorktreePath, r.Branch, r.StartedAt.UnixMilli(), r.ErrorText)
	return err
}

// UpdateSession updates the mutable fields of a session row.
func (s *Store) UpdateSession(id string, status SessionStatus, acpSessionID, cwd, worktreePath, branch, errorText string, finishedAt *time.Time) error {
	var fin any
	if finishedAt != nil {
		fin = finishedAt.UnixMilli()
	}
	_, err := s.exec(`UPDATE agent_session
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
	_, err := s.exec(`UPDATE agent_session SET status=?, error_text=?, finished_at=COALESCE(?, finished_at) WHERE id=?`,
		string(status), errorText, fin, id)
	return err
}

// AppendEvent stores one session event.
func (s *Store) AppendEvent(sessionID, kind string, payload any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		b = []byte(fmt.Sprintf("%q", fmt.Sprint(payload)))
	}
	_, err = s.exec(`INSERT INTO session_event (id, session_id, kind, payload_json, created_at) VALUES (?,?,?,?,?)`,
		newID(), sessionID, kind, string(b), time.Now().UnixMilli())
	return err
}

// SessionsForCard returns all sessions of a card, newest first, with events.
func (s *Store) SessionsForCard(cardID string) ([]SessionRecord, []SessionEventRecord, error) {
	rows, err := s.query(`SELECT id, COALESCE(card_id,''), COALESCE(board_id,''), agent_kind, COALESCE(acp_session_id,''), status,
		COALESCE(cwd,''), COALESCE(worktree_path,''), COALESCE(branch,''), started_at, finished_at, COALESCE(error_text,'')
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
		evRows, err := s.query(`SELECT id, session_id, kind, payload_json, created_at
			FROM session_event WHERE session_id=? ORDER BY id`, sess.ID)
		if err != nil {
			return nil, nil, err
		}
		for evRows.Next() {
			var ev SessionEventRecord
			var payload string
			var created int64
			if err := evRows.Scan(&ev.ID, &ev.SessionID, &ev.Kind, &payload, &created); err != nil {
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
	rows, err := s.query(`SELECT id, COALESCE(card_id,''), COALESCE(board_id,''), agent_kind, COALESCE(acp_session_id,''), status,
		COALESCE(cwd,''), COALESCE(worktree_path,''), COALESCE(branch,''), started_at, finished_at, COALESCE(error_text,'')
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
	if _, err := s.exec(`DELETE FROM idempotency WHERE created_at < ?`, cutoff); err != nil {
		return false, err
	}
	res, err := s.exec(`INSERT INTO idempotency (token, session_id, created_at) VALUES (?,?,?) ON CONFLICT(token) DO NOTHING`,
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
	res, err := s.exec(`INSERT INTO stage_queue (card_id, board_id, column_key, flow, node_id, queued_at)
		VALUES (?,?,?,?,?,?) ON CONFLICT(card_id) DO NOTHING`,
		q.CardID, nullable(q.BoardID), q.ColumnKey, q.Flow, q.NodeID, time.Now().UnixMilli())
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// NextQueuedStage is the card that has waited longest for this column.
func (s *Store) NextQueuedStage(columnKey string) (QueuedStage, bool, error) {
	row := s.queryRow(`SELECT card_id, COALESCE(board_id,''), column_key, COALESCE(flow,''), COALESCE(node_id,''), queued_at
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
	_, err := s.exec(`DELETE FROM stage_queue WHERE card_id=?`, cardID)
	return err
}

// LatestBranchForCard is the branch the card was last worked on: the worktree
// branch of its most recent session. With worktrees on — the default — that is
// the branch the agent commits to, and the card itself never learns its name,
// so this is where anything watching the folder has to ask.
func (s *Store) LatestBranchForCard(cardID string) (string, error) {
	var branch string
	err := s.queryRow(`SELECT branch FROM agent_session
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
	// NodeID is the node this conversation belongs to: the option id of the
	// card's column, or nodeNone for a card that has no column at all.
	NodeID string `json:"nodeId,omitempty"`
	// ColumnName is what the node was called when the conversation was held,
	// frozen on purpose: past columns are facts about the past, and the board
	// no longer remembers an option somebody deleted.
	ColumnName  string `json:"columnName,omitempty"`
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
	_, err := s.exec(`INSERT INTO conversation
		(id, card_id, node_id, column_name, board_id, title, workdir_path, cwd, branch, agent, kind, summary, started_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		r.ID, nullable(r.CardID), r.NodeID, r.ColumnName, nullable(r.BoardID), r.Title, r.WorkdirPath, r.Cwd, r.Branch, r.Agent, r.Kind,
		r.Summary, r.StartedAt.UnixMilli())
	return err
}

// RenameTerminal records what a person called a conversation, so the name comes
// back when the conversation is resumed.
func (s *Store) RenameTerminal(id, title string) error {
	_, err := s.exec(`UPDATE conversation SET title=? WHERE id=?`, title, id)
	return err
}

// SetTerminalSummary records what the agent said the conversation is about.
func (s *Store) SetTerminalSummary(id, summary string) error {
	_, err := s.exec(`UPDATE conversation SET summary=? WHERE id=?`, summary, id)
	return err
}

// DeleteTerminalsForCardNode forgets one conversation of a card — every record
// of it, not only the latest, because what the next terminal there would resume
// is whichever record is newest. This is what a person deleting a conversation
// asks for: the CLI is ended beside it, and the next one starts fresh.
func (s *Store) DeleteTerminalsForCardNode(cardID, nodeID string) error {
	_, err := s.exec(`DELETE FROM conversation WHERE card_id=? AND node_id=?`, cardID, nodeID)
	return err
}

// FinishTerminal records how a terminal session ended.
func (s *Store) FinishTerminal(id string, endedAt time.Time, exitCode int) error {
	_, err := s.exec(`UPDATE conversation SET ended_at=?, exit_code=? WHERE id=?`,
		endedAt.UnixMilli(), exitCode, id)
	return err
}

// terminalColumns reads a conversation back. The COALESCEs are where a column
// that means "there is none" — a planning conversation's card, a CLI that has
// not exited — meets Go, which spells absence with a zero value here. NULL is
// what the database has to hold, because a foreign key cannot point at ”.
const terminalColumns = `id, COALESCE(card_id,''), node_id, COALESCE(column_name,''), COALESCE(board_id,''),
	COALESCE(title,''), COALESCE(workdir_path,''), COALESCE(cwd,''), COALESCE(branch,''),
	COALESCE(agent,''), COALESCE(kind,''), COALESCE(summary,''), started_at, ended_at, COALESCE(exit_code,0)`

// LastTerminalForCardNode is the most recent conversation on one node of the
// card — the one a new terminal there continues.
func (s *Store) LastTerminalForCardNode(cardID, nodeID string) (TerminalRecord, bool, error) {
	return s.lastTerminal(cardID, nodeID)
}

func (s *Store) lastTerminal(cardID, nodeID string) (TerminalRecord, bool, error) {
	row := s.queryRow(`SELECT `+terminalColumns+`
		FROM conversation WHERE card_id=? AND node_id=? ORDER BY started_at DESC LIMIT 1`, cardID, nodeID)
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
	row := s.queryRow(`SELECT `+terminalColumns+`
		FROM conversation WHERE card_id=? ORDER BY started_at DESC LIMIT 1`, cardID)
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
	rows, err := s.query(`SELECT `+terminalColumns+` FROM conversation c
		WHERE c.card_id=? AND c.started_at = (
			SELECT MAX(started_at) FROM conversation t2
			WHERE t2.card_id = c.card_id AND t2.node_id = c.node_id)
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
	if err := row.Scan(&rec.ID, &rec.CardID, &rec.NodeID, &rec.ColumnName, &rec.BoardID, &rec.Title, &rec.WorkdirPath, &rec.Cwd,
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

// Checkout is the git state of one owner's work in one workspace: which branch
// was made for it, which directory the work happens in, and what it was cut
// from. A row exists only where the workspace is a repository — an ordinary
// folder creates nothing and so has nothing to record, which is why this is
// called a checkout at all.
//
// The owner is a card, or a board for a conversation with no card, and they are
// two columns because a foreign key cannot point at two tables through one. It
// is what makes a checkout outlive the run that made it: the second stage of a
// route, and the terminal a person opens beside it, get the same branch and the
// same directory as the first, instead of each making its own.
type Checkout struct {
	WorkspaceID string
	CardID      string
	BoardID     string
	Mode        string
	Branch      string
	Path        string
	Base        string
	CreatedAt   time.Time
}

// Owner names whoever holds this checkout, for a message a person reads. It is
// not a key and nothing looks anything up by it.
func (c Checkout) Owner() string {
	if c.CardID != "" {
		return c.CardID
	}
	if c.BoardID != "" {
		return BoardOwner(c.BoardID)
	}
	return ""
}

// SaveCheckout records one. Called when it is created, and again when an owner
// that had released it takes it back.
func (s *Store) SaveCheckout(c Checkout) error {
	if c.CreatedAt.IsZero() {
		c.CreatedAt = time.Now()
	}
	// Upserted on the owner rather than on the id: the id is ours and a second
	// claim by the same owner is the same checkout, not another one.
	column, value := "card_id", any(c.CardID)
	if c.CardID == "" {
		column, value = "board_id", any(nullable(c.BoardID))
	}
	var id string
	err := s.queryRow(`SELECT id FROM checkout WHERE workspace_id=? AND `+column+`=?`,
		c.WorkspaceID, value).Scan(&id)
	switch {
	case err == sql.ErrNoRows:
		id = newID()
	case err != nil:
		return err
	}
	_, err = s.exec(`INSERT INTO checkout
		(id, workspace_id, card_id, board_id, mode, branch, path, base, created_at, released_at)
		VALUES (?,?,?,?,?,?,?,?,?,NULL)
		ON CONFLICT(id) DO UPDATE SET
			mode=excluded.mode, branch=excluded.branch, path=excluded.path,
			base=excluded.base, created_at=excluded.created_at, released_at=NULL`,
		id, c.WorkspaceID, nullable(c.CardID), nullable(c.BoardID), c.Mode,
		nullable(c.Branch), nullable(c.Path), nullable(c.Base), c.CreatedAt.UnixMilli())
	return err
}

const checkoutColumns = `workspace_id, COALESCE(card_id,''), COALESCE(board_id,''), mode,
	COALESCE(branch,''), COALESCE(path,''), COALESCE(base,''), created_at`

// CheckoutOf is what this owner holds in this workspace, if it still holds
// anything.
func (s *Store) CheckoutOf(workspaceID, cardID, boardID string) (Checkout, bool, error) {
	column, value := "card_id", any(cardID)
	if cardID == "" {
		column, value = "board_id", any(nullable(boardID))
	}
	row := s.queryRow(`SELECT `+checkoutColumns+` FROM checkout
		WHERE workspace_id=? AND `+column+`=? AND released_at IS NULL`, workspaceID, value)
	return scanCheckout(row)
}

// WorkspaceHeldBy is whoever holds this workspace now — and only a branch in
// the folder itself holds one. A copy per card holds nothing: that is the whole
// point of it, and counting those made a card finished months ago keep every
// later card out of a folder it was never standing in.
func (s *Store) WorkspaceHeldBy(workspaceID string) (Checkout, bool, error) {
	row := s.queryRow(`SELECT `+checkoutColumns+` FROM checkout
		WHERE workspace_id=? AND released_at IS NULL AND mode=?
		ORDER BY created_at LIMIT 1`, workspaceID, WorkModeBranch)
	return scanCheckout(row)
}

// ReleaseCheckout gives a workspace back. The row stays: which branch a card
// worked on is worth remembering after the folder is free again.
func (s *Store) ReleaseCheckout(workspaceID, cardID, boardID string) error {
	column, value := "card_id", any(cardID)
	if cardID == "" {
		column, value = "board_id", any(nullable(boardID))
	}
	_, err := s.exec(`UPDATE checkout SET released_at=?
		WHERE workspace_id=? AND `+column+`=? AND released_at IS NULL`,
		time.Now().UnixMilli(), workspaceID, value)
	return err
}

// ReleaseBranch gives back whatever checkout was on this branch, whoever holds
// it — how a merge frees the folder for the next card. It answers with the
// owner, for the line that says so in the log.
func (s *Store) ReleaseBranch(workspaceID, branch string) (string, error) {
	row := s.queryRow(`SELECT COALESCE(card_id,''), COALESCE(board_id,'') FROM checkout
		WHERE workspace_id=? AND branch=? AND released_at IS NULL`, workspaceID, branch)
	var cardID, boardID string
	switch err := row.Scan(&cardID, &boardID); {
	case err == sql.ErrNoRows:
		return "", nil
	case err != nil:
		return "", err
	}
	owner := Checkout{CardID: cardID, BoardID: boardID}.Owner()
	return owner, s.ReleaseCheckout(workspaceID, cardID, boardID)
}

func scanCheckout(row scanner) (Checkout, bool, error) {
	var (
		c       Checkout
		created int64
	)
	switch err := row.Scan(&c.WorkspaceID, &c.CardID, &c.BoardID, &c.Mode,
		&c.Branch, &c.Path, &c.Base, &created); {
	case err == sql.ErrNoRows:
		return Checkout{}, false, nil
	case err != nil:
		return Checkout{}, false, err
	}
	c.CreatedAt = time.UnixMilli(created)
	return c, true, nil
}

// BranchForCard is the branch this card works on, in whichever workspace it
// holds one. What a deploy publishes when the card names no branch itself.
func (s *Store) BranchForCard(cardID string) (string, error) {
	row := s.queryRow(`SELECT branch FROM checkout
		WHERE card_id=? AND released_at IS NULL AND branch IS NOT NULL AND branch<>''
		ORDER BY created_at DESC LIMIT 1`, cardID)
	var branch string
	switch err := row.Scan(&branch); {
	case err == sql.ErrNoRows:
		return "", nil
	case err != nil:
		return "", err
	}
	return branch, nil
}

// CheckoutModeForCard is how the card's live checkout is arranged — "worktree"
// or "branch" — or "" when it holds none. The card's stamp names its line after
// it: a person who set «отдельная копия» should read worktree off the card, not
// a bare branch label that spells the *other* setting.
func (s *Store) CheckoutModeForCard(cardID string) (mode, branch, base string, err error) {
	row := s.queryRow(`SELECT mode, COALESCE(branch,''), COALESCE(base,'') FROM checkout
		WHERE card_id=? AND released_at IS NULL
		ORDER BY created_at DESC LIMIT 1`, cardID)
	switch err := row.Scan(&mode, &branch, &base); {
	case err == sql.ErrNoRows:
		return "", "", "", nil
	case err != nil:
		return "", "", "", err
	}
	return mode, branch, base, nil
}
