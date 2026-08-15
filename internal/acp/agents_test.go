package acp

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
)

func agentManager(t *testing.T, cfgPath string, agents ...AgentEntry) *Manager {
	t.Helper()
	cfg := DefaultConfig(t.TempDir())
	cfg.Agents = agents
	return NewManager(cfg, cfgPath, nil, newFakeWriter(), &fakeEmitter{}, nil)
}

func TestAddUpdateRemoveAgentPersists(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	m := agentManager(t, cfgPath)

	if _, err := m.AddAgent(AgentEntry{Name: "codex-a", Kind: "codex", Env: map[string]string{"CODEX_HOME": "/tmp/a"}}); err != nil {
		t.Fatal(err)
	}

	// Empty name and unknown kind are rejected.
	if _, err := m.AddAgent(AgentEntry{Name: "", Kind: "claude"}); err == nil {
		t.Error("empty name accepted")
	}
	if _, err := m.AddAgent(AgentEntry{Name: "bad", Kind: "gemini"}); err == nil {
		t.Error("unknown kind accepted")
	}
	// Duplicate name (case-insensitive) rejected.
	if _, err := m.AddAgent(AgentEntry{Name: "CODEX-A", Kind: "codex"}); err == nil {
		t.Error("duplicate name accepted")
	}

	// Persisted and reloadable.
	loaded, err := LoadConfig(cfgPath, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Agents) != 1 || loaded.Agents[0].Env["CODEX_HOME"] != "/tmp/a" {
		t.Fatalf("agent not persisted: %+v", loaded.Agents)
	}

	// Update replaces fields for the matching name.
	if _, err := m.UpdateAgent(AgentEntry{Name: "codex-a", Kind: "codex", Model: "gpt-5"}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.UpdateAgent(AgentEntry{Name: "missing", Kind: "codex"}); err == nil {
		t.Error("updating missing agent should fail")
	}
	loaded, _ = LoadConfig(cfgPath, t.TempDir())
	if loaded.Agents[0].Model != "gpt-5" {
		t.Fatalf("update not persisted: %+v", loaded.Agents)
	}

	if err := m.RemoveAgent("codex-a"); err != nil {
		t.Fatal(err)
	}
	if err := m.RemoveAgent("codex-a"); err == nil {
		t.Error("removing missing agent should fail")
	}
	loaded, _ = LoadConfig(cfgPath, t.TempDir())
	if len(loaded.Agents) != 0 {
		t.Fatalf("removal not persisted: %+v", loaded.Agents)
	}
}

func TestAgentKindValidation(t *testing.T) {
	m := agentManager(t, "")

	// The ACP-native kinds we know how to launch need no command; the generic
	// acp kind does.
	for _, kind := range []string{"antigravity", "copilot", "junie"} {
		if _, err := m.AddAgent(AgentEntry{Name: kind, Kind: kind}); err != nil {
			t.Errorf("%s without command should be valid: %v", kind, err)
		}
	}
	if _, err := m.AddAgent(AgentEntry{Name: "gen", Kind: "acp"}); err == nil {
		t.Error("acp kind without command should be rejected")
	}
	if _, err := m.AddAgent(AgentEntry{Name: "gem", Kind: "acp", Command: []string{"gemini", "--acp"}}); err != nil {
		t.Errorf("acp kind with command should be valid: %v", err)
	}
}

func TestAgentLaunch(t *testing.T) {
	m := agentManager(t, "")
	bin := writeFakeAgent(t, fakeClaudeHappy) // any existing executable

	// Explicit command overrides everything and appends Args.
	l, err := m.agentLaunch(AgentEntry{Name: "gem", Kind: "acp", Command: []string{"gemini", "--acp"}, Args: []string{"--yolo"}})
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(l.argv, " "); got != "gemini --acp --yolo" {
		t.Errorf("acp command argv = %q", got)
	}

	// Each known kind is launched the way its own adapter wants: the CLIs take
	// a flag and --model, while neither vendor adapter takes flags at all — the
	// claude model rides in the environment, the codex one is asked for over the
	// protocol once the session exists.
	for kind, want := range map[string]string{
		"antigravity": bin + " --acp --model m1",
		"copilot":     bin + " --acp --model m1",
		"junie":       bin + " --acp=true --model m1",
		"codex":       bin,
		"claude":      bin,
	} {
		l, err = m.agentLaunch(AgentEntry{Name: "g", Kind: kind, BinPath: bin, Model: "m1"})
		if err != nil {
			t.Fatal(err)
		}
		if got := strings.Join(l.argv, " "); got != want {
			t.Errorf("%s argv = %q, want %q", kind, got, want)
		}

		// A binPath that is not there errors rather than starting something else.
		if _, err := m.agentLaunch(AgentEntry{Name: "g", Kind: kind, BinPath: "/no/such/" + kind}); err == nil {
			t.Errorf("missing %s binary should error", kind)
		}
	}

	// The claude adapter refuses to run inside another Claude Code session, so
	// the markers of an outer session must be dropped — CLAUDE_CODE_CHILD_SESSION
	// above all, which turns transcript saving off and leaves nothing for a later
	// terminal to continue — and the model reaches it as ANTHROPIC_MODEL.
	l, err = m.agentLaunch(AgentEntry{Name: "c", Kind: "claude", BinPath: bin, Model: "opus"})
	if err != nil {
		t.Fatal(err)
	}
	if len(l.env) != 1 || l.env[0] != "ANTHROPIC_MODEL=opus" {
		t.Errorf("claude model env = %v", l.env)
	}
	for _, name := range []string{"CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ID"} {
		if !slices.Contains(l.dropEnv, name) {
			t.Errorf("claude dropEnv = %v, want it to drop %s", l.dropEnv, name)
		}
	}
	// The user's own configuration is not a session marker and has to survive.
	if slices.Contains(l.dropEnv, "CLAUDE_CODE_USE_BEDROCK") {
		t.Errorf("claude dropEnv = %v, want the user's own settings inherited", l.dropEnv)
	}

	// The codex adapter starts read-only, so the session has to be switched.
	l, _ = m.agentLaunch(AgentEntry{Name: "x", Kind: "codex", BinPath: bin})
	if l.mode != "agent" {
		t.Errorf("codex session mode = %q, want agent", l.mode)
	}

	// A wrapper command stands in front of the adapter — proxychains, a shim —
	// and nothing of ours is appended to it.
	wrapper := []string{"/bin/sh", "-c", "exec " + bin}
	l, err = m.agentLaunch(AgentEntry{Name: "c", Kind: "claude", BinPath: bin, Command: wrapper})
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(l.argv, " "); got != strings.Join(wrapper, " ") {
		t.Errorf("wrapped launch argv = %q", got)
	}
}

func TestAgentSpawnEnvProxy(t *testing.T) {
	envOf := func(a AgentEntry, net NetworkSettings) (map[string]string, map[string]bool) {
		env, drop := spawnEnv(a, net)
		vals := map[string]string{}
		for _, kv := range env {
			eq := strings.Index(kv, "=")
			vals[kv[:eq]] = kv[eq+1:] // later entries win, as they do in the child env
		}
		dropped := map[string]bool{}
		for _, k := range drop {
			dropped[k] = true
		}
		return vals, dropped
	}

	// A proxy expands to both cases and manages NO_PROXY as its pair.
	vals, dropped := envOf(AgentEntry{}, NetworkSettings{Proxy: "http://proxy.example.com:8080", NoProxy: "git.internal,localhost"})
	for _, k := range proxyEnvNames {
		if vals[k] != "http://proxy.example.com:8080" {
			t.Errorf("%s = %q, want the proxy URL", k, vals[k])
		}
		if !dropped[k] {
			t.Errorf("%s should be dropped from the inherited env", k)
		}
	}
	if vals["NO_PROXY"] != "git.internal,localhost" || vals["no_proxy"] != "git.internal,localhost" {
		t.Errorf("NO_PROXY = %q/%q", vals["NO_PROXY"], vals["no_proxy"])
	}

	// A CA bundle reaches every runtime's variable.
	vals, _ = envOf(AgentEntry{}, NetworkSettings{CACert: "/etc/my-ca.pem"})
	for _, k := range caCertEnvNames {
		if vals[k] != "/etc/my-ca.pem" {
			t.Errorf("%s = %q, want the CA path", k, vals[k])
		}
	}
	if _, ok := vals["HTTPS_PROXY"]; ok {
		t.Error("no proxy configured, HTTPS_PROXY should be left alone")
	}

	// The explicit env map wins over the expanded settings, including blanking
	// a proxy out; unrelated inherited proxy vars are still overridden.
	vals, dropped = envOf(
		AgentEntry{Env: map[string]string{"HTTPS_PROXY": "", "CODEX_HOME": "/tmp/a"}},
		NetworkSettings{Proxy: "http://proxy.example.com:8080"},
	)
	if vals["HTTPS_PROXY"] != "" {
		t.Errorf("Env should override the expanded proxy, got %q", vals["HTTPS_PROXY"])
	}
	if vals["HTTP_PROXY"] != "http://proxy.example.com:8080" || vals["CODEX_HOME"] != "/tmp/a" {
		t.Errorf("unexpected env: %v", vals)
	}
	if !dropped["CODEX_HOME"] || !dropped["HTTPS_PROXY"] {
		t.Error("agent env keys must be dropped from the inherited env")
	}

	// NoProxy alone does not invent a proxy.
	vals, _ = envOf(AgentEntry{}, NetworkSettings{NoProxy: "*.internal"})
	if vals["NO_PROXY"] != "*.internal" {
		t.Errorf("NO_PROXY = %q", vals["NO_PROXY"])
	}
	if _, ok := vals["ALL_PROXY"]; ok {
		t.Error("ALL_PROXY set without a proxy")
	}
}

// Who works a card is what the card says under «Кто занимается», and nothing
// else on it gets a vote. There used to be two other voters, and both were
// invisible: a property named `agent`, and any select option anywhere on the
// board spelled like an agent.
func TestNothingButTheAssigneeChoosesTheAgent(t *testing.T) {
	m := agentManager(t, "",
		AgentEntry{Name: "claude", Kind: "claude"},
		AgentEntry{Name: "codex-acct1", Kind: "codex"},
	)

	if _, err := m.resolveAgent(CardMoved{OptionNames: []string{"urgent", "codex-acct1"}}); err == nil {
		t.Error("a select option should not choose the agent")
	}
	if _, err := m.resolveAgent(CardMoved{Props: map[string]string{"agent": "codex-acct1"}}); err == nil {
		t.Error("a property named agent should not choose the agent")
	}

	// Ambiguous (several registered, none assigned) errors, and the message
	// says what to do about it.
	_, err := m.resolveAgent(CardMoved{Props: map[string]string{}})
	if err == nil || !strings.Contains(err.Error(), "codex-acct1") {
		t.Errorf("expected an error listing the registry, got %v", err)
	}
}

func TestResolveAgentByAssignee(t *testing.T) {
	m := agentManager(t, "",
		AgentEntry{Name: "claude", Kind: "claude"},
		AgentEntry{Name: "Codex Acct1", Kind: "codex"},
	)

	// The assignee's username routes the card; the account carries the folded
	// form of the registry name.
	got, err := m.resolveAgent(CardMoved{PersonNames: []string{"artem", "codex-acct1"}, Props: map[string]string{}})
	if err != nil || got.Name != "Codex Acct1" {
		t.Fatalf("assignee match failed: got=%+v err=%v", got, err)
	}

	// A tag beside the assignee changes nothing: the assignee is the answer.
	got, err = m.resolveAgent(CardMoved{
		PersonNames: []string{"claude"},
		OptionNames: []string{"Codex Acct1"},
		Props:       map[string]string{},
	})
	if err != nil || got.Name != "claude" {
		t.Fatalf("the assignee should decide: got=%+v err=%v", got, err)
	}

	// A property named `agent` beside the assignee changes nothing either.
	got, err = m.resolveAgent(CardMoved{
		PersonNames: []string{"claude"},
		Props:       map[string]string{"agent": "codex-acct1"},
	})
	if err != nil || got.Name != "claude" {
		t.Fatalf("the assignee should decide: got=%+v err=%v", got, err)
	}

	// A human assignee is simply not an agent.
	if _, err := m.resolveAgent(CardMoved{PersonNames: []string{"artem"}, Props: map[string]string{}}); err == nil {
		t.Error("a non-agent assignee should not resolve an agent")
	}
}

func TestAgentUsername(t *testing.T) {
	for in, want := range map[string]string{
		"claude":       "claude",
		"Codex Acct1":  "codex-acct1",
		"  My Agent  ": "my-agent",
		"claude/main":  "claude-main",
		"agent.two_3":  "agent.two_3",
		"---":          "",
		"":             "",

		// Every label on this board is Russian, and an agent named in it must
		// get an account like any other. Folding to ASCII gave «клаус» the
		// empty username, which AgentUsers skips — so the agent existed in the
		// registry, had no account, and could never be put in «Кто занимается».
		"клаус":       "клаус",
		"Клаус":       "клаус",
		"код-ревьюер": "код-ревьюер",

		// And the worse half of the same bug: a name that kept one ASCII digit
		// was provisioned under that digit alone.
		"клаус 2": "клаус-2",
	} {
		if got := AgentUsername(in); got != want {
			t.Errorf("AgentUsername(%q) = %q, want %q", in, got, want)
		}
	}
}

// Registering an agent is the moment it becomes a name a card can be assigned
// to, so it is the moment the account is made. Nothing opens a board to catch
// this up afterwards — that was a sync in search of an event.
func TestAddAgentMakesItsAccount(t *testing.T) {
	m := agentManager(t, filepath.Join(t.TempDir(), "config.json"))
	users := &fakeBoardUsers{}
	m.SetBoardUsers(users)

	if _, err := m.AddAgent(AgentEntry{Name: "клаус", Kind: "claude"}); err != nil {
		t.Fatal(err)
	}

	if len(users.accounts) != 1 || users.accounts[0].Username != "клаус" {
		t.Fatalf("accounts provisioned = %+v, want one for «клаус»", users.accounts)
	}
}

// And a registry that predates that is caught up once, when the app starts —
// which is also what gives an account to the agents that never got one because
// their names folded away.
func TestAgentAccountsAreCaughtUpAtStartup(t *testing.T) {
	m := agentManager(t, "", AgentEntry{Name: "клаус", Kind: "claude"}, AgentEntry{Name: "Codex", Kind: "codex"})
	users := &fakeBoardUsers{}
	m.SetBoardUsers(users)

	m.ensureAgentAccounts()

	if len(users.accounts) != 2 {
		t.Fatalf("accounts provisioned = %+v, want one for each registered agent", users.accounts)
	}
}

// A registry named in Russian is a registry the board can name back. This is
// the whole of the bug reported as «агенты есть, но в исполнителе их нет»: the
// sync asked for accounts and was handed nothing to create.
func TestAgentUsersKeepsRussianNames(t *testing.T) {
	m := &Manager{}
	m.cfg.Agents = []AgentEntry{{Name: "клаус", Kind: "claude"}, {Name: "Codex", Kind: "codex"}}

	users := m.AgentUsers()
	if len(users) != 2 {
		t.Fatalf("AgentUsers() = %+v, want an account for both agents", users)
	}
	if users[0].Username != "клаус" {
		t.Errorf("username for %q = %q, want %q", users[0].Name, users[0].Username, "клаус")
	}
}

// fakeBoardUsers records what the manager asked to provision and retire.
type fakeBoardUsers struct {
	boardID  string
	agents   []AgentUser
	accounts []AgentUser
	retired  []AgentUser
	err      error
	retryErr error

	// assigned is card → username, written from the session-start goroutine
	// and read by the test, hence its own lock.
	mu       sync.Mutex
	assigned map[string]string
}

func (f *fakeBoardUsers) EnsureAgentAccounts(_ context.Context, agents []AgentUser) ([]AgentUser, error) {
	f.accounts = append(f.accounts, agents...)
	if f.err != nil {
		return nil, f.err
	}
	return agents, nil
}

func (f *fakeBoardUsers) AssignCardAgent(_ context.Context, cardID string, agent AgentUser) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.assigned == nil {
		f.assigned = map[string]string{}
	}
	f.assigned[cardID] = agent.Username
	return nil
}

