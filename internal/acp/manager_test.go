package acp

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// testLogger keeps test output quiet unless something goes wrong.
func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// fakeWriter records board writes.
type fakeWriter struct {
	mu          sync.Mutex
	comments    map[string][]string // cardID → comments
	moves       []cardMove          // moves by column name, in order
	attachments []attachment
	created     []NewCard                    // cards asked for through the board tools
	texts       map[string]map[string]string // cardID → property id → text written
	fields      map[string]map[string]string // cardID → property name → value (SetCardFields)
	edits       map[string]CardEdit          // changes asked for through the board tools
	createErr   error
	editErr     error
}

// cardMove is one MoveCardByOptionName call.
type cardMove struct {
	cardID   string
	property string
	option   string
}

// attachment is one AttachFile call; the bytes are kept so tests can tell the
// files apart.
type attachment struct {
	cardID string
	name   string
	mime   string
	data   []byte
}

func newFakeWriter() *fakeWriter { return &fakeWriter{comments: map[string][]string{}} }

func (w *fakeWriter) AddComment(ctx context.Context, cardID, text string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.comments[cardID] = append(w.comments[cardID], text)
	return nil
}

func (w *fakeWriter) MoveCard(ctx context.Context, cardID, optionID string) error { return nil }

func (w *fakeWriter) MoveCardByOptionName(ctx context.Context, cardID, property, option string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.moves = append(w.moves, cardMove{cardID: cardID, property: property, option: option})
	return nil
}

func (w *fakeWriter) AttachFile(ctx context.Context, cardID, filename, mimeType string, data []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.attachments = append(w.attachments, attachment{cardID: cardID, name: filename, mime: mimeType, data: data})
	return nil
}

func (w *fakeWriter) CreateCard(ctx context.Context, card NewCard) (string, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.createErr != nil {
		return "", w.createErr
	}
	w.created = append(w.created, card)
	return fmt.Sprintf("card-%d", len(w.created)), nil
}

func (w *fakeWriter) UpdateCard(ctx context.Context, cardID string, edit CardEdit) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.editErr != nil {
		return w.editErr
	}
	if w.edits == nil {
		w.edits = map[string]CardEdit{}
	}
	w.edits[cardID] = edit
	return nil
}

func (w *fakeWriter) SetCardText(ctx context.Context, cardID, propertyID, value string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.texts == nil {
		w.texts = map[string]map[string]string{}
	}
	if w.texts[cardID] == nil {
		w.texts[cardID] = map[string]string{}
	}
	w.texts[cardID][propertyID] = value
	return nil
}

func (w *fakeWriter) SetCardFields(ctx context.Context, cardID string, fields map[string]string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.fields == nil {
		w.fields = map[string]map[string]string{}
	}
	if w.fields[cardID] == nil {
		w.fields[cardID] = map[string]string{}
	}
	for k, v := range fields {
		w.fields[cardID][k] = v
	}
	return nil
}

func (w *fakeWriter) cardFields(cardID string) map[string]string {
	w.mu.Lock()
	defer w.mu.Unlock()
	out := map[string]string{}
	for k, v := range w.fields[cardID] {
		out[k] = v
	}
	return out
}

func (w *fakeWriter) cardText(cardID, propertyID string) string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.texts[cardID][propertyID]
}

func (w *fakeWriter) cardEdit(cardID string) (CardEdit, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	edit, ok := w.edits[cardID]
	return edit, ok
}

func (w *fakeWriter) cardComments(cardID string) []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return append([]string(nil), w.comments[cardID]...)
}

func (w *fakeWriter) cardMoves() []cardMove {
	w.mu.Lock()
	defer w.mu.Unlock()
	return append([]cardMove(nil), w.moves...)
}

func (w *fakeWriter) cardAttachments() []attachment {
	w.mu.Lock()
	defer w.mu.Unlock()
	return append([]attachment(nil), w.attachments...)
}

// fakeEmitter records UI events with their payloads.
type fakeEmitter struct {
	mu       sync.Mutex
	events   []string
	payloads []map[string]any
}

func (e *fakeEmitter) Emit(event string, payload any) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.events = append(e.events, event)
	p, _ := payload.(map[string]any)
	e.payloads = append(e.payloads, p)
}

