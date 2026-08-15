package acp

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// hookManager is a manager with one grant open, which is what a running stage
// looks like to the hook.
func hookManager(t *testing.T) (*Manager, *fakeEmitter, string) {
	t.Helper()
	emitter := &fakeEmitter{}
	m, _, _, _, _ := testManagerWithEmitter(t, "idle", nil)
	m.ui = emitter
	token := m.GrantBoardTools("board1", "card-1", "term-1")
	if token == "" {
		t.Fatal("no grant, no hook")
	}
	return m, emitter, token
}

// The point of the whole hook: a CLI in a pty has no protocol to ask through,
// so it runs a command instead — and the question lands on the card as a
// question, with the tool and its arguments in it, rather than as forty-five
// seconds of silence.
func TestTheCLIsPermissionRequestBecomesAQuestionOnTheCard(t *testing.T) {
	m, emitter, token := hookManager(t)

	answered := make(chan ToolDecision, 1)
	go func() {
		d, err := m.AskToolPermission(context.Background(), token, ToolAsk{
			Tool:  "Bash",
			Input: json.RawMessage(`{"command":"rm -rf build","description":"clean"}`),
		})
		if err != nil {
			t.Error(err)
		}
		answered <- d
	}()

	q := waitForQuestion(t, m)
	if q.Tool != "Bash" {
		t.Errorf("the question does not name the tool: %+v", q)
	}
	if !strings.Contains(q.Text, "rm -rf build") {
		t.Errorf("the question does not say what the agent wants to do: %q", q.Text)
	}
	// Two answers and no more: this is a permission, not a form.
	if len(q.Options) != 2 {
		t.Fatalf("want allow and deny, got %+v", q.Options)
	}
	// And the card says it is waiting, in the one place everything else waiting
	// is shown.
	if p := lastAttention(emitter, "q:"+q.ID); p == nil || p["awaiting"] != true {
		t.Errorf("the wait is not on the card: %v", p)
	}

	if err := m.AnswerQuestion(q.ID, Answer{OptionID: toolAllow}); err != nil {
		t.Fatal(err)
	}
	if d := <-answered; d.Behavior != toolAllow {
		t.Errorf("the person allowed it and the CLI was told %q", d.Behavior)
	}
}

// A denial has to reach the CLI as a denial: this is the half that can stop an
// agent doing something, and getting it wrong the other way is worse than
// useless.
func TestDenyingOnTheCardDeniesInTheCLI(t *testing.T) {
	m, _, token := hookManager(t)

	answered := make(chan ToolDecision, 1)
	go func() {
		d, _ := m.AskToolPermission(context.Background(), token, ToolAsk{Tool: "Write"})
		answered <- d
	}()

	q := waitForQuestion(t, m)
	if err := m.AnswerQuestion(q.ID, Answer{OptionID: toolDeny, Text: "не сюда"}); err != nil {
		t.Fatal(err)
	}
	d := <-answered
	if d.Behavior != toolDeny || d.Message != "не сюда" {
		t.Errorf("the refusal did not reach the CLI: %+v", d)
	}
}

// Nobody answering is not a failure and must never read as one. The CLI drew its
// own box at the same moment we asked, so an unanswered question means the
// person is answering it there — and an empty decision is what leaves them to.
func TestNobodyAnsweringLeavesTheQuestionToTheTerminal(t *testing.T) {
	m, _, token := hookManager(t)

	// The CLI gave up waiting and closed the connection, which is what the
	// handler's request context is.
	ctx, cancel := context.WithCancel(context.Background())
	answered := make(chan ToolDecision, 1)
	go func() {
		d, err := m.AskToolPermission(ctx, token, ToolAsk{Tool: "Bash"})
		if err != nil {
			t.Error(err)
		}
		answered <- d
	}()
	waitForQuestion(t, m)
	cancel()

	d := <-answered
	if d.Behavior != "" {
		t.Errorf("a question nobody answered decided %q", d.Behavior)
	}
}

// A token is the whole of the authentication, exactly as it is for the board
// tools: one found afterwards, or made up, opens nothing.
func TestAHookWithoutAGrantAsksNobody(t *testing.T) {
	m, _, token := hookManager(t)
	m.RevokeBoardTools(token)

	if _, err := m.AskToolPermission(context.Background(), token, ToolAsk{Tool: "Bash"}); err == nil {
		t.Error("a revoked grant still asked the board")
	}
	if _, err := m.AskToolPermission(context.Background(), "made-up", ToolAsk{Tool: "Bash"}); err == nil {
		t.Error("a token nobody minted still asked the board")
	}
}

