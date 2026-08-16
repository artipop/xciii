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
			got, _, err := terminalCommand(c.entry, c.resume, "", "", "")
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
	got, _, err := terminalCommand(AgentEntry{Name: "c", Kind: AgentKindClaude, BinPath: "/opt/claude-agent-acp"}, false, "", "", "")
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
	_, _, err := terminalCommand(AgentEntry{Name: "g", Kind: AgentKindACP, Command: []string{"gemini", "--acp"}}, false, "", "", "")
	if err == nil {
		t.Fatal("expected a refusal for the generic kind")
	}
	if !strings.Contains(err.Error(), "terminalCommand") {
		t.Errorf("the error should say what to set: %v", err)
	}
}

// The CLI in a terminal draws itself for whatever TERM says it is talking to,
// and a packaged .app is a child of launchd, which sets no TERM at all: the
// agent's own colours went away the moment the app stopped being started from
// a shell. What the output is painted on is xterm.js, so that is what the pty
// says — inherited or not.
func TestTerminalTellsTheCLIWhatItIsDrawnOn(t *testing.T) {
	cases := []struct {
		name     string
		inherits []string
		entry    AgentEntry
		want     map[string]string
	}{
		{
			name:     "a packaged app inherits nothing and still gets colour",
			inherits: []string{"PATH=/usr/bin:/bin"},
			want:     map[string]string{"TERM": "xterm-256color", "COLORTERM": "truecolor"},
		},
		{
			name:     "the terminal the app was launched from does not describe this one",
			inherits: []string{"TERM=dumb", "COLORTERM="},
			want:     map[string]string{"TERM": "xterm-256color", "COLORTERM": "truecolor"},
		},
		{
			name:     "an entry naming its own TERM is somebody who knows better",
			inherits: []string{"TERM=xterm"},
			entry:    AgentEntry{Env: map[string]string{"TERM": "screen-256color"}},
			want:     map[string]string{"TERM": "screen-256color", "COLORTERM": "truecolor"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			restore := environ
			environ = func() []string { return tc.inherits }
			t.Cleanup(func() { environ = restore })

			add, drop := spawnEnv(tc.entry, NetworkSettings{})
			env := terminalEnv(add, drop)

			// Later wins at exec, so the last value of a name is the one asked for.
			got := map[string]string{}
			for _, kv := range env {
				if name, value, ok := strings.Cut(kv, "="); ok {
					got[name] = value
				}
			}
			for name, want := range tc.want {
				if got[name] != want {
					t.Errorf("%s = %q, want %q", name, got[name], want)
				}
			}
		})
	}
}

