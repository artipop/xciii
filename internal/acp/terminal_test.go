//go:build !windows

package acp

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A terminal is the agent's own CLI, and which binary that is differs from the
// ACP adapter of the same kind — the whole point of the cliBin column.
func TestTerminalCommandRunsTheCLIRatherThanTheAdapter(t *testing.T) {
	cases := []struct {
		name   string
		entry  AgentEntry
		resume bool
		want   []string
	}{
		{
			name:  "claude runs the CLI, not claude-agent-acp",
			entry: AgentEntry{Name: "c", Kind: AgentKindClaude},
			want:  []string{"claude"},
		},
		{
			name:   "resuming continues the conversation in this directory",
			entry:  AgentEntry{Name: "c", Kind: AgentKindClaude},
			resume: true,
			want:   []string{"claude", "--continue"},
		},
		{
			name:   "codex spells the same thing differently",
			entry:  AgentEntry{Name: "x", Kind: AgentKindCodex},
			resume: true,
			want:   []string{"codex", "resume", "--last"},
		},
		{
			name:  "an ACP-native kind is its own CLI, and binPath names it",
			entry: AgentEntry{Name: "j", Kind: AgentKindJunie, BinPath: "/opt/junie"},
			want:  []string{"/opt/junie"},
		},
		{
			name:   "an explicit argv is the whole command, resume included",
			entry:  AgentEntry{Name: "w", Kind: AgentKindClaude, TerminalCommand: []string{"proxychains4", "claude"}},
			resume: true,
			want:   []string{"proxychains4", "claude"},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := terminalCommand(c.entry, c.resume, "")
			if err != nil {
				t.Fatal(err)
			}
			if strings.Join(got, " ") != strings.Join(c.want, " ") {
				t.Errorf("argv %v, want %v", got, c.want)
			}
		})
	}
}

// binPath on a claude entry points at the vendor adapter, which has no terminal
// UI at all: running it in a window would show nothing and answer nothing.
func TestTerminalCommandIgnoresTheAdapterBinPath(t *testing.T) {
	got, err := terminalCommand(AgentEntry{Name: "c", Kind: AgentKindClaude, BinPath: "/opt/claude-agent-acp"}, false, "")
	if err != nil {
		t.Fatal(err)
	}
	if got[0] != "claude" {
		t.Errorf("argv %v, want the claude CLI", got)
	}
}

// The generic kind is an argv written for ACP-over-stdio. Guessing an
// interactive CLI out of it would open a window on a process with no terminal,
// so it asks instead.
func TestTerminalCommandRefusesAKindItCannotKnow(t *testing.T) {
	_, err := terminalCommand(AgentEntry{Name: "g", Kind: AgentKindACP, Command: []string{"gemini", "--acp"}}, false, "")
	if err == nil {
		t.Fatal("expected a refusal for the generic kind")
	}
	if !strings.Contains(err.Error(), "terminalCommand") {
		t.Errorf("the error should say what to set: %v", err)
	}
}

// The end of a terminal is the only thing a card hears about it, so it has to
// carry the work: the branch, the commits and anything left uncommitted.
func TestTerminalReportsWhatTheSessionLeftBehind(t *testing.T) {
	project := initTestProject(t)
	start := headSHA(t.Context(), project)

	write(t, filepath.Join(project, "done.txt"), "work")
	git(t, project, "add", ".")
	git(t, project, "commit", "-m", "did the thing")
	write(t, filepath.Join(project, "wip.txt"), "half")

	report := terminalReport(t.Context(), &TerminalSession{
		AgentName: "clauuus",
		Cwd:       project,
		Branch:    "acp/thing-1",
		startSHA:  start,
	})

	for _, want := range []string{"clauuus", "acp/thing-1", "did the thing", "wip.txt"} {
		if !strings.Contains(report, want) {
			t.Errorf("report does not mention %q:\n%s", want, report)
		}
	}
}

func TestTerminalReportSaysWhenNothingWasCommitted(t *testing.T) {
	project := initTestProject(t)
	report := terminalReport(t.Context(), &TerminalSession{
		AgentName: "clauuus",
		Cwd:       project,
		startSHA:  headSHA(t.Context(), project),
	})
	if !strings.Contains(report, "Новых коммитов нет") {
		t.Errorf("report should say the branch is untouched:\n%s", report)
	}
}