func (f *fakeBoardUsers) assignedTo(cardID string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.assigned[cardID]
}

func (f *fakeBoardUsers) RetireAgentUser(_ context.Context, agent AgentUser) (int, error) {
	if f.retryErr != nil {
		return 0, f.retryErr
	}
	f.retired = append(f.retired, agent)
	return 1, nil
}

func (f *fakeBoardUsers) EnsureAgentUsers(_ context.Context, boardID string, agents []AgentUser) ([]AgentUser, error) {
	f.boardID = boardID
	f.agents = agents
	if f.err != nil {
		return nil, f.err
	}
	out := make([]AgentUser, 0, len(agents))
	for i, a := range agents {
		a.UserID = fmt.Sprintf("uid-%d", i)
		a.Created = true
		out = append(out, a)
	}
	return out, nil
}

func TestSyncAgentUsers(t *testing.T) {
	m := agentManager(t, "", AgentEntry{Name: "Codex Acct1", Kind: "codex"}, AgentEntry{Name: "claude", Kind: "claude"})

	// Without a board-users implementation the feature is simply unavailable.
	if _, err := m.SyncAgentUsers(context.Background(), "board1"); err == nil {
		t.Error("expected an error without a BoardUsers implementation")
	}

	users := &fakeBoardUsers{}
	m.SetBoardUsers(users)
	got, err := m.SyncAgentUsers(context.Background(), "board1")
	if err != nil {
		t.Fatal(err)
	}
	if users.boardID != "board1" || len(got) != 2 {
		t.Fatalf("sync passed board=%q agents=%+v", users.boardID, got)
	}
	if got[0].Name != "Codex Acct1" || got[0].Username != "codex-acct1" {
		t.Errorf("first account = %+v, want the folded username", got[0])
	}
	if got[0].UserID == "" || !got[0].Created {
		t.Errorf("provisioning result not returned: %+v", got[0])
	}

	// An empty registry is a no-op, not an error: the UI syncs on every change,
	// including the ones that leave nothing to provision.
	empty := agentManager(t, "")
	empty.SetBoardUsers(&fakeBoardUsers{})
	synced, err := empty.SyncAgentUsers(context.Background(), "board1")
	if err != nil || len(synced) != 0 {
		t.Errorf("empty registry sync = %+v, err = %v", synced, err)
	}
}

