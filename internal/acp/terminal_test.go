// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

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
			got, err := terminalCommand(c.entry, c.resume)
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
	got, err := terminalCommand(AgentEntry{Name: "c", Kind: AgentKindClaude, BinPath: "/opt/claude-agent-acp"}, false)
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
	_, err := terminalCommand(AgentEntry{Name: "g", Kind: AgentKindACP, Command: []string{"gemini", "--acp"}}, false)
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
		if len(comments) >= 2 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if len(comments) < 2 {
		t.Fatalf("card was told %d things about its terminal, want an opening and a closing one: %v", len(comments), comments)
	}
	joined := strings.Join(comments, "\n")
	for _, want := range []string{"Открыт терминал", "from the terminal"} {
		if !strings.Contains(joined, want) {
			t.Errorf("the card was not told %q:\n%s", want, joined)
		}
	}
	if m.Terminal(term.ID) != nil {
		t.Error("a finished terminal is still listed as live")
	}
}

// An agent that has asked something stops printing and waits, and the window it
// waits in is usually one nobody is looking at. That silence is the only signal
// there is, and the card is where it has to show up.
func TestTerminalSaysWhenItIsWaitingForAPerson(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("no shell to stand in for an agent CLI")
	}
	m, _, _, project, emitter := testManagerWithEmitter(t, "idle", nil)
	m.terminalQuiet = 300 * time.Millisecond

	term, err := m.startTerminal(terminalSpec{
		cardID:      "card-wait",
		boardID:     "board1",
		title:       "Ждущая задача",
		projectPath: project,
		agent:       AgentEntry{Name: "shellish", Kind: AgentKindClaude, TerminalCommand: []string{"sh"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = m.CloseTerminal(term.ID) }()

	// A shell that has printed something and then sits at its prompt is exactly
	// the shape of an agent that has asked a question: output, then nothing.
	_, updates, unsubscribe := term.Subscribe()
	defer unsubscribe()
	if err := term.Write([]byte("echo asked-something\n")); err != nil {
		t.Fatal(err)
	}
	if !waitForOutput(t, updates, "asked-something") {
		t.Fatal("the CLI never printed anything")
	}

	waitFor(t, 10*time.Second, "the terminal to say it is waiting", func() bool { return term.Awaiting() })

	waiting := m.Attention()
	if len(waiting) != 1 || waiting[0].CardID != "card-wait" || waiting[0].TerminalID != term.ID {
		t.Fatalf("waiting for a person: %+v, want the one card", waiting)
	}
	if waiting[0].Title != "Ждущая задача" || waiting[0].Agent != "shellish" {
		t.Errorf("a notification could not name what it points at: %+v", waiting[0])
	}
	if got := lastAttention(emitter, term.ID); got == nil || got["awaiting"] != true {
		t.Errorf("the UI was never told the terminal is waiting: %v", got)
	}

	// Typing is what ends a wait: the person the CLI was waiting for arrived.
	if err := term.Write([]byte("echo answered\n")); err != nil {
		t.Fatal(err)
	}
	if term.Awaiting() {
		t.Error("the terminal still says it is waiting after somebody typed")
	}
	if len(m.Attention()) != 0 {
		t.Error("an answered terminal is still listed as waiting")
	}
	if got := lastAttention(emitter, term.ID); got == nil || got["awaiting"] != false {
		t.Errorf("the UI was never told the wait ended: %v", got)
	}
}

// A CLI that is working prints as it goes, and that must not be mistaken for a
// question: nothing is more useless than an indicator that is always on.
func TestABusyTerminalIsNotWaitingForAnybody(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("no shell to stand in for an agent CLI")
	}
	m, _, _, project, _ := testManagerWithEmitter(t, "idle", nil)
	m.terminalQuiet = 300 * time.Millisecond

	term, err := m.startTerminal(terminalSpec{
		cardID:      "card-busy",
		projectPath: project,
		agent:       AgentEntry{Name: "shellish", Kind: AgentKindClaude, TerminalCommand: []string{"sh"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = m.CloseTerminal(term.ID) }()

	_, updates, unsubscribe := term.Subscribe()
	defer unsubscribe()
	// A spinner, spelled the way a shell can spell one: output every 50ms for
	// well over the threshold.
	if err := term.Write([]byte("i=0; while [ $i -lt 30 ]; do echo tick; sleep 0.05; i=$((i+1)); done\n")); err != nil {
		t.Fatal(err)
	}
	if !waitForOutput(t, updates, "tick") {
		t.Fatal("the CLI never printed anything")
	}

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if term.Awaiting() {
			t.Fatal("a terminal printing all the while was reported as waiting for a person")
		}
		time.Sleep(50 * time.Millisecond)
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
	argv, err := terminalCommand(agent, resume)
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

	first, err := m.StartPlanningTerminal("testrepo", "shellish")
	if err != nil {
		t.Fatal(err)
	}
	second, err := m.StartPlanningTerminal("testrepo", "shellish")
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
