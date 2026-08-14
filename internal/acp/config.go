package acp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/artipop/xciii/internal/dokku"
)

// WorkdirEntry is one named local folder in the registry.
type WorkdirEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
	// BoardID is the board the folder was added on, and the only board that
	// offers it. A folder of household notes has no business being on the board
	// about code, and the registry is per machine, so without this every board
	// ends up offering every folder anybody ever added.
	//
	// Empty means no board has claimed it — an entry written before folders
	// belonged to a board. Such an entry is offered nowhere and worked in by
	// nothing; the folders dialog lists it apart and attaches it to the board
	// somebody is on (Attached), which is the only way back into use.
	BoardID string `json:"boardId,omitempty"`
	// Global says the folder belongs to all of them on purpose — the same
	// checkout worked from several boards.
	Global bool `json:"global,omitempty"`

	// Kind is what somebody said this folder is, not what it happens to be.
	// WorkdirGit means a repository was asked for — the board's setup step
	// demanded one — so a folder that turns out not to be under git is an
	// error rather than a quiet fall back to working in it as it stands.
	// Empty is the ordinary case and means nobody said: git is asked at the
	// moment it matters (IsGitWorkdir), which is what every entry written
	// before this field does, and what lets a folder become a repository
	// later without anybody re-adding it.
	Kind string `json:"kind,omitempty"`

	// Modes is how this folder is worked in when it is a repository, per board
	// that offers it: board id → WorkModeWorktree (a copy per card) or
	// WorkModeBranch (a branch in the folder itself). A board with no answer
	// falls back to the machine's own old default.
	//
	// Keyed by board because the answer is about this folder *on this board*.
	// A folder belongs to one board anyway, so for almost every entry the map
	// has one key and reads as "the folder's answer"; a folder marked «на всех
	// досках» is the case the key earns — the same checkout can be a copy per
	// card on the board where three people work it and a branch in place on the
	// board where one person does.
	Modes map[string]string `json:"modes,omitempty"`

	// BranchPrefix names the branches made here — "feature/", say. Empty is
	// the default, and the default is nothing at all.
	BranchPrefix string `json:"branchPrefix,omitempty"`

	// BaseBranch is what work here branches from, and what "merged" means for
	// it. It is a setting, and it is filled in when the folder is added by
	// asking git (DefaultBaseBranch) so that nobody types "main" for every
	// folder they own — after that it is whatever the person says, which is
	// the point: branching off `develop` is somebody's ordinary arrangement.
	// Empty on an entry added before this field, and asked of git then.
	BaseBranch string `json:"baseBranch,omitempty"`
}

// The kinds a folder can be declared as. A third value would be "plain", and
// there is none on purpose: not declaring is already that, and two ways to say
// the same thing is a rule about which of them wins.
const WorkdirGit = "git"

// DeclaredGit reports that this folder was added as a repository, and must
// still be one.
func (p WorkdirEntry) DeclaredGit() bool { return strings.EqualFold(p.Kind, WorkdirGit) }

// OfferedOn reports whether this board may see the folder. A board asking
// under no name at all (the planning dialog, which has no board) sees the whole
// registry, unattached entries included — it is choosing a folder to think in,
// not sending an agent anywhere.
func (p WorkdirEntry) OfferedOn(boardID string) bool {
	if boardID == "" {
		return true
	}
	return p.Global || (p.BoardID != "" && p.BoardID == boardID)
}

// Attached reports whether any board has claimed the folder.
func (p WorkdirEntry) Attached() bool { return p.Global || p.BoardID != "" }

// AgentEntry is one named coding agent in the registry. A card is mapped to an
// agent when its assignee matches the entry name. Its Env is injected per-process at spawn time, which
// is how several agents (e.g. two Codex accounts) coexist on one machine: give
// each its own CODEX_HOME/OPENAI_API_KEY (or CLAUDE_CONFIG_DIR/ANTHROPIC_API_KEY).
type AgentEntry struct {
	Name    string            `json:"name"`              // registry key; matches the card's assignee
	Kind    string            `json:"kind"`              // "claude" | "codex" | "antigravity" | "copilot" | "junie" | "acp"
	BinPath string            `json:"binPath,omitempty"` // overrides adapter discovery
	Model   string            `json:"model,omitempty"`   // the model the adapter is asked for
	Prompt  string            `json:"prompt,omitempty"`  // per-agent system prompt prepended to the task
	Env     map[string]string `json:"env,omitempty"`     // per-process env (CODEX_HOME, OPENAI_API_KEY, …)
	Args    []string          `json:"args,omitempty"`    // extra CLI args (sandbox/approval, etc.)

	// CLIArgs are extra arguments for the CLI behind the agent's adapter, for
	// the things ACP has no word for — Claude's Remote Control is a flag of the
	// CLI and nothing in the protocol, so no probe can find it. Handed over in
	// session/new's `_meta`, in the namespace the adapter documents. Only kinds
	// with such a channel accept them (see clihandoff.go); for an agent that is
	// its own CLI, Args is the field that reaches it.
	CLIArgs []string `json:"cliArgs,omitempty"`

	// Options are the agent's own settings — an ACP session config option id
	// mapped to the value the entry asks for ("fast": "on", "effort": "high").
	// They are not a list of ours: an agent declares what it has in its answer
	// to session/new, so the dialog offers exactly that and nothing else, and
	// an agent with no Fast mode has no Fast mode to switch. Applied after the
	// kind's own mode and model, so a setting chosen here wins. See
	// capabilities.go.
	Options map[string]string `json:"options,omitempty"`

	// AutoAllowTools overrides the global policy for this agent, so a trusted
	// one can be let loose and a new one kept on a short leash without changing
	// anything for the rest. Entries take the same form as autoAllowTools,
	// including argument patterns such as "Bash(git *)".
	AutoAllowTools []string `json:"autoAllowTools,omitempty"`

	// Command is the launch argv, and it is the whole agent command (required
	// for "acp"): what it replaces is the adapter binary we would have looked
	// up, so a wrapper gets in front of it — `proxychains4 -f myproxy.conf
	// codex-acp`, a per-account shim script. Takes precedence over BinPath, and
	// with it set nothing of ours is appended, so the flags the kind would have
	// carried (the ACP switch, the model) have to be spelled out.
	Command []string `json:"command,omitempty"`

	// TerminalCommand is the argv a *terminal* window runs for this agent —
	// the interactive CLI rather than the ACP adapter. It is normally left
	// empty: the kind's table knows that `claude` is the terminal half of
	// `claude-agent-acp`. Set it to wrap the CLI (`proxychains4 -q claude`), to
	// pass flags of its own, or to give the generic "acp" kind a terminal at
	// all, since nothing else can know what its CLI is called.
	TerminalCommand []string `json:"terminalCommand,omitempty"`

	// MCPServers are the agent's own MCP servers, spawned alongside the one a
	// deploy session configures itself. This is how a Node-based server such as
	// @playwright/mcp plugs in without the app depending on Node: the user wires
	// it per agent, we only pass it on.
	//
	// The shape is the one every MCP client uses — name → {command, args, env} —
	// so an entry can be pasted straight from a server's README, and so the
	// config file reads the same as the agent's own.
	MCPServers MCPServerSet `json:"mcpServers,omitempty"`

	// ProxyName selects a named entry from the proxy registry (Config.Proxies).
	// Network settings live there rather than on the agent, so several agents
	// share one configuration and it is edited in a single place. Empty means
	// the agent inherits the app's own environment.
	ProxyName string `json:"proxyName,omitempty"`
}