// lastAttention is the newest acp:attention payload about one wait, whether it
// is a terminal (keyed by its id) or a card (keyed by "card:<id>").
func lastAttention(e *fakeEmitter, key string) map[string]any {
	e.mu.Lock()
	defer e.mu.Unlock()
	var found map[string]any
	for i, name := range e.events {
		if name != EventAttention {
			continue
		}
		if p := e.payloads[i]; p != nil && p["key"] == key {
			found = p
		}
	}
	return found
}

// fakeReader serves one card to whatever asks for one by id, and whatever it
// was given as the board's listing.
type fakeReader struct {
	ev    CardMoved
	cards []CardMoved
}

func (r *fakeReader) CardByID(ctx context.Context, cardID string) (CardMoved, error) {
	for _, card := range r.cards {
		if card.CardID == cardID {
			return card, nil
		}
	}
	ev := r.ev
	ev.CardID = cardID
	return ev, nil
}

func (r *fakeReader) CardsForBoard(ctx context.Context, boardID string) ([]CardMoved, error) {
	var out []CardMoved
	for _, card := range r.cards {
		if card.BoardID == boardID {
			out = append(out, card)
		}
	}
	return out, nil
}

// fakeEvents is a manual BoardEvents feed.
type fakeEvents struct{ ch chan CardMoved }

func (f *fakeEvents) Subscribe(ctx context.Context) (<-chan CardMoved, error) { return f.ch, nil }

func testManager(t *testing.T, scenario string, mutate func(*Config)) (*Manager, *fakeWriter, *fakeEvents, string) {
	t.Helper()
	m, w, ev, project, _ := testManagerWithEmitter(t, scenario, mutate)
	return m, w, ev, project
}

func testManagerWithEmitter(t *testing.T, scenario string, mutate func(*Config)) (*Manager, *fakeWriter, *fakeEvents, string, *fakeEmitter) {
	t.Helper()
	project := initTestWorkdir(t)
	dir := t.TempDir()
	cfg := DefaultConfig(dir)
	// Every kind is an ACP process now, so the fallback path is the one that
	// spells the agent out: the fake agent is the whole command.
	cfg.AgentMode = agentModeCommand
	cfg.AgentCommand = []string{writeFakeAgent(t, scenario)}
	cfg.Workdirs = []WorkdirEntry{testWorkdir(project)}
	cfg.WorktreeDir = filepath.Join(dir, "wt")
	// The columns a fixture works with: the registry is a board's own answer
	// now, so a config built in code has to say so itself — and before the
	// test's own mutate, which is entitled to replace them.
	// With their option ids, because a column is its option and nothing is
	// matched by name any more (docs/model-graph.md, contradiction 5). The ids
	// are the ones moveEvent sends.
	cfg.Columns = []ColumnSpec{
		workColumn(cfg.TriggerProperty, FlowActionAgent),
		{BoardID: "board1", PropertyID: "p1", OptionID: "opt-deploy",
			Property: cfg.TriggerProperty, Column: TemplateDeployColumn, Action: FlowActionDeploy},
		{BoardID: "board1", PropertyID: "p1", OptionID: "opt-test",
			Property: cfg.TriggerProperty, Column: TemplateTestColumn, Action: FlowActionTest},
	}
	if mutate != nil {
		mutate(&cfg)
	}

	st, err := newTestStore(t, filepath.Join(dir, "acp.db"))
	if err != nil {
		t.Fatal(err)
	}
	writer := newFakeWriter()
	events := &fakeEvents{ch: make(chan CardMoved, 16)}
	emitter := &fakeEmitter{}
	m := NewManager(cfg, "", st, writer, emitter, nil)
	registerFixtures(t, m)
	m.SetBoardReader(&fakeReader{ev: CardMoved{
		BoardID:     "board1",
		Title:       "Test task",
		Body:        "Do nothing useful.",
		OptionNames: []string{testWorkdirName},
	}})
	if err := m.Start(context.Background(), events); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { m.Shutdown(3 * time.Second) })
	return m, writer, events, project, emitter
}

func moveEvent(cardID, from, to string) CardMoved {
	return CardMoved{
		EventID:     "ev-" + cardID + to,
		CardID:      cardID,
		BoardID:     "board1",
		Title:       "Test task",
		Body:        "Do nothing useful.",
		Props:       map[string]string{},
		OptionNames: []string{testWorkdirName},
		FromColumn:  Column{PropertyID: "p1", PropertyName: DefaultTriggerProperty, OptionID: from, Name: columnName(from)},
		ToColumn:    Column{PropertyID: "p1", PropertyName: DefaultTriggerProperty, OptionID: to, Name: columnName(to)},
		At:          time.Now(),
	}
}