// The whole path, on a real pty: a CLI runs in the card's worktree, what it
// prints reaches a window, what the window types reaches it, and when it exits
// the card is told what happened.
func TestTerminalStreamsBothWaysAndReportsToTheCard(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("no shell to stand in for an agent CLI")
	}
	m, writer, _, project := testManager(t, "idle", nil)

	// A shell is the most honest stand-in for an agent CLI: it is interactive,
	// it echoes, and it exits when told to.
	agent := AgentEntry{Name: "shellish", Kind: AgentKindClaude, TerminalCommand: []string{"sh"}}

	term, err := m.startTerminal(terminalSpec{
		cardID:      "card-term",
		boardID:     "board1",
		title:       "Терминальная задача",
		projectPath: project,
		agent:       agent,
		worktree:    true,
	})
	if err != nil {
		t.Fatal(err)
	}

	history, updates, unsubscribe := term.Subscribe()
	defer unsubscribe()
	if len(history) != 0 {
		t.Logf("history already had %d bytes, which is fine", len(history))
	}

	// The terminal must be the card's worktree, not the project: two of them
	// sharing one checkout is exactly what worktrees are for.
	if term.Cwd == project {
		t.Errorf("terminal ran in the project itself: %s", term.Cwd)
	}
	if term.Branch == "" {
		t.Error("terminal has no branch")
	}
	if got := m.TerminalForCard("card-term"); got == nil || got.ID != term.ID {
		t.Error("the card does not report its own terminal")
	}

	if err := term.Write([]byte("echo hello-from-the-window\n")); err != nil {
		t.Fatal(err)
	}
	if !waitForOutput(t, updates, "hello-from-the-window") {
		t.Fatal("the window never saw what the CLI printed")
	}

	// Something to report: a commit made in the terminal, as a person would.
	if err := term.Write([]byte("echo work > done.txt && git add . && git commit -q -m 'from the terminal'\n")); err != nil {
		t.Fatal(err)
	}
	if err := term.Write([]byte("exit\n")); err != nil {
		t.Fatal(err)
	}

	select {
	case <-term.Done():
	case <-time.After(15 * time.Second):
		t.Fatal("the CLI never exited")
	}

	// terminalEnded runs on the pump goroutine, just after Done is closed.
	deadline := time.Now().Add(5 * time.Second)
	var comments []string
	for time.Now().Before(deadline) {
		comments = writer.cardComments("card-term")
		if len(comments) >= 1 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	// One comment, and it is the closing report. Opening the terminal is not
	// commented: the window is in front of whoever opened it, and what the
	// card cannot see for itself is what was left on the branch.
	if len(comments) != 1 {
		t.Fatalf("card was told %d things about its terminal, want only the closing report: %v", len(comments), comments)
	}
	if !strings.Contains(comments[0], "from the terminal") {
		t.Errorf("the card was not told what the terminal left behind:\n%s", comments[0])
	}
	if m.Terminal(term.ID) != nil {
		t.Error("a finished terminal is still listed as live")
	}
}