func TestRemoveAgentRetiresItsAccount(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	users := &fakeBoardUsers{}
	m := agentManager(t, cfgPath, AgentEntry{Name: "Codex Acct1", Kind: "codex"})
	m.SetBoardUsers(users)

	if err := m.RemoveAgent("codex acct1"); err != nil { // name match is loose
		t.Fatal(err)
	}
	if len(m.Agents()) != 0 {
		t.Errorf("entry not removed: %+v", m.Agents())
	}
	if len(users.retired) != 1 || users.retired[0].Username != "codex-acct1" {
		t.Fatalf("account not retired: %+v", users.retired)
	}

	// A retirement that fails is reported, but the entry stays removed — the
	// registry is the source of truth and it has already been written.
	m2 := agentManager(t, cfgPath, AgentEntry{Name: "claude", Kind: "claude"})
	m2.SetBoardUsers(&fakeBoardUsers{retryErr: fmt.Errorf("board app is not ready")})
	err := m2.RemoveAgent("claude")
	if err == nil || !strings.Contains(err.Error(), "board app is not ready") {
		t.Errorf("expected the retirement failure to surface, got %v", err)
	}
	if len(m2.Agents()) != 0 {
		t.Errorf("entry should still be removed: %+v", m2.Agents())
	}

	// Removing an unknown agent is still an error, and touches no account.
	if err := m.RemoveAgent("nope"); err == nil {
		t.Error("removing a missing agent should fail")
	}
	if len(users.retired) != 1 {
		t.Errorf("a failed removal must not retire anything: %+v", users.retired)
	}
}

