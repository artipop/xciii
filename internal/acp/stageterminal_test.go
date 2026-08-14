package acp

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakeCLIOnPath installs a script under the name a kind's interactive CLI has
// and puts it first on PATH, so a stage resolves to it the way it would resolve
// to the real thing. It has to be found by name rather than pointed at, because
// naming the binary is exactly what an entry may not do for these kinds
// (terminalCommand ignores binPath when the adapter and the CLI are different
// programs) — and an entry with a terminalCommand of its own is not run as a
// stage at all (stageRunsInTerminal).
func fakeCLIOnPath(t *testing.T, name, script string) {
	t.Helper()
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("no shell to stand in for an agent CLI")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+script+"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

// stageManager is a manager whose one agent works its stages in a terminal:
// a kind with an interactive CLI and a way to be handed the board tools, and an
// origin for those tools to be served on.
func stageManager(t *testing.T, script string, mutate func(*Config)) (*Manager, *fakeWriter, *fakeEvents, string, *fakeEmitter) {
	t.Helper()
	fakeCLIOnPath(t, "claude", script)
	m, writer, events, project, emitter := testManagerWithEmitter(t, "idle", func(cfg *Config) {
		cfg.Agents = []AgentEntry{{Name: "clauuus", Kind: AgentKindClaude}}
		if mutate != nil {
			mutate(cfg)
		}
	})
	// Without an address there are no board tools, and without those a stage
	// could never be told it is over.
	m.SetOrigin("http://127.0.0.1:65535")
	return m, writer, events, project, emitter
}

// liveStageTerminal is the conversation a stage opened on a card.
func liveStageTerminal(t *testing.T, m *Manager, cardID string) *TerminalSession {
	t.Helper()
	var term *TerminalSession
	waitFor(t, 15*time.Second, "the stage to open a terminal", func() bool {
		term = m.TerminalForCard(cardID)
		return term != nil
	})
	// A stage holds a worktree for as long as its CLI runs, and the temp
	// directory it lives in is removed when the test ends: a test that walks away
	// from a running stage fails on the way out rather than on what it asserted.
	t.Cleanup(func() {
		m.CancelSessionForCard(cardID, "тест закончился")
		select {
		case <-term.Done():
		case <-time.After(20 * time.Second):
		}
	})
	return term
}

// cardSession is the card's own live session, read the way the manager reads it.
func cardSession(m *Manager, cardID string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.byCard[cardID]
}

// A stage of a route is the agent's own CLI with the card's task already in it.
// This is the whole shape of the feature: no adapter, no protocol, no interface
// of ours over the top — the task goes on the command line the way a person
// would have typed it.
func TestAStageIsTheAgentsOwnCLIWithTheTaskInIt(t *testing.T) {
	m, _, events, project, _ := stageManager(t, "sleep 30", nil)

	events.ch <- moveEvent("cardStage", project, "opt-backlog", "opt-agent")
	term := liveStageTerminal(t, m, "cardStage")

	argv := strings.Join(term.Argv, " ")
	if !strings.HasSuffix(filepath.Base(term.Argv[0]), "claude") {
		t.Errorf("the stage ran %q, want the agent's own CLI", term.Argv[0])
	}
	if !strings.Contains(argv, "Test task") {
		t.Errorf("the card's task never reached the CLI:\n%s", argv)
	}
	if !strings.Contains(argv, "--mcp-config") {
		t.Errorf("a stage with no board tools could never say it is finished:\n%s", argv)
	}
}

// The card's task is a positional argument, and everything before it on that
// command line is flags — one of which, `--mcp-config`, takes a list. Without an
// end-of-options marker the CLI reads the task as a second config file, dies
// with "MCP config file not found: почини логин", and every card of the board
// stalls saying the agent never reported.
func TestTheTaskIsNotEatenByTheFlagBeforeIt(t *testing.T) {
	argv, taken, err := terminalCommand(
		AgentEntry{Name: "clauuus", Kind: AgentKindClaude},
		false, "/tmp/mcp.json", "почини логин",
	)
	if err != nil || !taken {
		t.Fatalf("the task did not reach the command line: taken=%v err=%v", taken, err)
	}
	last := argv[len(argv)-2:]
	if last[0] != "--" || last[1] != "почини логин" {
		t.Errorf("argv ends %q, want the task behind an end-of-options marker:\n%q", last, argv)
	}
}

// Until the agent says the work is over the card stands where it is: an
// interactive CLI does not exit when a turn ends, so nothing else can stand in
// for the answer.
func TestACardWaitsUntilTheAgentSaysTheWorkIsDone(t *testing.T) {
	m, writer, events, project, _ := stageManager(t, "sleep 30", nil)

	events.ch <- moveEvent("cardDone", project, "opt-backlog", "opt-agent")
	term := liveStageTerminal(t, m, "cardDone")

	if got := cardSession(m, "cardDone").Status(); got != StatusRunning {
		t.Fatalf("session status %q while the agent works, want %q", got, StatusRunning)
	}

	if err := m.FinishWorkFromTools(term.boardToken, true, "починил сборку"); err != nil {
		t.Fatalf("the agent could not report: %v", err)
	}
	waitFor(t, 20*time.Second, "the session to finish", func() bool {
		return cardSession(m, "cardDone").Status() == StatusDone
	})

	waitFor(t, 10*time.Second, "the card to be told", func() bool {
		for _, c := range writer.cardComments("cardDone") {
			if strings.Contains(c, "починил сборку") {
				return true
			}
		}
		return false
	})
}

// A CLI that dies on the way up is not "the agent did not report": the stage
// never happened. The card is told so, in the CLI's own words — the terminal has
// closed by the time anybody looks, so what it printed exists nowhere else.
func TestACLIThatCannotStartSaysWhyOnTheCard(t *testing.T) {
	m, writer, events, project, _ := stageManager(t, "echo 'MCP config file not found: почини логин' >&2; exit 1", nil)

	events.ch <- moveEvent("cardBroken", project, "opt-backlog", "opt-agent")

	waitFor(t, 20*time.Second, "the card to be told why", func() bool {
		for _, c := range writer.cardComments("cardBroken") {
			if strings.Contains(c, "MCP config file not found") && strings.Contains(c, "кодом 1") {
				return true
			}
		}
		return false
	})

	// And it is a failure, so a route has an event to act on — a card that
	// cannot start its agent must not sit there looking like work in progress.
	waitFor(t, 10*time.Second, "the session to fail", func() bool {
		s := cardSession(m, "cardBroken")
		return s != nil && s.Status() == StatusFailed
	})
}

// The card's own conversation and the route's are different things. A stage
// starting while somebody is thinking out loud must open its own CLI, not type
// the card's task into theirs — which is what one shared key did.
func TestAStageDoesNotTakeOverTheCardsOwnConversation(t *testing.T) {
	m, _, events, project, _ := stageManager(t, "sleep 30", nil)

	mine, err := m.StartCardTerminal("cardTalk", "", "")
	if err != nil {
		t.Fatalf("could not open the card's own conversation: %v", err)
	}
	t.Cleanup(func() { _ = m.CloseTerminal(mine.ID) })

	events.ch <- moveEvent("cardTalk", project, "opt-backlog", "opt-agent")

	var stage *TerminalSession
	waitFor(t, 20*time.Second, "the stage to open a conversation of its own", func() bool {
		for _, info := range m.LiveTerminals() {
			if info.CardID == "cardTalk" && info.ID != mine.ID {
				stage = m.Terminal(info.ID)
				return stage != nil
			}
		}
		return false
	})
	t.Cleanup(func() { m.CancelSessionForCard("cardTalk", "тест закончился") })

	// Both conversations name the card — the person's own opens with what the
	// card says (cardIntro) — so what tells them apart is the brief a stage is
	// handed: "Task:" and the instructions about committing under it.
	if strings.Contains(strings.Join(mine.Argv, " "), "Task: Test task") {
		t.Errorf("the card's task was typed into the person's conversation:\n%q", mine.Argv)
	}
	if !strings.Contains(strings.Join(stage.Argv, " "), "Test task") {
		t.Errorf("the stage did not get the card's task:\n%q", stage.Argv)
	}
	if mine.NodeID == stage.NodeID {
		t.Errorf("both conversations are keyed %q — they would keep colliding", mine.NodeID)
	}
}

// The card's own conversation asks nothing of the card: no folder, no route, no
// agent assigned. It is where the folder gets decided, so demanding one first
// would be the wrong way round — and it must not invent a branch for a card
// nobody has started work on.
func TestTheCardsOwnConversationOpensWithNoProject(t *testing.T) {
	m, _, _, _, _ := stageManager(t, "sleep 30", nil)
	m.SetBoardReader(&fakeReader{ev: CardMoved{BoardID: "board1", Title: "Обдумать"}})

	term, err := m.StartCardTerminal("cardBare", "", "")
	if err != nil {
		t.Fatalf("a card with no folder could not be talked about: %v", err)
	}
	t.Cleanup(func() { _ = m.CloseTerminal(term.ID) })

	if term.Branch != "" {
		t.Errorf("thinking about a card left branch %q behind", term.Branch)
	}
	if term.Cwd != m.boardFolder("board1") {
		t.Errorf("a conversation with no folder runs in %q, want the board's drafts", term.Cwd)
	}

	// And asking again is "show me the one I have", which is what makes it a
	// place to come back to rather than a new CLI every time.
	again, err := m.StartCardTerminal("cardBare", "", "")
	if err != nil || again.ID != term.ID {
		t.Errorf("asking twice started a second conversation (%v, %v)", again, err)
	}
}

// The report is the stage's, not the board's: a conversation somebody opened to
// plan with has no stage to end, and saying so is better than quietly moving a
// card nobody put on a route.
func TestOnlyAStageCanSayTheWorkIsFinished(t *testing.T) {
	m, _, _, _, _ := stageManager(t, "sleep 30", func(cfg *Config) {
		cfg.Workdirs = []WorkdirEntry{{Name: "testrepo", Path: initTestWorkdir(t)}}
	})

	term, err := m.StartPlanningTerminal("testrepo", "clauuus", "board1")
	if err != nil {
		t.Fatal(err)
	}
	err = m.FinishWorkFromTools(term.boardToken, true, "всё")
	if err == nil {
		t.Fatal("a planning conversation must not be able to end a stage")
	}
	if !strings.Contains(err.Error(), "move_card") {
		t.Errorf("the refusal should say what to do instead, got %q", err)
	}
}

// A CLI that has stopped drawing has stopped for a person: it is asking
// something inside its own interface, and nothing outside it can see what. So
// the card says it is waiting, and the way in is the terminal itself.
func TestACardSaysWhenItsAgentHasGoneQuiet(t *testing.T) {
	m, _, events, project, emitter := stageManager(t, "echo working; sleep 30", nil)
	m.terminalQuiet = 500 * time.Millisecond

	events.ch <- moveEvent("cardQuiet", project, "opt-backlog", "opt-agent")
	term := liveStageTerminal(t, m, "cardQuiet")

	waitFor(t, 15*time.Second, "the card to say it is waiting", func() bool {
		p := lastAttention(emitter, term.ID)
		return p != nil && p["awaiting"] == true && p["reason"] == AttentionTerminal
	})

	// And it survives a reconnect, which is when the whole list is asked for
	// again — a card waiting to be answered is the wrong thing to lose.
	found := false
	for _, a := range m.Attention() {
		if a.TerminalID == term.ID {
			found = true
		}
	}
	if !found {
		t.Error("the wait is not in the list the UI asks for on reconnect")
	}
}