// A terminal raises nothing at all: the window is in front of the person who
// opened it, and the silence it used to report as a question could not be told
// from a CLI sitting at its prompt. Only the protocol asks now (question.go).
func TestATerminalNeverAsksForAttention(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("no shell to stand in for an agent CLI")
	}
	m, _, _, project, emitter := testManagerWithEmitter(t, "idle", nil)

	term, err := m.startTerminal(terminalSpec{
		cardID:      "card-quiet",
		boardID:     "board1",
		title:       "Тихая задача",
		projectPath: project,
		agent: AgentEntry{Name: "shellish", Kind: AgentKindClaude,
			TerminalCommand: []string{"sh", "-c", "echo banner; sleep 5"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = m.CloseTerminal(term.ID) }()

	_, updates, unsubscribe := term.Subscribe()
	defer unsubscribe()
	if !waitForOutput(t, updates, "banner") {
		t.Fatal("the CLI never printed its banner")
	}
	if err := term.Write([]byte("echo typed\n")); err != nil {
		t.Fatal(err)
	}
	if !waitForOutput(t, updates, "typed") {
		t.Fatal("the CLI never answered")
	}

	// Long past what used to be the threshold, having printed and been typed
	// into — the shape that used to be read as a question.
	time.Sleep(time.Second)
	if got := m.Attention(); len(got) != 0 {
		t.Errorf("a terminal is on the attention list: %+v", got)
	}
	if got := lastAttention(emitter, term.ID); got != nil {
		t.Errorf("the UI was told a terminal needs somebody: %v", got)
	}
}

// Resuming is the point of recording terminals at all: the next one on the card
// goes back to the same worktree and asks the CLI to continue what is there.
func TestTerminalResumesWhereTheCardLeftOff(t *testing.T) {
	m, _, _, project := testManager(t, "idle", nil)
	cwd := t.TempDir()

	if err := m.store.InsertTerminal(TerminalRecord{
		ID: "earlier", CardID: "card-r", ProjectPath: project, Cwd: cwd,
		Branch: "acp/earlier", Agent: "clauuus", Kind: AgentKindClaude,
		StartedAt: time.Now().Add(-time.Hour),
	}); err != nil {
		t.Fatal(err)
	}

	agent := AgentEntry{Name: "clauuus", Kind: AgentKindClaude}
	rec, resume := m.terminalResumePoint(terminalSpec{cardID: "card-r", projectPath: project, agent: agent})
	if !resume {
		t.Fatal("a card with a worktree still on disk should resume")
	}
	if rec.Cwd != cwd {
		t.Errorf("resuming in %s, want %s", rec.Cwd, cwd)
	}
	argv, err := terminalCommand(agent, resume, "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(argv, " ") != "claude --continue" {
		t.Errorf("argv %v, want the CLI asked to continue", argv)
	}

	// A worktree the user has since deleted is not somewhere to resume into.
	if err := os.RemoveAll(cwd); err != nil {
		t.Fatal(err)
	}
	if _, resume := m.terminalResumePoint(terminalSpec{cardID: "card-r", projectPath: project, agent: agent}); resume {
		t.Error("resumed into a directory that is gone")
	}
}

// A card travels a route, and each stage is its own conversation: the resume
// point of stage B is what B left, not what A left last night. The stage a
// card has passed keeps its record and gets it back when the card returns.
func TestTerminalResumeIsPerStage(t *testing.T) {
	m, _, _, project := testManager(t, "idle", nil)
	cwdA, cwdB := t.TempDir(), t.TempDir()
	agent := AgentEntry{Name: "clauuus", Kind: AgentKindClaude}

	for _, rec := range []TerminalRecord{
		{ID: "at-a", CardID: "card-n", NodeID: "work", ProjectPath: project, Cwd: cwdA,
			Agent: "clauuus", Kind: AgentKindClaude, StartedAt: time.Now().Add(-2 * time.Hour)},
		{ID: "at-b", CardID: "card-n", NodeID: "review", ProjectPath: project, Cwd: cwdB,
			Agent: "clauuus", Kind: AgentKindClaude, StartedAt: time.Now().Add(-time.Hour)},
	} {
		if err := m.store.InsertTerminal(rec); err != nil {
			t.Fatal(err)
		}
	}

	rec, resume := m.terminalResumePoint(terminalSpec{cardID: "card-n", nodeID: "work", projectPath: project, agent: agent})
	if !resume || rec.ID != "at-a" {
		t.Fatalf("stage work should resume its own conversation, got %+v (resume=%v)", rec, resume)
	}
	rec, resume = m.terminalResumePoint(terminalSpec{cardID: "card-n", nodeID: "review", projectPath: project, agent: agent})
	if !resume || rec.ID != "at-b" {
		t.Fatalf("stage review should resume its own conversation, got %+v (resume=%v)", rec, resume)
	}
}

// The conversation from before the card had stages — node "" — flows into the
// first stage that asks, so planning done on the card is not orphaned by
// putting the card onto a route.
func TestStageWithNoConversationContinuesTheCardsOwn(t *testing.T) {
	m, _, _, project := testManager(t, "idle", nil)
	cwd := t.TempDir()
	agent := AgentEntry{Name: "clauuus", Kind: AgentKindClaude}

	if err := m.store.InsertTerminal(TerminalRecord{
		ID: "planned", CardID: "card-p", NodeID: "", ProjectPath: project, Cwd: cwd,
		Agent: "clauuus", Kind: AgentKindClaude, StartedAt: time.Now().Add(-time.Hour),
	}); err != nil {
		t.Fatal(err)
	}

	rec, resume := m.terminalResumePoint(terminalSpec{cardID: "card-p", nodeID: "work", projectPath: project, agent: agent})
	if !resume || rec.ID != "planned" {
		t.Fatalf("the first stage should continue the card's own conversation, got %+v (resume=%v)", rec, resume)
	}
}

// write and git are the two things a report test needs a project to do.
func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func git(t *testing.T, project string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", project}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v: %s", args, err, out)
	}
}

