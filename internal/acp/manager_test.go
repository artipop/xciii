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
	created     []NewCard // cards asked for through the board tools
	createErr   error
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

// fakeReader serves one card to whatever asks for one by id.
type fakeReader struct{ ev CardMoved }

func (r *fakeReader) CardByID(ctx context.Context, cardID string) (CardMoved, error) {
	ev := r.ev
	ev.CardID = cardID
	return ev, nil
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
	project := initTestProject(t)
	dir := t.TempDir()
	cfg := DefaultConfig(dir)
	// Every kind is an ACP process now, so the fallback path is the one that
	// spells the agent out: the fake agent is the whole command.
	cfg.AgentMode = agentModeCommand
	cfg.AgentCommand = []string{writeFakeAgent(t, scenario)}
	cfg.ProjectWhitelist = []string{filepath.Dir(project)}
	cfg.WorktreeDir = filepath.Join(dir, "wt")
	if mutate != nil {
		mutate(&cfg)
	}
	// LoadConfig is what fills the column registry from the trigger-column keys
	// on a real install; a config built in code needs the same step.
	cfg = withColumns(cfg)

	st, err := OpenStore(filepath.Join(dir, "acp.db"))
	if err != nil {
		t.Fatal(err)
	}
	writer := newFakeWriter()
	events := &fakeEvents{ch: make(chan CardMoved, 16)}
	emitter := &fakeEmitter{}
	m := NewManager(cfg, "", st, writer, emitter, nil)
	m.SetBoardReader(&fakeReader{ev: CardMoved{
		BoardID: "board1",
		Title:   "Test task",
		Body:    "Do nothing useful.",
		Props:   map[string]string{"repo_path": project},
	}})
	if err := m.Start(context.Background(), events); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { m.Shutdown(3 * time.Second) })
	return m, writer, events, project, emitter
}