func TestResolveAgentSingleAndFallback(t *testing.T) {
	// Exactly one agent → used without a card selection.
	m := agentManager(t, "", AgentEntry{Name: "only", Kind: "codex"})
	got, err := m.resolveAgent(CardMoved{Props: map[string]string{}})
	if err != nil || got.Name != "only" {
		t.Fatalf("single-agent resolution failed: got=%+v err=%v", got, err)
	}

	// Empty registry → synthesized from AgentMode (default claude).
	m2 := agentManager(t, "")
	got, err = m2.resolveAgent(CardMoved{Props: map[string]string{}})
	if err != nil || got.Kind != AgentKindClaude {
		t.Fatalf("empty-registry fallback failed: got=%+v err=%v", got, err)
	}

	// Empty registry with acp-command mode → the configured argv, as the
	// generic acp kind: the mode names no agent of its own.
	m3 := agentManager(t, "")
	m3.cfg.AgentMode = agentModeCommand
	m3.cfg.AgentCommand = []string{"gemini", "--acp"}
	got, _ = m3.resolveAgent(CardMoved{Props: map[string]string{}})
	if got.Kind != AgentKindACP || strings.Join(got.Command, " ") != "gemini --acp" {
		t.Fatalf("expected the configured argv, got %+v", got)
	}

	// The same mode with nothing configured is a mistake worth naming.
	m4 := agentManager(t, "")
	m4.cfg.AgentMode = agentModeCommand
	if _, err := m4.resolveAgent(CardMoved{Props: map[string]string{}}); err == nil {
		t.Error("acp-command with no agentCommand should error")
	}
}