// waitForOutput reads the subscription until the wanted text shows up.
func waitForOutput(t *testing.T, updates <-chan []byte, want string) bool {
	t.Helper()
	var seen strings.Builder
	deadline := time.After(15 * time.Second)
	for {
		select {
		case chunk, ok := <-updates:
			if !ok {
				return false
			}
			seen.Write(chunk)
			if strings.Contains(seen.String(), want) {
				return true
			}
		case <-deadline:
			t.Logf("saw instead:\n%s", seen.String())
			return false
		}
	}
}

// Closing the window does not end the CLI, and a planning terminal has no card
// to be found through — so asking for one again has to hand back the one that
// is running rather than start a second CLI nobody asked for.
func TestPlanningTerminalIsHandedBackRatherThanStartedTwice(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("no shell to stand in for an agent CLI")
	}
	project := initTestProject(t)
	m, _, _, _ := testManager(t, "idle", func(cfg *Config) {
		cfg.Projects = []ProjectEntry{{Name: "testrepo", Path: project}}
		cfg.Agents = []AgentEntry{{Name: "shellish", Kind: AgentKindClaude, TerminalCommand: []string{"sh"}}}
	})

	first, err := m.StartPlanningTerminal("testrepo", "shellish", "board1")
	if err != nil {
		t.Fatal(err)
	}
	second, err := m.StartPlanningTerminal("testrepo", "shellish", "board1")
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID {
		t.Errorf("asking twice started a second CLI (%s then %s)", first.ID, second.ID)
	}

	// And it is listed, which is what lets the UI point at it at all.
	live := m.LiveTerminals()
	if len(live) != 1 || live[0].ID != first.ID {
		t.Errorf("live terminals %+v, want just the planning one", live)
	}

	if err := m.CloseTerminal(first.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-first.Done():
	case <-time.After(10 * time.Second):
		t.Fatal("the CLI never exited")
	}
}

// A planning terminal opens on a conversation, and what starts that
// conversation is a setting a person edits. It has to reach the CLI: the board
// prompt and the agent's own come first, the edited instructions next, and the
// project last, because that is the one line nobody should have to type.
func TestPlanningTerminalCarriesTheEditedInstructions(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("no shell to stand in for an agent CLI")
	}
	project := initTestProject(t)
	m, _, _, _ := testManager(t, "idle", func(cfg *Config) {
		cfg.BoardPrompts = map[string]string{"board1": "Отвечай по-русски."}
		cfg.Projects = []ProjectEntry{{Name: "testrepo", Path: project}}
		cfg.Agents = []AgentEntry{{Name: "shellish", Kind: AgentKindClaude, Prompt: "Ты архитектор.", TerminalCommand: []string{"sh"}}}
	})
	if err := m.SetPlanningPrompt("Спроси про сроки."); err != nil {
		t.Fatal(err)
	}

	term, err := m.StartPlanningTerminal("testrepo", "shellish", "board1")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = m.CloseTerminal(term.ID) }()

	task := term.Info().Task
	for _, want := range []string{"Отвечай по-русски.", "Ты архитектор.", "Спроси про сроки.", project} {
		if !strings.Contains(task, want) {
			t.Errorf("planning terminal task %q does not carry %q", task, want)
		}
	}

	// The default is what a config that never named a planning prompt gets,
	// rather than an agent opening on nothing at all.
	if err := m.SetPlanningPrompt(""); err != nil {
		t.Fatal(err)
	}
	if got := m.PlanningPrompt(); got != DefaultPlanningPrompt {
		t.Errorf("emptied planning prompt reads back as %q, want the default", got)
	}
}

// A card can be talked over — wording, a plan, the brief — before anybody
// decides where the work lives, so "the card names no folder" is not a
// refusal: the conversation opens in «папка доски» — the board's own
// directory under the app's data — with no worktree and no branch.
func TestCardTerminalOpensWithoutAnyProject(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("no shell to stand in for an agent CLI")
	}
	m, _, _, _ := testManager(t, "idle", func(cfg *Config) {
		cfg.Agents = []AgentEntry{{Name: "shellish", Kind: AgentKindClaude, TerminalCommand: []string{"sh"}}}
	})

	// A card that says nothing about a folder, on a machine with no projects.
	m.SetBoardReader(&fakeReader{ev: CardMoved{BoardID: "board1", Title: "Обсудить формулировку"}})

	term, err := m.StartCardTerminal("card-talk", "", "")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = m.CloseTerminal(term.ID) }()

	want := filepath.Join(filepath.Dir(m.cfg.WorktreeDir), "boards", "board1")
	if term.Cwd != want {
		t.Errorf("talking in %s, want the board's own %s", term.Cwd, want)
	}
	if term.Branch != "" {
		t.Errorf("a folderless conversation grew branch %q", term.Branch)
	}
	if !term.Info().BoardFolder {
		t.Error("the info does not say this is «папка доски», so the UI would show the raw path")
	}
}