// testWorkdirName is what the fixtures call the folder they work in. A card
// names it the way every card does — an option the board offers — and a board
// that records no folder property falls back to matching the option's name,
// which is what these events do.
const testWorkdirName = "code"

func testWorkdir(path string) WorkdirEntry {
	return WorkdirEntry{
		ID: newWorkdirID(), Name: testWorkdirName, Path: path,
		BoardID: "board1", Kind: WorkdirGit,
	}
}

// workColumn is the column the fixtures move a card into, bound to the option
// moveEvent sends. Tests that replace the registry rebuild it from here rather
// than spelling the ids again.
func workColumn(property, action string) ColumnSpec {
	return ColumnSpec{
		BoardID: "board1", PropertyID: "p1", OptionID: "opt-agent",
		Property: property, Column: TemplateWorkColumn, Action: action,
	}
}

func columnName(optionID string) string {
	if optionID == "opt-agent" {
		return DefaultTriggerColumn
	}
	return "Backlog"
}

func waitFor(t *testing.T, timeout time.Duration, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestTriggerRunsSessionToDone(t *testing.T) {
	m, writer, events, _ := testManager(t, fakeClaudeHappy, nil)

	events.ch <- moveEvent("card1", "opt-backlog", "opt-agent")

	waitFor(t, 15*time.Second, "session done", func() bool {
		sessions, _, err := m.store.SessionsForCard("card1")
		return err == nil && len(sessions) == 1 && sessions[0].Status == StatusDone
	})

	// One comment for the whole session, and it is what the agent did. The
	// card used to be told the session had started as well, which is the
	// ordinary case and says nothing the board does not show.
	comments := writer.cardComments("card1")
	if len(comments) != 1 {
		t.Fatalf("expected one comment — the result, got %v", comments)
	}
	if !strings.Contains(comments[0], "fake work done") {
		t.Errorf("final comment lacks agent output: %q", comments[0])
	}

	// The default gives the card its own worktree, on a branch named after the
	// card — which is what the card displays and what its deploy publishes.
	sessions, _, _ := m.store.SessionsForCard("card1")
	if sessions[0].WorktreePath == "" {
		t.Error("expected a worktree in the default mode")
	}
	if sessions[0].Cwd != sessions[0].WorktreePath {
		t.Errorf("session ran in %q, not in its worktree %q", sessions[0].Cwd, sessions[0].WorktreePath)
	}
	if branch := sessions[0].Branch; !strings.HasPrefix(branch, "test-task-") {
		t.Errorf("branch %q is not named after the card", branch)
	}
	// The comment names the branch — the durable half — and not the copy's
	// path: the copy is the workshop, folded away once the work is committed,
	// and a path into the app's data directory is not where anybody is sent.
	if !strings.Contains(comments[0], sessions[0].Branch) {
		t.Errorf("final comment lacks the branch: %q", comments[0])
	}
	if strings.Contains(comments[0], sessions[0].WorktreePath) {
		t.Errorf("final comment points into the copy: %q", comments[0])
	}
}

func TestWorktreeModeAlways(t *testing.T) {
	m, writer, events, _ := testManager(t, fakeClaudeHappy, func(c *Config) {
		c.WorktreeMode = "always"
	})

	events.ch <- moveEvent("cardWT", "opt-backlog", "opt-agent")
	waitFor(t, 15*time.Second, "worktree session done", func() bool {
		sessions, _, err := m.store.SessionsForCard("cardWT")
		return err == nil && len(sessions) == 1 && sessions[0].Status == StatusDone
	})

	sessions, _, _ := m.store.SessionsForCard("cardWT")
	if wt := sessions[0].WorktreePath; wt == "" {
		t.Error("worktree path missing in always mode")
	}
	// What the card is told is the branch; the copy's fate (folded away once
	// the work is committed, remade from the branch on the next ask) is
	// TestAFoldedCopyComesBackOnItsOwnBranch's business.
	comments := writer.cardComments("cardWT")
	if last := comments[len(comments)-1]; !strings.Contains(last, "Ветка") || !strings.Contains(last, sessions[0].Branch) {
		t.Errorf("final comment lacks the branch: %q", last)
	}
}

// A board that works on a branch in the folder itself takes one card at a
// time: the second one waits, and its strip says what it is waiting for.
func TestABranchInTheFolderItselfHoldsItUntilTheCardIsDone(t *testing.T) {
	m, writer, events, _ := testManager(t, fakeClaudeHang, func(c *Config) {
		c.WorktreeMode = "never"
	})

	events.ch <- moveEvent("cardA", "opt-backlog", "opt-agent")
	waitFor(t, 10*time.Second, "first session running", func() bool {
		sessions, _, err := m.store.SessionsForCard("cardA")
		return err == nil && len(sessions) == 1 && sessions[0].Status == StatusRunning
	})

	events.ch <- moveEvent("cardB", "opt-backlog", "opt-agent")

	// The busy folder is the card's current state, told on its strip rather
	// than left behind as a comment.
	waitFor(t, 5*time.Second, "the second card says the folder is held", func() bool {
		_, ok, _ := m.store.Stall("cardB")
		return ok
	})
	stall, _, _ := m.store.Stall("cardB")
	if !strings.Contains(stall.Reason, "занята") {
		t.Errorf("expected the folder-is-held reason, got %q", stall.Reason)
	}
	if got := writer.cardComments("cardB"); len(got) != 0 {
		t.Errorf("a failed start must not comment on the card: %q", got)
	}
	if sessions, _, _ := m.store.SessionsForCard("cardB"); len(sessions) != 0 {
		t.Errorf("second card must not get a session, got %d", len(sessions))
	}
}

func TestRapidMovesStartOneSession(t *testing.T) {
	m, _, events, _ := testManager(t, fakeClaudeHappy, nil)

	// Spec acceptance §10.4: five rapid back-and-forth moves → one session.
	for i := 0; i < 5; i++ {
		events.ch <- moveEvent("card2", "opt-backlog", "opt-agent")
	}

	waitFor(t, 15*time.Second, "exactly one session, terminal", func() bool {
		sessions, _, err := m.store.SessionsForCard("card2")
		return err == nil && len(sessions) == 1 && sessions[0].Status.Terminal()
	})
	// Give the trigger loop a beat to (incorrectly) start more.
	time.Sleep(200 * time.Millisecond)
	sessions, _, err := m.store.SessionsForCard("card2")
	if err != nil || len(sessions) != 1 {
		t.Fatalf("expected exactly 1 session, got %d (err=%v)", len(sessions), err)
	}
}

// A card that names a folder the registry has not got stops, and says so where
// a person will see it. It used to be able to name a path outright, and the
// failure then was the path being wrong; now the only way to be wrong is to
// name a folder nobody registered.
func TestAFolderTheRegistryHasNotGotStallsTheCard(t *testing.T) {
	m, writer, events, _ := testManager(t, fakeClaudeHappy, nil)

	ev := moveEvent("card3", "opt-backlog", "opt-agent")
	ev.OptionNames = []string{"такой папки нет"}
	events.ch <- ev

	// «Агент не запущен: …» was the comment this whole design grew out of: a
	// resolution failure is state, and the card shows it while it is true.
	waitFor(t, 5*time.Second, "the stall record appears", func() bool {
		_, ok, _ := m.store.Stall("card3")
		return ok
	})
	stall, _, _ := m.store.Stall("card3")
	if !strings.Contains(stall.Reason, "агент не запущен") {
		t.Errorf("expected a clear reason, got %q", stall.Reason)
	}
	if got := writer.cardComments("card3"); len(got) != 0 {
		t.Errorf("a failed start must not comment on the card: %q", got)
	}
	if sessions, _, _ := m.store.SessionsForCard("card3"); len(sessions) != 0 {
		t.Errorf("no session should have been created, got %d", len(sessions))
	}
}

// A stall is state, and state goes away with progress: the reason the card
// stood still must not survive the session that ended the standing.
func TestStallClearsWhenTheSessionStarts(t *testing.T) {
	m, _, events, _ := testManager(t, fakeClaudeHappy, nil)

	stalling := moveEvent("cardStall", "opt-backlog", "opt-agent")
	stalling.OptionNames = []string{"такой папки нет"}
	events.ch <- stalling
	waitFor(t, 5*time.Second, "the stall record appears", func() bool {
		_, ok, _ := m.store.Stall("cardStall")
		return ok
	})

	// The registry got fixed; the card is dragged in again, from elsewhere so
	// idempotency does not swallow the move.
	events.ch <- moveEvent("cardStall", "opt-review", "opt-agent")
	waitFor(t, 15*time.Second, "the session starts and the stall clears", func() bool {
		sessions, _, err := m.store.SessionsForCard("cardStall")
		if err != nil || len(sessions) == 0 {
			return false
		}
		_, ok, _ := m.store.Stall("cardStall")
		return !ok
	})
}

func TestMoveBackCancelsSession(t *testing.T) {
	m, _, events, _ := testManager(t, fakeClaudeHang, nil)

	events.ch <- moveEvent("card4", "opt-backlog", "opt-agent")
	waitFor(t, 10*time.Second, "session running", func() bool {
		sessions, _, err := m.store.SessionsForCard("card4")
		return err == nil && len(sessions) == 1 && sessions[0].Status == StatusRunning
	})

	// Let the fake agent actually start before yanking the card back.
	time.Sleep(300 * time.Millisecond)
	events.ch <- moveEvent("card4", "opt-agent", "opt-backlog")

	start := time.Now()
	waitFor(t, 10*time.Second, "session cancelled", func() bool {
		sessions, _, err := m.store.SessionsForCard("card4")
		return err == nil && len(sessions) == 1 && sessions[0].Status.Terminal()
	})
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Errorf("cancellation took %s", elapsed)
	}
	sessions, _, _ := m.store.SessionsForCard("card4")
	if sessions[0].Status != StatusCancelled {
		t.Errorf("expected cancelled, got %s", sessions[0].Status)
	}
}