// The end of a terminal is the only thing a card hears about it, so it has to
// carry the work: the branch, the commits and anything left uncommitted.
func TestTerminalReportsWhatTheSessionLeftBehind(t *testing.T) {
	project := initTestWorkdir(t)
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
	project := initTestWorkdir(t)
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
		workdirPath: project,
		agent:       agent,
	})
	if err != nil {
		t.Fatal(err)
	}

	history, updates, unsubscribe := term.Subscribe()
	defer unsubscribe()
	if len(history) != 0 {
		t.Logf("history already had %d bytes, which is fine", len(history))
	}

	// The terminal must be the card's worktree, not the folder: two of them
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
		workdirPath: project,
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
		ID: "earlier", CardID: "card-r", WorkdirPath: project, Cwd: cwd,
		Branch: "acp/earlier", Agent: "clauuus", Kind: AgentKindClaude,
		StartedAt: time.Now().Add(-time.Hour),
	}); err != nil {
		t.Fatal(err)
	}

	agent := AgentEntry{Name: "clauuus", Kind: AgentKindClaude}
	rec, resume := m.terminalResumePoint(terminalSpec{cardID: "card-r", workdirPath: project, agent: agent})
	if !resume {
		t.Fatal("a card with a worktree still on disk should resume")
	}
	if rec.Cwd != cwd {
		t.Errorf("resuming in %s, want %s", rec.Cwd, cwd)
	}
	argv, _, err := terminalCommand(agent, resume, "", "", "")
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
	if _, resume := m.terminalResumePoint(terminalSpec{cardID: "card-r", workdirPath: project, agent: agent}); resume {
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
		{ID: "at-a", CardID: "card-n", NodeID: "work", WorkdirPath: project, Cwd: cwdA,
			Agent: "clauuus", Kind: AgentKindClaude, StartedAt: time.Now().Add(-2 * time.Hour)},
		{ID: "at-b", CardID: "card-n", NodeID: "review", WorkdirPath: project, Cwd: cwdB,
			Agent: "clauuus", Kind: AgentKindClaude, StartedAt: time.Now().Add(-time.Hour)},
	} {
		if err := m.store.InsertTerminal(rec); err != nil {
			t.Fatal(err)
		}
	}

	rec, resume := m.terminalResumePoint(terminalSpec{cardID: "card-n", nodeID: "work", workdirPath: project, agent: agent})
	if !resume || rec.ID != "at-a" {
		t.Fatalf("stage work should resume its own conversation, got %+v (resume=%v)", rec, resume)
	}
	rec, resume = m.terminalResumePoint(terminalSpec{cardID: "card-n", nodeID: "review", workdirPath: project, agent: agent})
	if !resume || rec.ID != "at-b" {
		t.Fatalf("stage review should resume its own conversation, got %+v (resume=%v)", rec, resume)
	}
}