func TestLoadConfigMigratesLegacyTriggerColumn(t *testing.T) {
	dir := t.TempDir()
	write := func(triggerColumn string) Config {
		t.Helper()
		path := filepath.Join(t.TempDir(), "config.json")
		if err := os.WriteFile(path, []byte(`{"triggerColumn":"`+triggerColumn+`"}`), 0o600); err != nil {
			t.Fatal(err)
		}
		cfg, err := LoadConfig(path, dir)
		if err != nil {
			t.Fatal(err)
		}
		return cfg
	}

	// The abandoned default is rewritten, whatever its case…
	if got := write("To Agent").TriggerColumn; got != DefaultTriggerColumn {
		t.Errorf("legacy column = %q, want %q", got, DefaultTriggerColumn)
	}
	if got := write("to agent").TriggerColumn; got != DefaultTriggerColumn {
		t.Errorf("legacy column (lowercase) = %q, want %q", got, DefaultTriggerColumn)
	}
	// …but a column the user picked is theirs.
	if got := write("Ready for agent").TriggerColumn; got != "Ready for agent" {
		t.Errorf("custom column was rewritten to %q", got)
	}
}

// A prompt used to be one string for the whole machine, which meant the board
// of household chores and the board of code shared it and so nobody could write
// anything useful in it. Installs that did write something must not lose it: it
// moves to the boards it was actually reaching, and the global field goes.
func TestLoadConfigMovesTheOldPromptOntoTheBoardsThatRunSomething(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(t.TempDir(), "config.json")
	old := `{"systemPrompt":"Отвечай по-русски.",
		"columns":[{"boardId":"board1","property":"Статус","column":"В работе","action":"agent"}],
		"flows":[{"boardId":"board2","name":"Фича","nodes":[],"edges":[]}]}`
	if err := os.WriteFile(path, []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, err := LoadConfig(path, dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, board := range []string{"board1", "board2"} {
		if got := cfg.BoardPrompts[board]; got != "Отвечай по-русски." {
			t.Errorf("%s prompt = %q, want the migrated text", board, got)
		}
	}
	if cfg.SystemPrompt != "" {
		t.Errorf("the global prompt survived as %q", cfg.SystemPrompt)
	}

	// Saved back and reloaded, the migration finds nothing to do — so a board
	// that later empties its prompt does not have the old text handed to it
	// again on the next launch.
	if err := SaveConfig(path, cfg); err != nil {
		t.Fatal(err)
	}
	cfg.BoardPrompts = nil
	if err := SaveConfig(path, cfg); err != nil {
		t.Fatal(err)
	}
	again, err := LoadConfig(path, dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(again.BoardPrompts) != 0 {
		t.Errorf("emptied prompts came back as %v", again.BoardPrompts)
	}
}

func TestAgentMCPServersValidation(t *testing.T) {
	ok, err := validateAgent(AgentEntry{Name: "jojo", Kind: "junie", MCPServers: map[string]AgentMCPServer{
		"playwright": {Command: " npx ", Args: []string{" -y ", "@playwright/mcp@latest", "  "}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	// Stray whitespace would become an empty argv element and a puzzling exec error.
	srv := ok.MCPServers["playwright"]
	if srv.Command != "npx" || strings.Join(srv.Args, "|") != "-y|@playwright/mcp@latest" {
		t.Errorf("command not cleaned: %+v", srv)
	}

	bad := map[string]struct {
		why    string
		server AgentMCPServer
	}{
		"":            {"без имени", AgentMCPServer{Command: "npx"}},
		"playwright":  {"без команды", AgentMCPServer{}},
		"play wright": {"имя не годится в префикс инструмента", AgentMCPServer{Command: "npx"}},
		"dokku":       {"имя занято встроенным сервером", AgentMCPServer{Command: "npx"}},
		"remote":      {"удалённый сервер", AgentMCPServer{Type: "http", URL: "https://mcp.example.com"}},
	}
	for name, c := range bad {
		if _, err := validateAgent(AgentEntry{Name: "a", Kind: "claude", MCPServers: map[string]AgentMCPServer{name: c.server}}); err == nil {
			t.Errorf("принят сервер %s: %q %+v", c.why, name, c.server)
		}
	}
	// A remote server is a normal thing to paste, so the error has to name the
	// reason rather than complain about a missing command.
	_, err = validateAgent(AgentEntry{Name: "a", Kind: "claude", MCPServers: map[string]AgentMCPServer{
		"remote": {Type: "http", URL: "https://mcp.example.com"},
	}})
	if err == nil || !strings.Contains(err.Error(), "удалённый") {
		t.Errorf("unhelpful error for a remote server: %v", err)
	}
}

func TestAgentMCPServersTravelWithEverySession(t *testing.T) {
	agent := AgentEntry{Name: "jojo", Kind: "junie", MCPServers: map[string]AgentMCPServer{
		"playwright": {Command: "npx", Args: []string{"-y", "@playwright/mcp@latest", "--headless"}, Env: map[string]string{"X": "1"}},
	}}
	cfg := DefaultConfig(t.TempDir())

	// An ordinary card task gets the agent's own server even though the card
	// itself configures none.
	s := &Session{WorkdirPath: "/project", Agent: agent}
	specs, err := sessionMCPServers(s, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(specs) != 1 || specs[0].Name != "playwright" || specs[0].Command != "npx" {
		t.Fatalf("specs: %+v", specs)
	}
	if strings.Join(specs[0].Args, " ") != "-y @playwright/mcp@latest --headless" || specs[0].Env["X"] != "1" {
		t.Errorf("argv/env lost: %+v", specs[0])
	}
	// Wiring a server in is consent to use it: an unattended session has nobody
	// to ask, and the tool names only exist at run time.
	if !s.toolPrefixAllowed("mcp__playwright__browser_click") {
		t.Error("tools of a configured server should run unasked")
	}
	if s.toolPrefixAllowed("mcp__other__thing") {
		t.Error("only the configured server's tools may be allowed")
	}

	// A deploy session keeps ours first and appends the agent's.
	target := deployEntry("prod")
	deploySession := &Session{WorkdirPath: "/project", Agent: agent, Deploy: &target, DeployBranch: "feat/x"}
	specs, err = sessionMCPServers(deploySession, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(specs) != 2 || specs[0].Name != "dokku" || specs[1].Name != "playwright" {
		t.Fatalf("deploy session specs: %+v", specs)
	}
}

// The config file is edited by hand as often as by us, and the same MCP servers
// are written differently in the wild. All the shapes that plainly mean the same
// thing are read, because a config that cannot be parsed disables everything.
func TestMCPServersReadEveryShapeThatMeansTheSame(t *testing.T) {
	want := AgentMCPServer{Command: "npx", Args: []string{"-y", "@playwright/mcp@latest"}}

	cases := map[string]string{
		"object": `{"playwright": {"command": "npx", "args": ["-y", "@playwright/mcp@latest"]}}`,
		"list of named servers": `[{"name": "playwright", "command": "npx",
			"args": ["-y", "@playwright/mcp@latest"]}]`,
		"a whole client file": `{"mcpServers": {"playwright": {"command": "npx",
			"args": ["-y", "@playwright/mcp@latest"]}}}`,
	}
	for name, raw := range cases {
		var entry AgentEntry
		if err := json.Unmarshal([]byte(`{"name":"jojo","kind":"junie","mcpServers":`+raw+`}`), &entry); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		got, ok := entry.MCPServers["playwright"]
		if !ok || got.Command != want.Command || len(got.Args) != len(want.Args) {
			t.Fatalf("%s: %+v", name, entry.MCPServers)
		}
	}

	// Absent and null stay absent rather than becoming an empty server.
	var entry AgentEntry
	if err := json.Unmarshal([]byte(`{"name":"a","kind":"claude","mcpServers":null}`), &entry); err != nil || entry.MCPServers != nil {
		t.Fatalf("null: %+v, %v", entry.MCPServers, err)
	}

	// A list entry with no name has nothing to be called: say so, naming the field.
	err := json.Unmarshal([]byte(`{"name":"a","kind":"claude","mcpServers":[{"command":"npx"}]}`), &entry)
	if err == nil || !strings.Contains(err.Error(), "mcpServers") {
		t.Fatalf("a nameless server should be refused with a helpful message: %v", err)
	}

	// And they survive the round trip in the canonical shape.
	out, err := json.Marshal(entry2WithServers(want))
	if err != nil || !strings.Contains(string(out), `"mcpServers":{"playwright":`) {
		t.Fatalf("written shape: %s, %v", out, err)
	}
}

func entry2WithServers(s AgentMCPServer) AgentEntry {
	return AgentEntry{Name: "jojo", Kind: "junie", MCPServers: MCPServerSet{"playwright": s}}
}

// One server per name is all a config file and session/new can carry, so a
// column that names `playwright` gets its own rather than two servers under one
// name: the run's answer is the more specific one.
func TestAColumnsServerReplacesTheAgentsOfTheSameName(t *testing.T) {
	agent := AgentEntry{Name: "jojo", Kind: "junie", MCPServers: MCPServerSet{
		"playwright": {Command: "npx", Args: []string{"-y", "@playwright/mcp@latest"}},
	}}
	s := &Session{WorkdirPath: "/project", Agent: agent}
	s.extraMCP = stageMCPSpecs(MCPServerSet{"playwright": {Command: "/opt/pw", Args: []string{"--headed"}}})

	specs, err := sessionMCPServers(s, DefaultConfig(t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}
	if len(specs) != 1 {
		t.Fatalf("one server per name, got %+v", specs)
	}
	if specs[0].Command != "/opt/pw" {
		t.Errorf("the column's answer should win over the agent's: %+v", specs[0])
	}
}