func TestRecoveryMarksStaleFailed(t *testing.T) {
	project := initTestWorkdir(t)
	dir := t.TempDir()
	cfg := DefaultConfig(dir)
	cfg.AgentMode = agentModeCommand
	cfg.AgentCommand = []string{writeFakeAgent(t, fakeClaudeHappy)}
	cfg.Workdirs = []WorkdirEntry{testWorkdir(project)}

	dbPath := filepath.Join(dir, "acp.db")
	st, err := newTestStore(t, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.InsertSession(SessionRecord{
		ID: "stale1", CardID: "card9", BoardID: "b", AgentKind: "claude",
		Status: StatusRunning, StartedAt: time.Now(),
	}); err != nil {
		t.Fatal(err)
	}

	writer := newFakeWriter()
	m := NewManager(cfg, "", st, writer, &fakeEmitter{}, nil)
	if err := m.Start(context.Background(), &fakeEvents{ch: make(chan CardMoved)}); err != nil {
		t.Fatal(err)
	}
	defer m.Shutdown(time.Second)

	sessions, _, err := m.store.SessionsForCard("card9")
	if err != nil || len(sessions) != 1 || sessions[0].Status != StatusFailed {
		t.Fatalf("stale session not recovered to failed: %+v err=%v", sessions, err)
	}
	if got := writer.cardComments("card9"); len(got) != 1 || !strings.Contains(got[0], "прервана") {
		t.Errorf("expected interruption comment, got %v", got)
	}
}

// A missing adapter has to be said in the words that fix it — the package to
// install — because it is the first thing a machine without one runs into.
func TestMissingAdapterErrorIsActionable(t *testing.T) {
	cfg := DefaultConfig(t.TempDir())
	m := NewManager(cfg, "", nil, newFakeWriter(), &fakeEmitter{}, nil)
	if _, err := m.agentLaunch(AgentEntry{Name: "c", Kind: "claude", BinPath: "/definitely/not/here"}); err == nil {
		t.Fatal("a binPath that does not exist should error")
	}
	// Nothing installed and no npx: the message names the package.
	t.Setenv("PATH", t.TempDir())
	_, err := m.agentLaunch(AgentEntry{Name: "c", Kind: "claude"})
	if err == nil || !strings.Contains(err.Error(), "@agentclientprotocol/claude-agent-acp") {
		t.Errorf("expected the npm package in the error, got %v", err)
	}
}

// liveSession starts a session on a card the way a column does, and hands it
// back so a test can watch it run.
func liveSession(t *testing.T, m *Manager, cardID string) *Session {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ev, err := m.reader.CardByID(ctx, cardID)
	if err != nil {
		t.Fatalf("read card: %v", err)
	}
	s, err := m.startSession(ev, startOptions{})
	if err != nil {
		t.Fatalf("start session: %v", err)
	}
	return s
}

func waitStatus(t *testing.T, s *Session, want SessionStatus) {
	t.Helper()
	waitFor(t, 15*time.Second, "session status "+string(want), func() bool {
		return s.Status() == want
	})
}

// A tool outside the policy is what session/request_permission is for: the
// agent wants a decision, and the decision is a person's. The card is where it
// is asked, and the turn stays open until it is answered.
func TestASessionAsksTheCardForAToolOutsideThePolicy(t *testing.T) {
	m, writer, events, _, emitter := testManagerWithEmitter(t, fakeClaudeAsksPermission, nil)

	events.ch <- moveEvent("cardAsk", "opt-backlog", "opt-agent")
	waitFor(t, 15*time.Second, "the agent to ask", func() bool { return len(m.Questions()) == 1 })

	q := m.Questions()[0]
	if q.CardID != "cardAsk" || q.Kind != QuestionPermission {
		t.Fatalf("question %+v, want a permission question on the card", q)
	}
	if q.Tool == "" || len(q.Options) == 0 {
		t.Fatalf("a question nobody can answer: %+v", q)
	}
	// The session says it is waiting rather than looking like one that hung.
	live := m.byCard["cardAsk"]
	if live == nil || live.Status() != StatusWaitingPermission {
		t.Errorf("session status %v, want waiting_permission while the card is asked", live.Status())
	}
	// And it is on the board's list of things waiting for a person.
	if waiting := m.Attention(); len(waiting) != 1 || waiting[0].Reason != AttentionQuestion {
		t.Errorf("attention %+v, want the question", waiting)
	}
	if got := lastAttention(emitter, "q:"+q.ID); got == nil || got["awaiting"] != true {
		t.Errorf("the UI was never told the card is being asked: %v", got)
	}

	// Answering lets the turn finish, which is the whole difference from
	// refusing on the person's behalf.
	allow := ""
	for _, opt := range q.Options {
		if strings.HasPrefix(opt.Kind, "allow") {
			allow = opt.ID
		}
	}
	if err := m.AnswerQuestion(q.ID, Answer{OptionID: allow}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, 15*time.Second, "session done", func() bool {
		sessions, _, err := m.store.SessionsForCard("cardAsk")
		return err == nil && len(sessions) == 1 && sessions[0].Status == StatusDone
	})
	if len(m.Attention()) != 0 {
		t.Error("an answered question is still listed as waiting for a person")
	}
	if got := lastAttention(emitter, "q:"+q.ID); got == nil || got["awaiting"] != false {
		t.Errorf("the UI was never told the question was answered: %v", got)
	}

	// The exchange leaves no comments behind. A question is answered where it
	// is shown — the card's face, the notification, «Ждут» — and once answered
	// it is the agent's business; the card keeps what the session did, not how
	// it was conducted.
	joined := strings.Join(writer.cardComments("cardAsk"), "\n")
	if strings.Contains(joined, "спрашивает") || strings.Contains(joined, "Ответ агенту") {
		t.Errorf("the question exchange should not be commented on the card:\n%s", joined)
	}
}

// An agent running two tool calls at once asks twice, and the two are not
// interchangeable: answering one must leave the other on the board, waiting.
func TestTwoQuestionsOnOneCardStayApart(t *testing.T) {
	m, _, _, _ := testManager(t, fakeClaudeHappy, nil)
	s := liveSession(t, m, "cardTwo")

	answered := make(chan Answer, 2)
	for _, tool := range []string{"Bash", "WebFetch"} {
		go func(tool string) {
			answered <- m.ask(context.Background(), s, Question{
				Kind:    QuestionPermission,
				Text:    permissionText(tool, ""),
				Tool:    tool,
				Options: []QuestionOption{{ID: "yes", Label: "Да", Kind: "allow_once"}},
			})
		}(tool)
	}
	waitFor(t, 10*time.Second, "both questions to be asked", func() bool { return len(m.Questions()) == 2 })

	waiting := m.Attention()
	if len(waiting) != 2 || waiting[0].Key == waiting[1].Key {
		t.Fatalf("attention %+v, want two waits with keys of their own", waiting)
	}

	if err := m.AnswerQuestion(m.Questions()[0].ID, Answer{OptionID: "yes"}); err != nil {
		t.Fatal(err)
	}
	if got := <-answered; got.OptionID != "yes" {
		t.Errorf("the asker heard %+v, want the answer given", got)
	}
	waitFor(t, 10*time.Second, "the other question to still be waiting", func() bool { return len(m.Attention()) == 1 })

	if err := m.AnswerQuestion(m.Questions()[0].ID, Answer{Declined: true}); err != nil {
		t.Fatal(err)
	}
	<-answered
}

// An agent whose question goes unanswered must not sit there for ever: saying
// no is an answer, and the turn carries on without what it asked for.
func TestADeclinedQuestionLetsTheTurnCarryOn(t *testing.T) {
	m, _, events, _, _ := testManagerWithEmitter(t, fakeClaudeAsksPermission, nil)

	events.ch <- moveEvent("cardNo", "opt-backlog", "opt-agent")
	waitFor(t, 15*time.Second, "the agent to ask", func() bool { return len(m.Questions()) == 1 })

	if err := m.AnswerQuestion(m.Questions()[0].ID, Answer{Declined: true}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, 15*time.Second, "session done", func() bool {
		sessions, _, err := m.store.SessionsForCard("cardNo")
		return err == nil && len(sessions) == 1 && sessions[0].Status == StatusDone
	})
}

// The claude CLI's AskUserQuestion arrives as an elicitation form: a property
// with a oneOf of options and a free-text field beside it. The card has to turn
// that into something answerable, and the answer has to reach the agent in the
// shape it asked for.
func TestAnAgentQuestionArrivesAsAFormAndIsAnswered(t *testing.T) {
	m, _, events, _, _ := testManagerWithEmitter(t, fakeClaudeAsksForm, nil)

	events.ch <- moveEvent("cardForm", "opt-backlog", "opt-agent")
	waitFor(t, 15*time.Second, "the agent to ask", func() bool { return len(m.Questions()) == 1 })

	q := m.Questions()[0]
	if q.Kind != QuestionForm || q.Text != "Which database?" {
		t.Fatalf("question %+v, want the agent's own words", q)
	}
	if len(q.Options) != 2 || q.Options[0].ID != "sqlite" || q.Options[1].Label != "Postgres" {
		t.Fatalf("options %+v, want the two the agent offered, labelled as it labelled them", q.Options)
	}
	if !q.FreeText {
		t.Error("the agent offered a custom answer and the card does not")
	}

	if err := m.AnswerQuestion(q.ID, Answer{OptionID: "postgres"}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, 15*time.Second, "session done", func() bool {
		sessions, _, err := m.store.SessionsForCard("cardForm")
		return err == nil && len(sessions) == 1 && sessions[0].Status == StatusDone
	})

	// The agent records what it was told, so this is the answer as it heard it.
	raw, err := os.ReadFile(filepath.Join(fakeAgentDir(m.cfg.AgentCommand[0]), "elicitation.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"question_0":"postgres"`) {
		t.Errorf("the agent heard %s, want the choice under the property it asked about", raw)
	}
}

// Claiming form elicitation is what keeps AskUserQuestion enabled in the claude
// adapter; an agent reads the capability and decides whether to ask at all.
func TestTheClientTellsAgentsItCanShowAForm(t *testing.T) {
	caps := clientCapabilities()
	if caps.Elicitation == nil || caps.Elicitation.Form == nil {
		t.Fatalf("capabilities %+v, want form elicitation claimed", caps)
	}
	if caps.Elicitation.Url != nil {
		t.Error("URL elicitation is claimed, and a board has nowhere to send somebody")
	}
}

// registerFixtures puts what a fixture built in code through the doors the
// product uses, so the ids come from where they come from in production: the
// store mints a registry entry's, validateFlow mints a route's. Nothing in the
// product hands these out for a config that skipped a save, and it should not:
// a second place ids are born is the thing the id work was removing.
func registerFixtures(t *testing.T, m *Manager) {
	t.Helper()
	m.cfgMu.Lock()
	err := m.persistConfigLocked()
	for i := range m.cfg.Flows {
		f, ferr := validateFlow(m.cfg.Flows[i], m.cfg.Workdirs, m.cfg.Agents, m.cfg.Deploys)
		if ferr != nil {
			m.cfgMu.Unlock()
			t.Fatalf("fixture route %q is not valid: %v", m.cfg.Flows[i].Name, ferr)
		}
		m.cfg.Flows[i] = f
	}
	m.cfgMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
}