func moveEvent(cardID, project, from, to string) CardMoved {
	return CardMoved{
		EventID:    "ev-" + cardID + to,
		CardID:     cardID,
		BoardID:    "board1",
		Title:      "Test task",
		Body:       "Do nothing useful.",
		Props:      map[string]string{"repo_path": project},
		FromColumn: Column{PropertyID: "p1", PropertyName: DefaultTriggerProperty, OptionID: from, Name: columnName(from)},
		ToColumn:   Column{PropertyID: "p1", PropertyName: DefaultTriggerProperty, OptionID: to, Name: columnName(to)},
		At:         time.Now(),
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
	m, writer, events, project := testManager(t, fakeClaudeHappy, nil)

	events.ch <- moveEvent("card1", project, "opt-backlog", "opt-agent")

	waitFor(t, 15*time.Second, "session done", func() bool {
		sessions, _, err := m.store.SessionsForCard("card1")
		return err == nil && len(sessions) == 1 && sessions[0].Status == StatusDone
	})

	comments := writer.cardComments("card1")
	if len(comments) < 2 {
		t.Fatalf("expected start + result comments, got %v", comments)
	}
	last := comments[len(comments)-1]
	if !strings.Contains(last, "fake work done") {
		t.Errorf("final comment lacks agent output: %q", last)
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
	if branch := sessions[0].Branch; !strings.HasPrefix(branch, "acp/test-task-") {
		t.Errorf("branch %q is not named after the card", branch)
	}
	if !strings.Contains(last, sessions[0].WorktreePath) {
		t.Errorf("final comment lacks the worktree: %q", last)
	}
}

func TestWorktreeModeAlways(t *testing.T) {
	m, writer, events, project := testManager(t, fakeClaudeHappy, func(c *Config) {
		c.WorktreeMode = "always"
	})

	events.ch <- moveEvent("cardWT", project, "opt-backlog", "opt-agent")
	waitFor(t, 15*time.Second, "worktree session done", func() bool {
		sessions, _, err := m.store.SessionsForCard("cardWT")
		return err == nil && len(sessions) == 1 && sessions[0].Status == StatusDone
	})

	sessions, _, _ := m.store.SessionsForCard("cardWT")
	if wt := sessions[0].WorktreePath; wt == "" {
		t.Error("worktree path missing in always mode")
	} else if _, err := os.Stat(wt); err != nil {
		t.Errorf("worktree of done session was removed: %v", err)
	}
	comments := writer.cardComments("cardWT")
	if last := comments[len(comments)-1]; !strings.Contains(last, "Worktree") {
		t.Errorf("final comment lacks worktree info: %q", last)
	}
}

func TestProjectBusyRejectedWithoutWorktrees(t *testing.T) {
	// Worktrees are the default now, so this rule only applies to an install
	// that has turned them off.
	m, writer, events, project := testManager(t, fakeClaudeHang, func(c *Config) {
		c.WorktreeMode = "never"
	})

	events.ch <- moveEvent("cardA", project, "opt-backlog", "opt-agent")
	waitFor(t, 10*time.Second, "first session running", func() bool {
		sessions, _, err := m.store.SessionsForCard("cardA")
		return err == nil && len(sessions) == 1 && sessions[0].Status == StatusRunning
	})

	events.ch <- moveEvent("cardB", project, "opt-backlog", "opt-agent")
	waitFor(t, 5*time.Second, "busy-project comment on second card", func() bool {
		return len(writer.cardComments("cardB")) >= 1
	})
	if got := writer.cardComments("cardB")[0]; !strings.Contains(got, "уже работает") {
		t.Errorf("expected busy-project error comment, got %q", got)
	}
	if sessions, _, _ := m.store.SessionsForCard("cardB"); len(sessions) != 0 {
		t.Errorf("second card must not get a session, got %d", len(sessions))
	}
}

func TestRapidMovesStartOneSession(t *testing.T) {
	m, _, events, project := testManager(t, fakeClaudeHappy, nil)

	// Spec acceptance §10.4: five rapid back-and-forth moves → one session.
	for i := 0; i < 5; i++ {
		events.ch <- moveEvent("card2", project, "opt-backlog", "opt-agent")
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

func TestInvalidProjectPathComments(t *testing.T) {
	m, writer, events, _ := testManager(t, fakeClaudeHappy, nil)

	ev := moveEvent("card3", "/nonexistent/path", "opt-backlog", "opt-agent")
	events.ch <- ev

	waitFor(t, 5*time.Second, "error comment", func() bool {
		return len(writer.cardComments("card3")) >= 1
	})
	if got := writer.cardComments("card3")[0]; !strings.Contains(got, "Агент не запущен") {
		t.Errorf("expected clear error comment, got %q", got)
	}
	if sessions, _, _ := m.store.SessionsForCard("card3"); len(sessions) != 0 {
		t.Errorf("no session should have been created, got %d", len(sessions))
	}
}

func TestMoveBackCancelsSession(t *testing.T) {
	m, _, events, project := testManager(t, fakeClaudeHang, nil)

	events.ch <- moveEvent("card4", project, "opt-backlog", "opt-agent")
	waitFor(t, 10*time.Second, "session running", func() bool {
		sessions, _, err := m.store.SessionsForCard("card4")
		return err == nil && len(sessions) == 1 && sessions[0].Status == StatusRunning
	})

	// Let the fake agent actually start before yanking the card back.
	time.Sleep(300 * time.Millisecond)
	events.ch <- moveEvent("card4", project, "opt-agent", "opt-backlog")

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
	project := initTestProject(t)
	dir := t.TempDir()
	cfg := DefaultConfig(dir)
	cfg.AgentMode = agentModeCommand
	cfg.AgentCommand = []string{writeFakeAgent(t, fakeClaudeHappy)}
	cfg.ProjectWhitelist = []string{filepath.Dir(project)}

	dbPath := filepath.Join(dir, "acp.db")
	st, err := OpenStore(dbPath)
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
	m, writer, events, project, emitter := testManagerWithEmitter(t, fakeClaudeAsksPermission, nil)

	events.ch <- moveEvent("cardAsk", project, "opt-backlog", "opt-agent")
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

	// The card carries the exchange, as it carries everything else a session does.
	joined := strings.Join(writer.cardComments("cardAsk"), "\n")
	if !strings.Contains(joined, "спрашивает") || !strings.Contains(joined, "Ответ агенту") {
		t.Errorf("the card does not record the question and its answer:\n%s", joined)
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
	m, _, events, project, _ := testManagerWithEmitter(t, fakeClaudeAsksPermission, nil)

	events.ch <- moveEvent("cardNo", project, "opt-backlog", "opt-agent")
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
	m, _, events, project, _ := testManagerWithEmitter(t, fakeClaudeAsksForm, nil)

	events.ch <- moveEvent("cardForm", project, "opt-backlog", "opt-agent")
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