// AgentMCPServer is one MCP server an agent carries of its own, in the standard
// client shape: a command with its arguments and environment.
//
// Configuring one is consent to use it: its tools (mcp__<name>__…) run without
// asking, for the same reason our own server's do — a card-triggered session
// has no console, and asking nobody means rejecting.
//
// Type and URL exist only to recognise a remote server pasted from a README and
// say what is wrong: everything here is spawned over stdio.
type AgentMCPServer struct {
	Command string            `json:"command,omitempty"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`

	Type string `json:"type,omitempty"`
	URL  string `json:"url,omitempty"`
}

// UnmarshalJSON reads "command" as either the binary alone, with the rest in
// "args", or as the whole argv — which is how a good few clients write it, and
// what a person copying from one of them will produce. An argv is split into
// the two fields, since that is what the bridges pass on.
func (s *AgentMCPServer) UnmarshalJSON(data []byte) error {
	var raw struct {
		Command json.RawMessage   `json:"command,omitempty"`
		Args    []string          `json:"args,omitempty"`
		Env     map[string]string `json:"env,omitempty"`
		Type    string            `json:"type,omitempty"`
		URL     string            `json:"url,omitempty"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*s = AgentMCPServer{Args: raw.Args, Env: raw.Env, Type: raw.Type, URL: raw.URL}
	if len(bytes.TrimSpace(raw.Command)) == 0 {
		return nil
	}

	var command string
	if err := json.Unmarshal(raw.Command, &command); err == nil {
		s.Command = command
		return nil
	}
	var argv []string
	if err := json.Unmarshal(raw.Command, &argv); err != nil {
		return fmt.Errorf("\"command\" должен быть строкой или списком аргументов, а не %s", raw.Command)
	}
	if len(argv) == 0 {
		return nil
	}
	s.Command = argv[0]
	s.Args = append(append([]string(nil), argv[1:]...), s.Args...)
	return nil
}

// MCPServerSet is how an agent's servers are stored: name → server, the shape
// every MCP client uses. It reads more than it writes, because the file is
// edited by hand as often as by us and the same servers are written differently
// in the wild:
//
//	{"playwright": {"command": "npx", …}}                  the canonical shape
//	[{"name": "playwright", "command": "npx", …}]          a list of named ones
//	{"mcpServers": {"playwright": {…}}}                    the whole client file
//
// All three mean the same thing, so all three are accepted rather than
// disabling the integration over the punctuation. Anything else is reported
// with the name of the field, since a config that cannot be read stops
// everything.
type MCPServerSet map[string]AgentMCPServer

func (s *MCPServerSet) UnmarshalJSON(data []byte) error {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || string(trimmed) == "null" {
		*s = nil
		return nil
	}

	if trimmed[0] == '[' {
		var list []json.RawMessage
		if err := json.Unmarshal(trimmed, &list); err != nil {
			return fmt.Errorf("mcpServers: %w", err)
		}
		out := make(MCPServerSet, len(list))
		for i, item := range list {
			var named struct {
				Name string `json:"name"`
			}
			if err := json.Unmarshal(item, &named); err != nil {
				return fmt.Errorf("mcpServers[%d]: %w", i+1, err)
			}
			name := strings.TrimSpace(named.Name)
			if name == "" {
				return fmt.Errorf("mcpServers: у сервера №%d нет имени — добавьте \"name\" или запишите их объектом {\"имя\": {…}}", i+1)
			}
			var server AgentMCPServer
			if err := json.Unmarshal(item, &server); err != nil {
				return fmt.Errorf("mcpServers[%q]: %w", name, err)
			}
			out[name] = server
		}
		*s = out
		return nil
	}

	// Plain object — either the servers themselves, or a whole client config
	// with them nested under "mcpServers".
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(trimmed, &raw); err != nil {
		return fmt.Errorf("mcpServers: %w", err)
	}
	if nested, ok := raw["mcpServers"]; ok && len(raw) == 1 {
		return s.UnmarshalJSON(nested)
	}
	out := make(MCPServerSet, len(raw))
	for name, value := range raw {
		var server AgentMCPServer
		if err := json.Unmarshal(value, &server); err != nil {
			return fmt.Errorf("mcpServers[%q]: %w", name, err)
		}
		out[name] = server
	}
	*s = out
	return nil
}

// NetworkSettings is one network path: the proxy an agent's traffic takes and
// the trust material that goes with it. Expanded into the standard proxy
// environment variables at spawn time (see spawnEnv).
type NetworkSettings struct {
	Proxy   string `json:"proxy,omitempty"`   // http(s)/socks5 URL → HTTP(S)_PROXY, ALL_PROXY
	NoProxy string `json:"noProxy,omitempty"` // comma-separated hosts/suffixes → NO_PROXY
	CACert  string `json:"caCert,omitempty"`  // PEM bundle for a TLS-inspecting proxy

	// Username/Password are the proxy's basic-auth credentials, kept apart from
	// the URL so they are entered raw (percent-encoding is applied when the URL
	// is composed), masked in the UI and never rendered in a proxy list. They
	// still live in the config file, which is why SaveConfig keeps it 0600; to
	// keep the secret out of it entirely, point Proxy at a local relay that
	// holds the credentials itself (cntlm, px).
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
}

// ProxyURL returns the proxy address with credentials applied, percent-encoding
// whatever the password contains. Credentials given as fields win over any
// carried by the URL itself.
func (n NetworkSettings) ProxyURL() (string, error) {
	raw := strings.TrimSpace(n.Proxy)
	if raw == "" {
		return "", nil
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("не удалось разобрать адрес прокси %q: %w", raw, err)
	}
	if u.Scheme == "" || u.Host == "" {
		return "", fmt.Errorf("в адресе прокси %q не хватает схемы или хоста, например http://%s", raw, raw)
	}
	if user := strings.TrimSpace(n.Username); user != "" {
		if n.Password == "" {
			u.User = url.User(user)
		} else {
			u.User = url.UserPassword(user, n.Password)
		}
	}
	return u.String(), nil
}

// redactProxySecret replaces the proxy password wherever it appears in text
// (raw or percent-encoded), so a CLI error echoing the proxy URL cannot carry
// the credential into a card comment or the session log.
func (n NetworkSettings) redactProxySecret(text string) string {
	if n.Password == "" {
		return text
	}
	forms := []string{n.Password, url.QueryEscape(n.Password)}
	// The form that actually travels in the URL: userinfo escaping is its own
	// set (":" becomes %3A, unlike PathEscape), and Userinfo.String() is the
	// only way to get exactly what ProxyURL emitted. The username is escaped
	// the same way, so the first literal ":" is the separator.
	if enc := url.UserPassword("u", n.Password).String(); strings.Contains(enc, ":") {
		forms = append(forms, enc[strings.Index(enc, ":")+1:])
	}
	for _, secret := range forms {
		if secret != "" {
			text = strings.ReplaceAll(text, secret, "***")
		}
	}
	return text
}

// ProxyEntry is one named network configuration in the registry, referenced by
// agents through AgentEntry.ProxyName.
type ProxyEntry struct {
	Name string `json:"name"` // registry key; matches AgentEntry.ProxyName
	NetworkSettings
}

// DeployEntry is one named Dokku destination in the registry: where the branch
// of a card moved into the deploy column is published. A card is mapped to an
// entry by a select option carrying its name, by the folder it resolved to,
// or — with a single entry registered — by default.
//
// The Dokku half is dokku.Target verbatim, because that is exactly what the MCP
// subprocess is handed at session start.
type DeployEntry struct {
	Name string `json:"name"` // registry key; matches the card "Deploy target" option

	// An entry is the host and the domain, nothing else: what a preview needs
	// beyond that — environment, TLS, how long a build may take — is a property
	// of the folder being deployed, not of the machine it lands on.
	dokku.Target
}

// IsZero reports whether nothing is configured.
func (n NetworkSettings) IsZero() bool {
	return strings.TrimSpace(n.Proxy) == "" &&
		strings.TrimSpace(n.NoProxy) == "" &&
		strings.TrimSpace(n.CACert) == ""
}

// Validate normalizes and checks the settings. kind is the agent kind they will
// be used with, or "" to skip the kind-specific checks.
func (n NetworkSettings) Validate(kind string) (NetworkSettings, error) {
	n.Proxy = strings.TrimSpace(n.Proxy)
	n.NoProxy = strings.TrimSpace(n.NoProxy)
	n.CACert = strings.TrimSpace(n.CACert)
	n.Username = strings.TrimSpace(n.Username)
	if n.Proxy == "" && (n.Username != "" || n.Password != "") {
		return n, fmt.Errorf("логин/пароль заданы без адреса прокси")
	}
	if n.Proxy != "" {
		// The CLIs read the proxy variables as URLs; a bare host:port is
		// silently ignored, which looks like "the proxy setting does nothing".
		if _, err := n.ProxyURL(); err != nil {
			return n, err
		}
		// Claude Code documents no SOCKS support (code.claude.com/docs/en/network-config),
		// so a socks:// value would be accepted here and then quietly ignored.
		if kind == AgentKindClaude && strings.HasPrefix(strings.ToLower(n.Proxy), "socks") {
			return n, fmt.Errorf("Claude Code не поддерживает SOCKS-прокси: укажи http(s):// или заверни CLI в команду запуска (command)")
		}
	}
	return n, nil
}

// proxyEnvNames are the variables spawnEnv manages when Proxy is set. Both
// cases are covered: Node-based CLIs (claude, gemini) read the upper-case ones,
// most Rust/Go/curl-based ones accept either.
var proxyEnvNames = []string{
	"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
	"http_proxy", "https_proxy", "all_proxy",
}

// caCertEnvNames map a PEM bundle onto the per-runtime variables: Node
// (claude/gemini), Rust/Python (codex and friends), curl.
var caCertEnvNames = []string{
	"NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE",
}

// spawnEnv returns the "KEY=value" pairs injected into the agent process and
// the names dropped from the inherited environment first, so the agent's own
// values win over whatever the desktop app itself was launched with. net is the
// resolved network configuration; it is expanded first and the agent's Env map
// last, so Env can override or blank out any of it (an empty value means
// "present but empty", which is how an agent opts out of an inherited proxy).
func spawnEnv(a AgentEntry, net NetworkSettings) (env []string, drop []string) {
	add := func(k, v string) {
		env = append(env, k+"="+v)
		drop = append(drop, k)
	}
	// Validate has already rejected an unparseable address, so a late error
	// here would only mean a hand-edited config: fall back to the raw value.
	proxy, err := net.ProxyURL()
	if err != nil {
		proxy = strings.TrimSpace(net.Proxy)
	}
	if proxy != "" {
		for _, k := range proxyEnvNames {
			add(k, proxy)
		}
		// Managed as a pair: an inherited NO_PROXY must not leak into an agent
		// that goes through its own proxy.
		add("NO_PROXY", net.NoProxy)
		add("no_proxy", net.NoProxy)
	} else if n := strings.TrimSpace(net.NoProxy); n != "" {
		add("NO_PROXY", n)
		add("no_proxy", n)
	}
	if c := strings.TrimSpace(net.CACert); c != "" {
		for _, k := range caCertEnvNames {
			add(k, c)
		}
	}
	for k, v := range a.Env {
		add(k, v)
	}
	return env, drop
}

// Agent kinds. Every one of them is an ACP agent spawned over stdio and talked
// to in pure ACP — claude and codex through the adapters their vendors ship,
// the rest through CLIs that speak ACP themselves.
const (
	AgentKindClaude      = "claude"
	AgentKindCodex       = "codex"
	AgentKindAntigravity = "antigravity"
	AgentKindCopilot     = "copilot"
	AgentKindJunie       = "junie"
	AgentKindACP         = "acp"
)

// AgentKinds lists every accepted kind, in the order the UI offers them.
var AgentKinds = []string{
	AgentKindClaude, AgentKindCodex,
	AgentKindAntigravity, AgentKindCopilot, AgentKindJunie,
	AgentKindACP,
}

// acpAdapter is everything that differs between one ACP agent and another: the
// binary to look for, the package that provides it when it is missing, the
// flags that select ACP-over-stdio, how a model is asked for, what the process
// must not inherit, and the mode to switch it into once connected.
//
// Everything else — the connection, MCP servers, permissions, cancellation,
// turn budgets — is the same code for every kind, which is the point of the
// table: adding an agent is a row, not a branch.
type acpAdapter struct {
	// bin is the executable, looked up on PATH and in the usual install spots.
	bin string
	// npmPackage provides bin when it is not installed. The two vendor adapters
	// are published there and nowhere else, so it doubles as the install
	// instruction we show and the argument to npx when we fall back to it.
	npmPackage string
	// acpArgs put the CLI into ACP-over-stdio mode. Empty when it has no other
	// mode to be in.
	acpArgs []string
	// modelArgs, modelEnv and modelConfig are the three ways an agent is told
	// which model to use: a launch flag, a variable, or a session config option
	// asked for over ACP once the session exists.
	modelArgs   func(model string) []string
	modelEnv    string
	modelConfig string
	// cliBin is the *interactive* CLI of the same agent — what a terminal
	// session runs. For an ACP-native kind it is the same binary as bin, which
	// speaks ACP only when asked to; for claude and codex it is not, since bin
	// there is a vendor adapter that has no terminal UI at all.
	cliBin string
	// cliResumeArgs continue the conversation the last terminal left in this
	// directory, which is what makes a card's terminal resumable: the worktree
	// is per card, so "the last conversation here" is that card's. A kind with
	// no such flag simply starts fresh.
	cliResumeArgs []string
	// cliMCPArgs hand the interactive CLI a file of MCP servers. A session gets
	// its servers over the protocol (session/new has a field for them), but a
	// terminal is the vendor CLI itself and has to be told in its own spelling
	// — which is why this is a column of the same table that already knows
	// which binary the terminal runs. A kind that leaves it empty simply runs
	// without our tools; that is better than guessing a flag and failing to
	// open the terminal at all.
	cliMCPArgs func(configPath string) []string
	// cliPromptArgs give the CLI the first message of the conversation on its
	// own command line, which is how a stage of a route hands its card's task
	// to a terminal (stageterminal.go). Typing it in instead means writing to a
	// pty whose CLI is not listening yet — and the one it might be showing is
	// "do you trust the files in this folder?", which must not be answered with
	// a task. A kind that leaves this empty has the task pasted once its CLI
	// has settled, which is the same answer a resumed conversation gets.
	//
	// **It carries its own end-of-options marker**, because the task is a
	// positional argument and everything before it on that command line is
	// flags. `--mcp-config <configs...>` is variadic, so `claude --mcp-config
	// f.json "почини логин"` reads the card's task as a second config file and
	// dies with "MCP config file not found: почини логин" — the terminal opened
	// and shut in the same breath, and every card of that board stalled saying
	// the agent had not reported. Whatever this returns goes last, so the
	// separator belongs to the kind that knows how its own parser spells one.
	cliPromptArgs func(prompt string) []string
	// dropEnv names variables the process must not inherit from ours.
	dropEnv []string
	// mode is the session mode to select after session/new, when the agent's
	// default is not what a card wants.
	mode string
}

// dashDashModel is the spelling every ACP-native CLI uses.
func dashDashModel(model string) []string { return []string{"--model", model} }

// acpNative is the table of agents we know how to launch. The generic acp kind
// is deliberately absent — it carries its own Command.
var acpNative = map[string]acpAdapter{
	// The Claude adapter embeds the Claude Agent SDK, which embeds the CLI, so
	// the claude binary is not needed alongside it. It is a Node package and
	// there is no other build of it, which is why the desktop app needs Node.js
	// for this kind.
	AgentKindClaude: {
		bin:        "claude-agent-acp",
		npmPackage: "@agentclientprotocol/claude-agent-acp",
		// The adapter takes no flags at all: it is an ACP agent and nothing else.
		modelEnv: "ANTHROPIC_MODEL",
		// The adapter embeds the CLI but is not it: a terminal runs `claude`,
		// which has to be installed for that (and only that).
		cliBin:        "claude",
		cliResumeArgs: []string{"--continue"},
		cliMCPArgs:    func(path string) []string { return []string{"--mcp-config", path} },
		// `claude -- "…"` opens the TUI with that as the first message, which is
		// exactly what a stage needs: the CLI is interactive from the first
		// frame and the task is already in it. The `--` is not decoration —
		// commander's `--mcp-config` is variadic and eats the next argument.
		cliPromptArgs: func(prompt string) []string { return []string{"--", prompt} },
		// Claude Code refuses to start inside another Claude Code session, and
		// the desktop app may well have been launched from one: `wails3 dev` is
		// started from a terminal, and that terminal is sometimes a CLI's own.
		// The rest of the list is that same launch described from the other
		// side. CLAUDE_CODE_CHILD_SESSION is the one that matters most: it turns
		// transcript saving *off*, so a CLI that inherits it leaves no
		// conversation behind and the next `--continue` in that directory prints
		// "No conversation found to continue" and exits 1 — a terminal that
		// refuses to open, on a card whose conversation looked resumable.
		//
		// Only the markers of the outer session are dropped, never the whole
		// CLAUDE_CODE_* family: CLAUDE_CODE_USE_BEDROCK and its like are the
		// user's own configuration and have to be inherited.
		dropEnv: []string{
			"CLAUDECODE",
			"CLAUDE_CODE_CHILD_SESSION",
			"CLAUDE_CODE_SESSION_ID",
			"CLAUDE_CODE_ENTRYPOINT",
			"CLAUDE_CODE_EXECPATH",
			"CLAUDE_CODE_MESSAGING_SOCKET",
			"CLAUDE_CODE_MESSAGING_TOKEN",
		},
	},
	// The Codex adapter drives the codex CLI it depends on, so this kind needs
	// Node.js too.
	AgentKindCodex: {
		bin:        "codex-acp",
		npmPackage: "@agentclientprotocol/codex-acp",
		// It takes no flags either: the model is a session config option, asked
		// for over the protocol once the session exists.
		modelConfig: "model",
		cliBin:      "codex",
		// `codex resume --last` picks up the newest conversation of this
		// directory, the same rule as claude's --continue.
		cliResumeArgs: []string{"resume", "--last"},
		// `codex "…"` starts the TUI on that message. No separator: nothing can
		// precede the prompt here — this kind is handed no MCP config, and CLI
		// arguments are refused for it (validateCLIArgs) — and clap's own `--`
		// is not something to write down without a CLI to try it on.
		cliPromptArgs: func(prompt string) []string { return []string{prompt} },
		// It starts read-only, which is not what a card asked for: a session
		// that may not edit anything would spend its turn saying so.
		mode: "agent",
	},
	AgentKindAntigravity: {bin: "antigravity", acpArgs: []string{"--acp"}, modelArgs: dashDashModel},
	AgentKindCopilot:     {bin: "copilot", acpArgs: []string{"--acp"}, modelArgs: dashDashModel}, // github/copilot-cli, stdio is its default transport
	AgentKindJunie:       {bin: "junie", acpArgs: []string{"--acp=true"}, modelArgs: dashDashModel},
}

// agentModeCommand is the AgentMode that names no kind: the agent is whatever
// AgentCommand spells out.
const agentModeCommand = "acp-command"

// knownAdapter reports whether the kind is one we know how to launch ourselves.
func knownAdapter(kind string) bool {
	_, ok := acpNative[kind]
	return ok
}

// Config controls the agent integration. It is stored as JSON in the app data
// directory; the folder registry is edited through the desktop UI, the rest by
// hand for now.
type Config struct {
	Enabled bool `json:"enabled"`

	// AgentMode is the kind a card falls back to when the agent registry is
	// empty: one of the kinds above, or "acp-command" for the argv in
	// AgentCommand.
	AgentMode string `json:"agentMode"`
	// AgentCommand is the argv of an external ACP agent for agentMode "acp-command".
	AgentCommand []string `json:"agentCommand,omitempty"`

	TriggerProperty string `json:"triggerProperty"`
	TriggerColumn   string `json:"triggerColumn"`

	// DeployColumn is the second trigger on the same property: a card dragged
	// into it starts a session whose job is to publish the card's branch to the
	// Dokku target it resolves to. Empty disables the deploy trigger.
	DeployColumn string `json:"deployColumn"`

	// TestColumn is the third trigger on the same property: a card dragged into
	// it starts a session that opens the card's preview in a real browser and
	// checks it against the card's description. Empty disables the test trigger.
	TestColumn string `json:"testColumn"`

	// TestPassColumn and TestFailColumn are where the card goes once the verdict
	// is in. Empty means the card stays put and a human decides.
	TestPassColumn string `json:"testPassColumn"`
	TestFailColumn string `json:"testFailColumn"`

	// ProjectWhitelist lists directory roots a card's project_path must be
	// under. Empty means every project_path is rejected (explicit opt-in).
	ProjectWhitelist []string `json:"projectWhitelist"`

	// Workdirs is the registry of named local folders. A card is mapped to
	// a folder when one of its select/multiSelect option names (e.g. a tag)
	// matches a registry entry name. Registered paths are implicitly allowed.
	//
	// A folder is a git repository; the product stopped calling it one because
	// a board that runs agents is not only for software.
	Workdirs []WorkdirEntry `json:"projects"`

	// Agents is the registry of named coding agents (claude/codex, with their
	// own prompt, model and env). A card is mapped to an agent by its assignee,
	// each agent being a member of the board under its own name. When empty,
	// AgentMode below drives the (single) built-in agent for backward compat.
	Agents []AgentEntry `json:"agents"`

	// Proxies is the registry of named network configurations. Agents pick one
	// by name (AgentEntry.ProxyName), so a proxy is described once and shared.
	Proxies []ProxyEntry `json:"proxies"`

	// Deploys is the registry of named Dokku destinations used by the deploy
	// column. The matching target is handed to the session's dokku MCP server.
	Deploys []DeployEntry `json:"deploys"`

	// Columns is what happens in each column of a board: the action a card
	// entering it starts, who works it, how many at once. It is the single
	// answer to "what does this column do" — the TriggerColumn/DeployColumn/
	// TestColumn keys above are only the seed it is migrated from. See columns.go.
	Columns []ColumnSpec `json:"columns"`

	// Flows is the registry of named routes across the board: which column
	// follows which, and on what event. A card without a matching flow still
	// gets whatever its column does — a flow adds the transitions, not the
	// behaviour. See flows.go.
	Flows []FlowEntry `json:"flows"`

	// SystemPrompt was the instruction prepended to every triggered session's
	// prompt, for every board at once. It is kept only as the source the
	// migration below reads: a board is what a prompt is about, and one
	// setting shared by the household board and the code board was a setting
	// nobody could fill in. Nothing reads it after LoadConfig.
	//
	// Deprecated: use BoardPrompts.
	SystemPrompt string `json:"systemPrompt,omitempty"`

	// BoardPrompts is that instruction, per board: the text prepended to every
	// prompt a session of that board is given, before the agent's own system
	// prompt and the card task. Keyed by board id, empty for a board that
	// never set one.
	BoardPrompts map[string]string `json:"boardPrompts,omitempty"`

	// DeployPrompt is what a deploy session is told to do; the concrete facts
	// (folder, branch, target, expected URL) are appended to it.
	DeployPrompt string `json:"deployPrompt"`

	// TestPrompt is what a test session is told to do; the preview URL and the
	// card's own description (which is the scenario) are appended to it.
	TestPrompt string `json:"testPrompt"`

	// PlanningPrompt is what a planning terminal is opened with; the folder it
	// stands in is appended to it. Unlike the three above it is edited where it
	// is used — in the planning dialog, beside the folder and the agent.
	PlanningPrompt string `json:"planningPrompt"`

	// TestTimeoutMinutes replaces SessionTimeoutMinutes for a test turn, which
	// clicks through a whole scenario and needs longer than a code edit. How the
	// browser itself is launched — headless, which binary, what viewport — is
	// the business of the MCP server the agent carries, not of this config.
	TestTimeoutMinutes int `json:"testTimeoutMinutes"`

	// ArtifactsDir is where screenshots and result.json of test runs are kept.
	ArtifactsDir string `json:"artifactsDir"`

	// VCSPollSeconds is how often the folders cards wait on are polled for
	// branch and pull-request events. Zero disables folder watching.
	VCSPollSeconds int `json:"vcsPollSeconds"`
	// GitRemote is the remote consulted for those events.
	GitRemote string `json:"gitRemote"`
	// GithubToken authorizes the pull-request triggers. Empty falls back to
	// GITHUB_TOKEN in the environment; without either, only public folders
	// answer, and slowly (60 requests an hour).
	GithubToken string `json:"githubToken,omitempty"`

	// WorktreeMode controls where sessions run: "always" (default) — a
	// dedicated git worktree per session, which is what gives a card its own
	// branch to show and to deploy; "never" — directly in the folder
	// working tree, with concurrent sessions per folder rejected. A smarter
	// "auto" (escalate to a worktree when the folder is busy/dirty) may come later.
	WorktreeMode string `json:"worktreeMode"`

	// AgentNamedBranches asks the agent to invent each card's branch name in a
	// short headless session before the workspace is made (naming.go). Off by
	// default: it costs an agent run and a wait for something transliteration
	// does for free. Machine-wide, because it is about how this machine spends
	// agent runs, not about any board.
	AgentNamedBranches bool `json:"agentNamedBranches,omitempty"`

	MaxConcurrent int `json:"maxConcurrent"`
	// SessionTimeoutMinutes bounds a session, which is one agent turn: a card's
	// task, run and reported. SessionIdleMinutes, PermissionTimeoutMinutes and
	// PlanningTools belonged to the session console — a conversation held
	// between turns, prompts put to a person, a read-only policy for planning —
	// and are read only so that a config file written before it was removed
	// still parses.
	SessionTimeoutMinutes    int      `json:"sessionTimeoutMinutes"`
	SessionIdleMinutes       int      `json:"sessionIdleMinutes,omitempty"`
	PermissionTimeoutMinutes int      `json:"permissionTimeoutMinutes,omitempty"`
	IdempotencyWindowSeconds int      `json:"idempotencyWindowSeconds"`
	AutoAllowTools           []string `json:"autoAllowTools"`
	PlanningTools            []string `json:"planningTools,omitempty"`
	ShowThoughts             bool     `json:"showThoughts"`
	// DebugLog records every ACP message to DebugLogPath (default
	// <dataDir>/acp-debug.jsonl). Also switched on by XCIII_ACP_DEBUG.
	DebugLog            bool   `json:"debugLog,omitempty"`
	DebugLogPath        string `json:"debugLogPath,omitempty"`
	WorktreeDir         string `json:"worktreeDir"`
	KeepFailedWorktrees bool   `json:"keepFailedWorktrees"`
}

// The column a card is dropped into to hand it to an agent. Work starts where
// work normally starts on a board, rather than in a lane invented for agents.
// The names are the ones the boards this app ships use, and a person reads them
// on the board itself — hence Russian, like everything else they read. An
// install that already has a config keeps whatever it says: these are the
// defaults for a machine that has none.
const (
	// DefaultTriggerProperty is the select property the columns live on.
	DefaultTriggerProperty = "Статус"
	DefaultTriggerColumn   = "В работе"
	// legacyTriggerColumn is the column earlier versions triggered on; configs
	// still carrying it are migrated on load.
	legacyTriggerColumn = "To Agent"
)

// DefaultConfig returns the defaults written on first run. dataDir is the ACP
// data directory (worktrees live under it).
func DefaultConfig(dataDir string) Config {
	return Config{
		Enabled:                  true,
		AgentMode:                "claude",
		TriggerProperty:          DefaultTriggerProperty,
		TriggerColumn:            DefaultTriggerColumn,
		DeployColumn:             "Деплой",
		TestColumn:               "QA",
		TestPassColumn:           "Проверено",
		TestFailColumn:           "Не прошло",
		ProjectWhitelist:         []string{},
		Workdirs:                 []WorkdirEntry{},
		Agents:                   []AgentEntry{},
		Proxies:                  []ProxyEntry{},
		Deploys:                  []DeployEntry{},
		Columns:                  []ColumnSpec{},
		Flows:                    []FlowEntry{},
		DeployPrompt:             DefaultDeployPrompt,
		TestPrompt:               DefaultTestPrompt,
		PlanningPrompt:           DefaultPlanningPrompt,
		WorktreeMode:             "always",
		MaxConcurrent:            3,
		SessionTimeoutMinutes:    15,
		TestTimeoutMinutes:       30,
		SessionIdleMinutes:       30,
		ShowThoughts:             true,
		PermissionTimeoutMinutes: 5,
		IdempotencyWindowSeconds: 10,
		// This list is what an agent is *not* asked about, and everything on it
		// is here because being asked would be noise: reading and editing code,
		// and the shell a coding agent cannot work without (tests, git, build)
		// — withholding it while Edit and Write are allowed buys nothing but
		// interruptions. The dokku tools are the same judgement for a deploy.
		// destroy_deployment is deliberately absent: deleting an environment is
		// always worth a human answer, and since a session now waits for one
		// (question.go) that answer is a person's rather than a rejection.
		AutoAllowTools: []string{
			"Read", "Grep", "Glob", "Edit", "Write", "MultiEdit", "NotebookEdit", "TodoWrite", "Bash", "Skill",
			"mcp__dokku__deploy_branch", "mcp__dokku__app_logs",
			"mcp__dokku__deployment_status", "mcp__dokku__list_deployments",
		},
		VCSPollSeconds: 60,
		GitRemote:      "origin",
		WorktreeDir:    filepath.Join(dataDir, "worktrees"),
		ArtifactsDir:   filepath.Join(dataDir, "artifacts"),
	}
}

// DefaultPlanningPrompt is what a planning terminal is opened with. It is a
// conversation about a task that does not exist yet, so the one rule is that
// nothing is to be changed — and unlike a session, where the tool policy holds
// the agent to that, a terminal is the CLI's own with the person's own
// permissions. Here the instruction is all there is, which is also why it is
// editable: whoever plans is the one who knows what "don't touch" means for
// their folder.
//
// It says nothing about creating cards on purpose. The board tools describe
// themselves — an MCP server's instructions arrive with its tool list — so an
// agent that has them is already told what they are for, and one that has not
// is not told to reach for something it does not have. Naming them here would
// be the same sentence written twice, in the one place a person edits by hand.
const DefaultPlanningPrompt = `Мы планируем новую задачу.

Код в этой папке у тебя есть — читай файлы, ищи по ним, смотри историю git: опирайся
на код, а не на догадки.

Ничего не меняй в папке: ни файлов, ни состояния, ни веток. Это обсуждение,
а не выполнение.

Начни с короткого вопроса о том, что нужно сделать.`

// DefaultDeployPrompt is the task text a deploy session starts with.
const DefaultDeployPrompt = `Задача: опубликовать ветку этой карточки на Dokku.

Делай это только инструментами mcp__dokku__*: deploy_branch публикует ветку,
app_logs показывает логи сборки и приложения, deployment_status — состояние
процессов. Не запускай ssh и git push руками и не переключай ветки.

Если сборка упала: прочитай логи, назови причину и почини её, только если
исправление очевидно и относится к деплою (Procfile, переменные окружения,
конфиг сборки). Не переписывай логику приложения — вместо этого опиши проблему.

В конце ответа дай URL превью.`

// DefaultTestPrompt is the task text a test session starts with. It is written
// for a tester, not a developer: the job is to find what is broken on the
// preview, not to fix it.
const DefaultTestPrompt = `Задача: проверить в браузере превью этой карточки — вместо ручного тестировщика.

Сценарий бери из описания карточки: что должно было измениться, то и проверяй,
плюс убедись, что рядом ничего не развалилось. Браузер води инструментами
браузерного MCP-сервера, который у тебя есть (mcp__…__browser_navigate,
browser_snapshot, browser_click, browser_type и прочие): snapshot показывает
страницу текстом со ссылками на элементы, действия делаются по этим ссылкам.
После действия, меняющего страницу, бери новый snapshot — ссылки протухают.

Открывай только адрес превью, указанный ниже, и страницы под ним — на другие
хосты не ходи. Посмотри консоль и сетевые запросы: ошибки JS и упавшие запросы
— это дефекты, даже если внешне всё нарисовалось. Делай скриншоты на ключевых
шагах и на каждом найденном дефекте, сохраняя их в каталог screenshots рядом
с отчётом: они попадут в карточку.

Ничего не чини и не меняй код — ты тестируешь. В самом конце запиши отчёт
в файл result.json (путь указан ниже) — без него результат прогона не
засчитывается:

{"verdict": "pass|fail|blocked", "summary": "итог в одну-две фразы",
 "steps": ["что проделал, по шагам"], "bugs": ["что ожидалось и что произошло"]}

pass — сценарий прошёл, fail — есть дефекты (перечисли их в bugs),
blocked — проверить не удалось (превью не открывается, нет доступа).`

// TestTimeout bounds one test turn. A browser scenario takes much longer than a
// code edit, so it has its own budget instead of SessionTimeoutMinutes.
func (c Config) TestTimeout() time.Duration {
	if c.TestTimeoutMinutes <= 0 {
		return c.SessionTimeout()
	}
	return time.Duration(c.TestTimeoutMinutes) * time.Minute
}

// LoadConfig reads path, creating it with defaults when absent.
func LoadConfig(path, dataDir string) (Config, error) {
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		// A new install seeds no routes: the board brings its own (the "My
		// Folder Tasks" template ships them), and the editor offers the same
		// ones to a board that does not. Columns are still derived from the
		// trigger-column keys, so a hand-made board behaves as it always did.
		cfg := withColumns(DefaultConfig(dataDir))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return cfg, err
		}
		out, _ := json.MarshalIndent(cfg, "", "  ")
		if err := os.WriteFile(path, append(out, '\n'), 0o600); err != nil {
			return cfg, err
		}
		return cfg, nil
	}
	if err != nil {
		return Config{}, err
	}
	cfg := DefaultConfig(dataDir)
	if err := json.Unmarshal(b, &cfg); err != nil {
		return Config{}, fmt.Errorf("parse %s: %w", path, err)
	}
	// An existing config keeps whatever it says, so the old default would live
	// on forever in installs that never touched it. Only the abandoned default
	// is rewritten; a column the user chose is left alone. It happens before the
	// routes are seeded, so their stages name the column cards land in now.
	if strings.EqualFold(strings.TrimSpace(cfg.TriggerColumn), legacyTriggerColumn) {
		cfg.TriggerColumn = DefaultTriggerColumn
	}
	// Seed the routes and the columns only when the file has no such key at
	// all. An empty list is a decision — the user deleted every route, or
	// cleared every column — and must survive restarts, which an emptiness
	// check could not tell from a config written before either existed.
	var probe struct {
		Flows   *[]FlowEntry  `json:"flows"`
		Columns *[]ColumnSpec `json:"columns"`
	}
	if err := json.Unmarshal(b, &probe); err != nil {
		probe.Flows, probe.Columns = nil, nil
	}
	if probe.Columns == nil {
		cfg = withColumns(cfg)
	}
	if probe.Flows == nil && len(cfg.Columns) > 0 {
		// An install that predates flows keeps the routes it would have been
		// given then; a fresh one gets them from its board instead.
		cfg = withTemplateFlows(cfg)
	}
	cfg = withBoardPrompts(cfg)
	return cfg, nil
}