// What a person reads off the card. The arguments are the vendor's schema, so
// this takes the shapes every CLI agrees on and never pretends to more.
func TestTheQuestionSaysWhatTheAgentWantsToDo(t *testing.T) {
	cases := []struct {
		name  string
		tool  string
		input string
		want  string
	}{
		{"a command is the command", "Bash", `{"command":"git push","description":"push"}`, "Bash: git push"},
		{"an edit is the file", "Write", `{"file_path":"/tmp/a.txt","content":"…"}`, "Write: /tmp/a.txt"},
		{"a fetch is the address", "WebFetch", `{"url":"https://example.com"}`, "WebFetch: https://example.com"},
		{"no arguments is just the tool", "Something", ``, "Something"},
		{"an unknown shape names its fields rather than dumping them", "Odd", `{"beta":1,"alpha":2}`, "Odd (alpha, beta)"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := askSummary(c.tool, json.RawMessage(c.input)); got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}
}

// The hook is registered on the command line, so nothing of ours is written
// into the folder the agent works in — and the settings have to be a JSON
// string Claude Code will actually take.
func TestTheHookIsRegisteredOnTheCommandLine(t *testing.T) {
	args := claudeHookArgs("'/Applications/X.app/x' hook 'http://127.0.0.1:1' 'tok'")
	if len(args) != 2 || args[0] != "--settings" {
		t.Fatalf("want --settings <json>, got %q", args)
	}
	var settings struct {
		Hooks map[string][]struct {
			Hooks []struct {
				Type    string `json:"type"`
				Command string `json:"command"`
				Timeout int    `json:"timeout"`
			} `json:"hooks"`
		} `json:"hooks"`
	}
	if err := json.Unmarshal([]byte(args[1]), &settings); err != nil {
		t.Fatalf("the settings are not JSON: %v", err)
	}
	group, ok := settings.Hooks["PermissionRequest"]
	if !ok || len(group) != 1 || len(group[0].Hooks) != 1 {
		t.Fatalf("PermissionRequest is not registered: %s", args[1])
	}
	entry := group[0].Hooks[0]
	if entry.Type != "command" || !strings.Contains(entry.Command, " hook ") {
		t.Errorf("the hook does not run this binary: %+v", entry)
	}
	// Longer than the app's own hold, so the app answers before the CLI gives
	// up and there is never a killed hook to interpret.
	if time.Duration(entry.Timeout)*time.Second <= hookHold {
		t.Errorf("the CLI would give up (%ds) before the app stops holding (%s)", entry.Timeout, hookHold)
	}

	// An agent with no grant gets no hook rather than a broken flag.
	if got := claudeHookArgs(""); got != nil {
		t.Errorf("a hook with no command was still registered: %q", got)
	}
}

// A path with a space in it is an ordinary macOS install, and an unquoted one
// would make the CLI run a command that does not exist.
func TestTheHookCommandSurvivesAShell(t *testing.T) {
	got := shellQuote("/Applications/My App.app/Contents/MacOS/XCIII")
	if got != `'/Applications/My App.app/Contents/MacOS/XCIII'` {
		t.Errorf("got %s", got)
	}
	if got := shellQuote("it's here"); got != `'it'\''s here'` {
		t.Errorf("a quote in the path was not escaped: %s", got)
	}
}

// The two ends of the wire, in the shapes Claude Code writes and reads. Both
// were measured against the real CLI (docs/attention-hooks.md); this is what
// keeps them from drifting.
func TestTheClaudeWireIsWhatWasMeasured(t *testing.T) {
	ask, err := ParseClaudeHook([]byte(`{"hook_event_name":"PermissionRequest",
		"tool_name":"Write","tool_input":{"file_path":"/tmp/a"},"cwd":"/w"}`))
	if err != nil {
		t.Fatal(err)
	}
	if ask.Tool != "Write" || ask.Cwd != "/w" || !strings.Contains(string(ask.Input), "/tmp/a") {
		t.Errorf("the payload was not read: %+v", ask)
	}

	// An event we did not register for is refused rather than answered blind.
	if _, err := ParseClaudeHook([]byte(`{"hook_event_name":"PreToolUse","tool_name":"Write"}`)); err == nil {
		t.Error("a hook answered an event it was not registered for")
	}

	out, err := ClaudeHookOutput(ToolDecision{Behavior: toolAllow})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), `"behavior":"allow"`) ||
		!strings.Contains(string(out), `"hookEventName":"PermissionRequest"`) {
		t.Errorf("the decision is not in the shape the CLI reads: %s", out)
	}

	// Nobody answered: the decision field is left out entirely, because the
	// schema has no spelling for "no opinion" and an empty behavior would be
	// read as one.
	out, err = ClaudeHookOutput(ToolDecision{})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(out), "decision") {
		t.Errorf("an unanswered question was sent as a decision: %s", out)
	}
}

// waitForQuestion is the question the hook put up, once it is up.
func waitForQuestion(t *testing.T, m *Manager) Question {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if qs := m.Questions(); len(qs) > 0 {
			return qs[0]
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("the hook never put a question on the card")
	return Question{}
}