// Optional means "the card names no folder", never "the folder is broken": a
// card that points somewhere that does not resolve still refuses, because
// silently talking beside the folder the person meant would mislead.
func TestCardTerminalStillRefusesABrokenProject(t *testing.T) {
	m, _, _, _ := testManager(t, "idle", func(cfg *Config) {
		cfg.Agents = []AgentEntry{{Name: "shellish", Kind: AgentKindClaude, TerminalCommand: []string{"sh"}}}
	})
	m.SetBoardReader(&fakeReader{ev: CardMoved{
		BoardID: "board1",
		Title:   "Сломанный проект",
		Props:   map[string]string{"repo_path": "/no/such/dir"},
	}})

	if _, err := m.StartCardTerminal("card-broken", "", ""); err == nil {
		t.Fatal("a card naming a broken folder opened a terminal beside it")
	}
}

// The stamp under a card's title reads the resume's Cwd as "worktree", and a
// talk directory is not one: a folderless conversation stays resumable but
// names no address.
func TestFolderlessResumeNamesNoWorktree(t *testing.T) {
	m, _, _, _ := testManager(t, "idle", nil)
	talk := t.TempDir()
	if err := m.store.InsertTerminal(TerminalRecord{
		ID: "talk-1", CardID: "card-talk2", Cwd: talk,
		Agent: "clauuus", Kind: AgentKindClaude,
		StartedAt: time.Now().Add(-time.Hour),
	}); err != nil {
		t.Fatal(err)
	}

	out := m.TerminalHistoryForCard("card-talk2")
	if !out.Available {
		t.Error("a folderless conversation should still be resumable")
	}
	if out.Cwd != "" {
		t.Errorf("the talk directory leaked into the stamp: %q", out.Cwd)
	}
}

// A conversation that already exists continues with whoever held it. It used
// to be re-resolved from scratch, so registering a second agent made every
// old conversation refuse with «на карточке не указан агент» — and the
// transcript `--continue` picks up belongs to the held agent's CLI anyway.
func TestResumedConversationKeepsItsAgent(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("no shell to stand in for an agent CLI")
	}
	m, _, _, _ := testManager(t, "idle", func(cfg *Config) {
		cfg.Agents = []AgentEntry{
			{Name: "клаус", Kind: AgentKindClaude, TerminalCommand: []string{"sh"}},
			{Name: "кодекс", Kind: AgentKindCodex, TerminalCommand: []string{"sh"}},
		}
	})
	m.SetBoardReader(&fakeReader{ev: CardMoved{BoardID: "board1", Title: "Продолжить разговор"}})

	talk := t.TempDir()
	if err := m.store.InsertTerminal(TerminalRecord{
		ID: "held", CardID: "card-held", Cwd: talk,
		Agent: "клаус", Kind: AgentKindClaude,
		StartedAt: time.Now().Add(-time.Hour),
	}); err != nil {
		t.Fatal(err)
	}

	term, err := m.StartCardTerminal("card-held", "", "")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = m.CloseTerminal(term.ID) }()

	if term.AgentName != "клаус" {
		t.Errorf("the conversation changed hands to %q", term.AgentName)
	}
}

// Planning without a project is the board's own conversation: it opens in
// «папка доски», exactly as a card's folderless conversation does, and says
// so through the info the window reads.
func TestPlanningTerminalTalksInTheBoardsFolder(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("no shell to stand in for an agent CLI")
	}
	m, _, _, _ := testManager(t, "idle", func(cfg *Config) {
		cfg.Agents = []AgentEntry{{Name: "shellish", Kind: AgentKindClaude, TerminalCommand: []string{"sh"}}}
	})

	term, err := m.StartPlanningTerminal("", "", "board1")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = m.CloseTerminal(term.ID) }()

	want := filepath.Join(filepath.Dir(m.cfg.WorktreeDir), "boards", "board1")
	if term.Cwd != want {
		t.Errorf("planning in %s, want the board's own %s", term.Cwd, want)
	}
	if !term.Info().BoardFolder {
		t.Error("the info does not say this is «папка доски»")
	}
}