// withBoardPrompts moves the one prompt every board used to share onto the
// boards that actually run something. It runs once: the global field is blanked
// afterwards, so the next load finds nothing to move.
//
// Every board named by a column or a route gets the text, because those are the
// boards the prompt was reaching — a board with neither never ran a session and
// so never saw it. Boards the user has since deleted leave a key behind, which
// costs a line of JSON and is cheaper than reaching into the store from here.
func withBoardPrompts(cfg Config) Config {
	text := strings.TrimSpace(cfg.SystemPrompt)
	if text == "" || len(cfg.BoardPrompts) > 0 {
		cfg.SystemPrompt = ""
		return cfg
	}
	prompts := map[string]string{}
	for _, c := range cfg.Columns {
		if c.BoardID != "" {
			prompts[c.BoardID] = cfg.SystemPrompt
		}
	}
	for _, f := range cfg.Flows {
		if f.BoardID != "" {
			prompts[f.BoardID] = cfg.SystemPrompt
		}
	}
	if len(prompts) > 0 {
		cfg.BoardPrompts = prompts
	}
	cfg.SystemPrompt = ""
	return cfg
}

// withColumns fills the column registry from the trigger-column keys the config
// already carries, so an install that predates it keeps behaving exactly as it
// did: the trigger column runs an agent, the deploy column deploys, the test
// column tests. The keys stay in the file as the seed; from here on the
// registry is what the trigger loop reads.
func withColumns(cfg Config) Config {
	if len(cfg.Columns) == 0 {
		cfg.Columns = migratedColumns(cfg)
	}
	return cfg
}