// write and git are the two things a report test needs a folder to do.
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
	project := initTestWorkdir(t)
	m, _, _, _ := testManager(t, "idle", func(cfg *Config) {
		cfg.Workdirs = []WorkdirEntry{{Name: "testrepo", Path: project}}
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
// folder last, because that is the one line nobody should have to type.
func TestPlanningTerminalCarriesTheEditedInstructions(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("no shell to stand in for an agent CLI")
	}
	project := initTestWorkdir(t)
	m, _, _, _ := testManager(t, "idle", func(cfg *Config) {
		cfg.BoardPrompts = map[string]string{"board1": "Отвечай по-русски."}
		cfg.Workdirs = []WorkdirEntry{{Name: "testrepo", Path: project}}
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
// refusal: the conversation opens in «черновики доски» — the board's own
// directory under the app's data — with no worktree and no branch.
func TestCardTerminalOpensWithoutAnyProject(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("no shell to stand in for an agent CLI")
	}
	m, _, _, _ := testManager(t, "idle", func(cfg *Config) {
		cfg.Agents = []AgentEntry{{Name: "shellish", Kind: AgentKindClaude, TerminalCommand: []string{"sh"}}}
	})

	// A card that says nothing about a folder, on a machine with no folders.
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
		t.Error("the info does not say this is «черновики доски», so the UI would show the raw path")
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
		ID: "held", CardID: "card-held", NodeID: nodeNone, Cwd: talk,
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

// fakeResumingCLI plants a `claude` that behaves the way the real one does when
// the directory holds no conversation: asked to continue, it says so and exits
// 1; asked for nothing, it opens and stays open, echoing what is typed. It goes
// in front of PATH rather than replacing it, so git is still there.
func fakeResumingCLI(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("no shell to stand in for an agent CLI")
	}
	dir := t.TempDir()
	script := "#!/bin/sh\n" +
		"if [ \"$1\" = \"--continue\" ]; then\n" +
		"  echo 'No conversation found to continue'\n" +
		"  exit 1\n" +
		"fi\n" +
		"echo fresh-conversation\n" +
		"while read line; do echo \"typed:$line\"; done\n"
	if err := os.WriteFile(filepath.Join(dir, "claude"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

// A record of a terminal is not the CLI's own history: a terminal that was
// opened and never spoken in leaves a row here and no conversation there, which
// is what a `wails3 dev` restart makes of every terminal that was open. Asked to
// continue it, the CLI says «No conversation found to continue» and exits 1 —
// and what the person who clicked the button wanted was a terminal.
func TestARefusedResumeStillOpensATerminal(t *testing.T) {
	fakeResumingCLI(t)
	m, writer, _, project := testManager(t, "idle", nil)

	if err := m.store.InsertTerminal(TerminalRecord{
		ID: "before-the-restart", CardID: "card-refused", WorkdirPath: project, Cwd: project,
		Agent: "cl", Kind: AgentKindClaude, StartedAt: time.Now().Add(-time.Hour),
	}); err != nil {
		t.Fatal(err)
	}

	agent := AgentEntry{Name: "cl", Kind: AgentKindClaude}
	term, err := m.startTerminal(terminalSpec{
		cardID: "card-refused", boardID: "board1", title: "Продолжить нечего",
		workdirPath: project, agent: agent,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = m.CloseTerminal(term.ID) }()

	_, updates, unsubscribe := term.Subscribe()
	defer unsubscribe()
	if !waitForOutput(t, updates, "fresh-conversation") {
		t.Fatal("the terminal stayed closed after the CLI refused to continue")
	}

	// The person reading the window is told why they are looking at a new
	// conversation, since the CLI's refusal is right above it.
	history, _, unsubscribe2 := term.Subscribe()
	defer unsubscribe2()
	if !strings.Contains(string(history), "Продолжить прошлый разговор не удалось") {
		t.Errorf("the window was not told the resume was refused:\n%s", history)
	}

	// It is the same terminal, still the card's, and typing into it reaches the
	// CLI in the pty it was restarted in.
	if got := m.TerminalForCardNode("card-refused", ""); got == nil || got.ID != term.ID {
		t.Error("the card lost its terminal in the restart")
	}
	info := term.Info()
	if !info.Running {
		t.Error("the restarted terminal is not reported as running")
	}
	if info.ExitCode != 0 {
		t.Errorf("exit code %d is the refused launch's, not this one's", info.ExitCode)
	}
	if strings.Contains(info.Command, "--continue") {
		t.Errorf("the command still asks to continue: %s", info.Command)
	}
	if err := term.Write([]byte("hello\n")); err != nil {
		t.Fatal(err)
	}
	if !waitForOutput(t, updates, "typed:hello") {
		t.Fatal("the restarted CLI never heard what was typed")
	}

	// Nothing happened to the card: the refusal was between us and the CLI.
	if comments := writer.cardComments("card-refused"); len(comments) != 0 {
		t.Errorf("the card was told about the refused resume: %v", comments)
	}
}

// A list of open terminals is read by what each conversation is about, so both
// halves of that line have to survive: the name a person gave it, and the recap
// the agent wrote. The conversation continued is the same conversation.
func TestAConversationKeepsItsNameAndItsRecap(t *testing.T) {
	fakeResumingCLI(t)
	m, _, _, project := testManager(t, "idle", nil)
	m.SetOrigin("http://127.0.0.1:8088/")
	agent := AgentEntry{Name: "cl", Kind: AgentKindClaude}

	term, err := m.startTerminal(terminalSpec{
		cardID: "card-named", boardID: "board1", title: "Починить окно",
		workdirPath: project, agent: agent,
	})
	if err != nil {
		t.Fatal(err)
	}

	// The agent says what it is doing, through the tools it already has — the
	// grant is what names the conversation, so it cannot describe another.
	if term.boardToken == "" {
		t.Fatal("the terminal was given no board tools, so the agent cannot describe it")
	}
	if err := m.DescribeTerminalFromTools(term.boardToken, "разбираю, почему окно открывается пополам"); err != nil {
		t.Fatal(err)
	}
	if got := term.Info().Summary; got != "разбираю, почему окно открывается пополам" {
		t.Errorf("summary %q, want what the agent said", got)
	}

	// And a person calls it what it is to them.
	if err := m.RenameTerminal(term.ID, "  Окно пополам  "); err != nil {
		t.Fatal(err)
	}
	if got := term.Info().Title; got != "Окно пополам" {
		t.Errorf("title %q, want the name a person typed", got)
	}
	if err := m.RenameTerminal(term.ID, "   "); err == nil {
		t.Error("a conversation was left with no name at all")
	}

	_ = m.CloseTerminal(term.ID)
	<-term.Done()

	// The next terminal on the same stage is the same conversation: the card's
	// own title must not take the name back.
	next, err := m.startTerminal(terminalSpec{
		cardID: "card-named", boardID: "board1", title: "Починить окно",
		workdirPath: project, agent: agent,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = m.CloseTerminal(next.ID) }()
	info := next.Info()
	if info.Title != "Окно пополам" {
		t.Errorf("the resumed conversation is called %q again", info.Title)
	}
	if info.Summary == "" {
		t.Error("the resumed conversation lost what it was about")
	}
}

// The recap is the conversation's, and the grant is what says which conversation
// that is: a run with no terminal behind it has nothing to describe.
func TestOnlyAConversationCanBeDescribed(t *testing.T) {
	m, _, _, _ := testManager(t, "idle", nil)

	if err := m.DescribeTerminalFromTools("not-a-token", "что-то"); err == nil {
		t.Error("a made-up token described a conversation")
	}
	if err := m.DescribeTerminalFromTools(m.GrantBoardTools("board-1", "card-1", ""), "что-то"); err == nil {
		t.Error("a grant with no terminal behind it described one")
	}
}

// The restart is for a resume the CLI refused, and a terminal somebody closed is
// not that: it must stay closed.
func TestAClosedTerminalDoesNotComeBack(t *testing.T) {
	fakeResumingCLI(t)
	m, _, _, project := testManager(t, "idle", nil)

	term, err := m.startTerminal(terminalSpec{
		cardID: "card-closed", boardID: "board1", title: "Закрытый терминал",
		workdirPath: project, agent: AgentEntry{Name: "cl", Kind: AgentKindClaude},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, updates, unsubscribe := term.Subscribe()
	defer unsubscribe()
	if !waitForOutput(t, updates, "fresh-conversation") {
		t.Fatal("the CLI never opened")
	}

	if err := m.CloseTerminal(term.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-term.Done():
	case <-time.After(10 * time.Second):
		t.Fatal("a closed terminal never ended")
	}
	// terminalEnded runs on the pump goroutine, just after Done is closed.
	deadline := time.Now().Add(5 * time.Second)
	for m.Terminal(term.ID) != nil {
		if time.Now().After(deadline) {
			t.Fatal("a closed terminal is still live")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// The restart happens once, for a launch that asked to continue something, and
// only for an exit that came too soon to have been work.
func TestOnlyARefusedResumeIsRestarted(t *testing.T) {
	cases := []struct {
		name    string
		session *TerminalSession
	}{
		{
			name:    "a launch that was not resuming has nothing to fall back to",
			session: &TerminalSession{exitCode: 1, launchedAt: time.Now()},
		},
		{
			name:    "a CLI that finished cleanly is finished",
			session: &TerminalSession{freshArgv: []string{"claude"}, exitCode: 0, launchedAt: time.Now()},
		},
		{
			name:    "a kill is this app closing the terminal, and stays closed",
			session: &TerminalSession{freshArgv: []string{"claude"}, exitCode: -1, launchedAt: time.Now()},
		},
		{
			name: "an exit long after the launch is the CLI's own report to make",
			session: &TerminalSession{freshArgv: []string{"claude"}, exitCode: 1,
				launchedAt: time.Now().Add(-2 * resumeRefusedWindow)},
		},
		{
			name: "the fallback is offered once",
			session: &TerminalSession{freshArgv: []string{"claude"}, exitCode: 1,
				launchedAt: time.Now(), restarted: true},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if c.session.restartFresh() {
				t.Error("the terminal was restarted")
			}
		})
	}
}

// Planning without a folder is the board's own conversation: it opens in
// «черновики доски», exactly as a card's folderless conversation does, and says
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
		t.Error("the info does not say this is «черновики доски»")
	}
}

// The card's own conversation opens with what the card says. The person who
// clicked the button has the card in front of them and the agent has nothing —
// what everybody typed first was the title they were both looking at.
func TestTheCardsConversationOpensWithTheCard(t *testing.T) {
	fakeCLIOnPath(t, "claude", "sleep 30")
	m, _, _, _ := testManager(t, "idle", func(cfg *Config) {
		cfg.Agents = []AgentEntry{{Name: "cl", Kind: AgentKindClaude}}
	})
	m.SetOrigin("http://127.0.0.1:8088/")

	term, err := m.StartCardTerminal("card-intro", "", "cl")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = m.CloseTerminal(term.ID) }()

	opening := strings.Join(term.Argv, " ")
	for _, want := range []string{"Test task", "Do nothing useful."} {
		if !strings.Contains(opening, want) {
			t.Errorf("the conversation opened without %q:\n%s", want, opening)
		}
	}
	// It is a card being thought about, not a task being handed over: a stage
	// says the opposite, and says it with its own prompt.
	if strings.Contains(opening, "Task: Test task") {
		t.Errorf("the card's own conversation was handed the stage's brief:\n%s", opening)
	}
}

// And it opens with it once. A conversation being continued was told a while
// ago, and saying it again reads as a new instruction rather than as context.
func TestAResumedConversationIsNotToldTheCardAgain(t *testing.T) {
	fakeCLIOnPath(t, "claude", "sleep 30")
	m, _, _, _ := testManager(t, "idle", func(cfg *Config) {
		cfg.Agents = []AgentEntry{{Name: "cl", Kind: AgentKindClaude}}
	})
	m.SetOrigin("http://127.0.0.1:8088/")

	first, err := m.StartCardTerminal("card-intro", "", "cl")
	if err != nil {
		t.Fatal(err)
	}
	_ = m.CloseTerminal(first.ID)
	<-first.Done()

	again, err := m.StartCardTerminal("card-intro", "", "cl")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = m.CloseTerminal(again.ID) }()
	if opening := strings.Join(again.Argv, " "); strings.Contains(opening, "Do nothing useful.") {
		t.Errorf("the card was read out to a conversation that already knows it:\n%s", opening)
	}
}

// Throwing a conversation away is the only way the card's own one ends: the CLI
// in it stops and the record goes with it, so the next one opens on a blank
// screen instead of continuing this one. And the card hears nothing about it —
// the record it would point at is going too.
func TestADiscardedConversationIsForgottenQuietly(t *testing.T) {
	fakeCLIOnPath(t, "claude", "sleep 30")
	m, writer, _, _ := testManager(t, "idle", func(cfg *Config) {
		cfg.Agents = []AgentEntry{{Name: "cl", Kind: AgentKindClaude}}
	})
	m.SetOrigin("http://127.0.0.1:8088/")

	term, err := m.StartCardTerminal("card-gone", "", "cl")
	if err != nil {
		t.Fatal(err)
	}
	if err := m.DeleteCardConversation("card-gone", nodeNone); err != nil {
		t.Fatal(err)
	}
	<-term.Done()

	if _, ok, err := m.store.LastTerminalForCardNode("card-gone", nodeNone); err != nil || ok {
		t.Errorf("the conversation is still on record (%v, %v)", ok, err)
	}
	// What is left is the empty place to talk, not the conversation: a row with
	// nobody in it and nothing said.
	for _, row := range m.CardConversations("card-gone") {
		if row.Agent != "" || row.StartedAt != "" {
			t.Errorf("the card still lists a conversation that was thrown away: %+v", row)
		}
	}
	// Give the exit path its moment: it runs on the pty's own goroutine.
	waitFor(t, 5*time.Second, "the terminal to be forgotten", func() bool {
		return m.Terminal(term.ID) == nil
	})
	if comments := writer.cardComments("card-gone"); len(comments) != 0 {
		t.Errorf("the card was told about a conversation somebody deleted: %v", comments)
	}
}

// A stage's conversation belongs to the route, which may still be waiting on it:
// a card standing on a stage whose CLI was taken out from under it is a stall
// nobody asked for.
func TestAStagesConversationCannotBeThrownAway(t *testing.T) {
	fakeCLIOnPath(t, "claude", "sleep 30")
	m, _, _, project := testManager(t, "idle", nil)
	m.SetOrigin("http://127.0.0.1:8088/")

	term, err := m.startTerminal(terminalSpec{
		cardID: "card-stage", nodeID: "opt-work", boardID: "board1", title: "Работа",
		workdirPath: project, agent: AgentEntry{Name: "cl", Kind: AgentKindClaude}, stage: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = m.CloseTerminal(term.ID) }()

	if err := m.DeleteCardConversation("card-stage", "opt-work"); err == nil {
		t.Fatal("a stage's conversation was thrown away from under the route")
	}
	if m.Terminal(term.ID) == nil {
		t.Error("the stage's CLI was ended anyway")
	}
}

// Nothing but the agent knows what a conversation in a pty is about, so it is
// asked — in the conversation, since that is the only way in — and it answers
// through the tools it already has.
func TestTheAgentIsAskedToNameTheConversation(t *testing.T) {
	fakeCLIOnPath(t, "claude", "sleep 30")
	m, _, _, project := testManager(t, "idle", nil)
	m.SetOrigin("http://127.0.0.1:8088/")

	term, err := m.startTerminal(terminalSpec{
		cardID: "card-name", boardID: "board1", title: "Починить окно",
		workdirPath: project, agent: AgentEntry{Name: "cl", Kind: AgentKindClaude},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = m.CloseTerminal(term.ID) }()

	if err := m.AskTerminalName(term.ID); err != nil {
		t.Fatal(err)
	}
	if err := m.NameTerminalFromTools(term.boardToken, "  Окно пополам  "); err != nil {
		t.Fatal(err)
	}
	if got := term.Info().Title; got != "Окно пополам" {
		t.Errorf("the conversation is called %q, want what the agent answered", got)
	}
	// A sentence is not a name: the row it is drawn in has to stay a row.
	long := strings.Repeat("длинно ", 40)
	if err := m.NameTerminalFromTools(term.boardToken, long); err != nil {
		t.Fatal(err)
	}
	if got := []rune(term.Info().Title); len(got) > terminalTitleLimit+1 {
		t.Errorf("a name of %d runes was kept whole", len(got))
	}
}

// A CLI that was handed no board tools has nothing to answer with, so it is
// never asked: a message typed into somebody's terminal that cannot lead
// anywhere is an interruption and nothing else.
func TestACLIWithNoToolsIsNotAskedForAName(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("no shell to stand in for an agent CLI")
	}
	m, _, _, project := testManager(t, "idle", nil)

	term, err := m.startTerminal(terminalSpec{
		cardID: "card-plain", boardID: "board1", title: "Без инструментов",
		workdirPath: project,
		agent:       AgentEntry{Name: "shellish", Kind: AgentKindClaude, TerminalCommand: []string{"sh"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = m.CloseTerminal(term.ID) }()

	if term.Info().Tools {
		t.Fatal("a terminal with its own argv was handed the board tools")
	}
	if err := m.AskTerminalName(term.ID); err == nil {
		t.Error("a CLI with nothing to answer through was asked for a name")
	}
}

// The card's own conversation is not the work on it, and saying so is what
// keeps the two from colliding. It claims nothing — no branch appears because
// somebody thought out loud — and the route never finds it, whatever column the
// card is standing in when it is opened.
func TestTheCardsOwnConversationIsNotTheWorkOnIt(t *testing.T) {
	fakeCLIOnPath(t, "claude", "sleep 30")
	m, _, _, project := testManager(t, "idle", func(cfg *Config) {
		cfg.Agents = []AgentEntry{{Name: "cl", Kind: AgentKindClaude}}
	})
	m.SetOrigin("http://127.0.0.1:8088/")

	talk, err := m.StartCardTalk("card-talk", "", "")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = m.CloseTerminal(talk.ID) }()

	if !talk.Info().Talk || talk.NodeID != nodeTalk {
		t.Errorf("the card's own conversation is filed as %q", talk.NodeID)
	}
	if talk.Branch != "" {
		t.Errorf("thinking about the card left it a branch (%q)", talk.Branch)
	}

	// The card stands on a column that works it, and the stage looks for its
	// own conversation there — not for this one.
	stage, err := m.startStageTerminal(&Session{
		CardID: "card-talk", BoardID: "board1", NodeID: "opt-work", ColumnName: "В работе",
		Title: "Test task", PromptText: "Task: Test task",
		WorkdirPath: project, Agent: AgentEntry{Name: "cl", Kind: AgentKindClaude},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = m.CloseTerminal(stage.ID) }()
	if stage.ID == talk.ID {
		t.Fatal("the route typed the card's task into the conversation about it")
	}

	// Opening it again is continuing it, not starting a second one.
	again, err := m.StartCardTalk("card-talk", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if again.ID != talk.ID {
		t.Errorf("a second conversation (%s) opened beside the card's own (%s)", again.ID, talk.ID)
	}
}

// Conversations are keyed by node, and two nodes are two rows that have to
// read as two: the panel once drew a pair both named after the card, in the
// same folder, with the same agent — «два терминала, но они одинаковые».
func TestConversationsOnTwoNodesAreTwoDifferentRows(t *testing.T) {
	fakeCLIOnPath(t, "claude", "sleep 30")
	m, _, _, project := testManager(t, "idle", func(cfg *Config) {
		cfg.Agents = []AgentEntry{{Name: "cl", Kind: AgentKindClaude}}
	})
	m.SetOrigin("http://127.0.0.1:8088/")

	// The conversation of the node the card stands on — nodeNone here, since
	// the test's card carries no column at all.
	own, err := m.StartCardTerminal("card-two", "", "cl")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = m.CloseTerminal(own.ID) }()

	// And a stage on a column of its own: a different node, a different row,
	// keyed by the column's option id exactly as a routed stage would be.
	stage, err := m.startStageTerminal(&Session{
		CardID: "card-two", BoardID: "board1", NodeID: "opt-work", ColumnName: "В работе",
		Title: "Test task", PromptText: "Task: Test task",
		WorkdirPath: project, Agent: AgentEntry{Name: "cl", Kind: AgentKindClaude},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = m.CloseTerminal(stage.ID) }()

	rows := m.CardConversations("card-two")
	if len(rows) != 3 {
		t.Fatalf("the card has %d rows, want its own, the current node's and the stage's: %+v", len(rows), rows)
	}

	// The card's own conversation stands above the work, spoken in or not: it
	// is the one that asks nothing of the card, and being first is what says it
	// is not one of the stages.
	if !rows[0].Talk {
		t.Errorf("the first row is %+v, and the card's own conversation is not first", rows[0])
	}
	// Neither is named after the card: a terminal starts out titled with it, so
	// keeping that would name every row of the list the same thing. The stage's
	// row is named by its column instead.
	for _, row := range rows {
		if row.Title != "" {
			t.Errorf("a row is named %q, which is what the card is called", row.Title)
		}
	}
	var stageRow *CardConversation
	for i := range rows {
		if rows[i].NodeID == "opt-work" {
			stageRow = &rows[i]
		}
	}
	if stageRow == nil {
		t.Fatalf("the stage's node has no row: %+v", rows)
	}
	if stageRow.Column != "В работе" {
		t.Errorf("the stage's row is called %q, want the column it ran in", stageRow.Column)
	}
	if !stageRow.Stage || !stageRow.Running {
		t.Errorf("the stage's row does not say a route is running it: %+v", *stageRow)
	}
	// And the work is in the order the panel opens it: the node the card stands
	// on before the stages it has been through.
	if !rows[1].Current || rows[2].Current {
		t.Errorf("the current node's row is not the first of the work: %+v", rows)
	}
}