// withTemplateFlows seeds the registry with the template routes, built from the
// trigger columns the config already names. It runs after unmarshalling so the
// routes reflect the user's own column names rather than the defaults.
func withTemplateFlows(cfg Config) Config {
	if flows := TemplateFlows(cfg); len(flows) > 0 {
		cfg.Flows = flows
	}
	return cfg
}

// GithubTokenValue is the token to authorize pull-request polling with: the
// configured one, else whatever the environment already holds.
func (c Config) GithubTokenValue() string {
	if t := strings.TrimSpace(c.GithubToken); t != "" {
		return t
	}
	return strings.TrimSpace(os.Getenv("GITHUB_TOKEN"))
}

// VCSPoll is how often folders are polled; zero turns watching off.
func (c Config) VCSPoll() time.Duration {
	if c.VCSPollSeconds <= 0 {
		return 0
	}
	return time.Duration(c.VCSPollSeconds) * time.Second
}

// SessionTimeout bounds a session, which is one agent turn.
func (c Config) SessionTimeout() time.Duration {
	return time.Duration(c.SessionTimeoutMinutes) * time.Minute
}

func (c Config) IdempotencyWindow() time.Duration {
	return time.Duration(c.IdempotencyWindowSeconds) * time.Second
}

// UseWorktrees reports whether sessions get a dedicated git worktree.
func (c Config) UseWorktrees() bool {
	return c.WorktreeMode == "always"
}

// ToolAllowed reports whether the call runs without asking, under the global
// policy. input is the tool's raw input, which entries carrying an argument
// pattern are matched against; pass nil when it is not available.
func (c Config) ToolAllowed(toolName string, input any) bool {
	return ToolPolicy(c.AutoAllowTools).Allows(toolName, input)
}

// SaveConfig writes cfg to path (used when the UI edits the folder registry).
func SaveConfig(path string, cfg Config) error {
	out, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, append(out, '\n'), 0o600); err != nil {
		return err
	}
	// WriteFile's mode only applies when it creates the file, so an existing
	// config keeps whatever it had — tighten it, the file can hold proxy
	// credentials and API keys (agent env).
	return os.Chmod(path, 0o600)
}

// ValidateWorkdirPath checks a card's repo_path against the whitelist, the folder
// registry and the filesystem. It returns the cleaned absolute path.
func (c Config) ValidateWorkdirPath(workdirPath string) (string, error) {
	if strings.TrimSpace(workdirPath) == "" {
		return "", fmt.Errorf("repo_path is empty")
	}
	if !filepath.IsAbs(workdirPath) {
		return "", fmt.Errorf("repo_path must be absolute: %s", workdirPath)
	}
	clean := filepath.Clean(workdirPath)
	info, err := os.Stat(clean)
	if err != nil {
		return "", fmt.Errorf("repo_path does not exist: %s", clean)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("repo_path is not a directory: %s", clean)
	}
	roots := append([]string(nil), c.ProjectWhitelist...)
	for _, r := range c.Workdirs {
		roots = append(roots, r.Path)
	}
	for _, root := range roots {
		rootClean := filepath.Clean(root)
		if clean == rootClean || strings.HasPrefix(clean, rootClean+string(filepath.Separator)) {
			return clean, nil
		}
	}
	return "", fmt.Errorf("repo_path %s is not under any whitelisted root (repoWhitelist / projects in acp config)", clean)
}
