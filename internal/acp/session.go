package acp

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	acpsdk "github.com/coder/acp-go-sdk"

	"github.com/artipop/xciii/internal/dokku"
	"github.com/artipop/xciii/internal/procgroup"
)

// turnRequest is one user message queued onto a live session.
type turnRequest struct {
	text string
	done chan turnOutcome // buffered(1); receives the turn's outcome
}

// turnOutcome is what a turn produced: the agent's final message and the error
// that ended it, if any.
type turnOutcome struct {
	text string
	err  error
}

// Session is one agent conversation bound to a card. A session triggered by a
// card move runs a single turn and finishes, as it always has; a session a
// console is attached to stays alive between turns so the user can keep
// talking to the agent.
type Session struct {
	ID     string
	CardID string
	// Title is the card's own title, which is what the session's worktree
	// branch is named after — and therefore what a preview address reads like.
	Title       string
	BoardID     string
	ProjectPath string
	BaseBranch  string
	PromptText  string
	Agent       AgentEntry      // resolved agent (kind/bin/model/env/prompt)
	Net         NetworkSettings // resolved proxy configuration (Agent.ProxyName)

	// Deploy is set only for a session started by the deploy column: it is the
	// Dokku destination the session's MCP server is configured from, and its
	// presence is what turns those tools on.
	Deploy       *DeployEntry
	DeployBranch string
	// mcpConfigured records that we handed this session an MCP server of our
	// own, which is what makes the agent's "may I launch MCP?" prompt ours to
	// answer rather than the user's.
	mcpConfigured bool

	// Test is set only for a session started by the test column: the preview it
	// checks and where its evidence goes. Its presence turns the browser tools
	// on, the same way Deploy turns the dokku tools on.
	Test *TestRun

	// Artifacts is the session's own directory for evidence: screenshots and
	// the test verdict, the deploy outcome. Empty disables recording.
	Artifacts string

	// ColumnKey/ColumnName are the column the card was in when the session
	// started: what the column's limit is counted against, and what the queue
	// of waiting cards is keyed by.
	ColumnKey  string
	ColumnName string

	// FlowName/FlowNodeID are set when a flow stage started this session. Its
	// outcome is then the event that moves the card on.
	FlowName   string
	FlowNodeID string

	Worktree     WorktreeInfo
	usedWorktree bool // a dedicated worktree was actually created

	// Planning is a session with no card behind it: it exists only to talk
	// through a task before one is created. It reads the project but never
	// writes, so it neither takes the project lock nor reports to a card.
	Planning bool
	// Policy decides which tool calls run without asking. It is resolved once
	// at start — planning is held read-only, an agent may carry its own list,
	// otherwise the global one applies — so the rule cannot drift mid-session.
	Policy ToolPolicy
	// scratchDir is a throwaway working directory made for a session that has
	// no project, removed when the session ends.
	scratchDir string

	mu            sync.Mutex
	status        SessionStatus
	outcome       string             // flow trigger the session ended with, when it is known
	outcomeText   string             // what to write on the card when the flow moves on
	finalText     string             // the agent's closing words — what a comment condition on an edge reads
	turnCancel    context.CancelFunc // cancels the in-flight turn
	cancelSent    bool
	cancelPending bool // cancelled before a turn existed; the next one is stopped at once
	allowTools    map[string]bool
	// extraMCP are servers this particular run was handed — how a source's
	// agent reaches the service it reads and the tool it files through. Empty
	// for a card's session, which gets its servers from the agent and the
	// column.
	extraMCP      []mcpServerSpec
	allowPrefixes []string // tool prefixes of MCP servers the user wired in
	turnNo        int

	finalMu  sync.Mutex
	finalBuf strings.Builder

	seq atomic.Int64
}

func (s *Session) Status() SessionStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

// recordedBranch is the branch the session is filed under: the worktree it
// created, or — for a deploy session, which works in the project itself — the
// branch it publishes.
func (s *Session) recordedBranch() string {
	switch {
	case s.Worktree.Branch != "":
		return s.Worktree.Branch
	case s.Test != nil:
		return s.Test.Branch
	default:
		return s.DeployBranch
	}
}

// setOutcome records the flow trigger the session's own work produced — a test
// verdict, say — instead of the status the session ends in.
func (s *Session) setOutcome(trigger, detail string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.outcome, s.outcomeText = trigger, detail
}

// setFinalText keeps the agent's closing words for the route to read: an edge
// may be conditional on what the agent said («READY TO DEPLOY»).
func (s *Session) setFinalText(text string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.finalText = text
}

func (s *Session) agentFinalText() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.finalText
}

// flowOutcome is the event the session hands to its stage. A recorded outcome
// wins; otherwise it follows from the final status, and a cancelled session
// yields nothing at all — a human stepped in, so the route waits for them.
func (s *Session) flowOutcome() (trigger, detail string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.outcome != "" {
		return s.outcome, s.outcomeText
	}
	switch s.status {
	case StatusDone:
		return TriggerSuccess, "агент завершил работу"
	case StatusFailed:
		return TriggerFailure, "сессия агента упала"
	default:
		return "", ""
	}
}

// markMCPConfigured records that this session was started with an MCP server we
// configured ourselves.
func (s *Session) markMCPConfigured() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.mcpConfigured = true
}

func (s *Session) usesOurMCP() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.mcpConfigured
}

// allowToolPrefix allows every tool of a server the user wired to the agent.
// The names are not known ahead of time — they come from the server at run time
// — so the whole prefix is what can be consented to.
func (s *Session) allowToolPrefix(prefix string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.allowPrefixes = append(s.allowPrefixes, prefix)
}

func (s *Session) toolPrefixAllowed(name string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, p := range s.allowPrefixes {
		if strings.HasPrefix(name, p) {
			return true
		}
	}
	return false
}

// allowToolAlways remembers a tool the user approved for the rest of the session.
func (s *Session) allowToolAlways(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.allowTools == nil {
		s.allowTools = make(map[string]bool)
	}
	s.allowTools[name] = true
}

func (s *Session) toolAllowed(name string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.allowTools[name]
}

// autoAllowed reports whether the call runs without asking, under the policy
// resolved for this session. input is the tool's raw input, so entries that
// narrow a tool by argument — "Bash(git log*)" — can be checked.
func (s *Session) autoAllowed(name string, input any, cfg Config) bool {
	if s.Policy == nil {
		return cfg.ToolAllowed(name, input)
	}
	return s.Policy.Allows(name, input)
}

// appendEvent persists a session event with the next sequence number.
func (s *Session) appendEvent(m *Manager, kind string, payload any) {
	if err := m.store.AppendEvent(s.ID, s.seq.Add(1), kind, payload); err != nil {
		m.log.Warn("acp: failed to persist session event", "session", s.ID, "err", err)
	}
}

// runSession is the whole session lifecycle; it runs on its own goroutine.
func (m *Manager) runSession(s *Session) {
	defer m.wg.Done()
	// Deferred before releaseSession, so they run after it: the next stage of a
	// flow, and the next card waiting for this column, must not race the
	// finished session for the project or for its own place.
	defer m.drainColumn(s.ColumnKey)
	defer m.flowAfterSession(s)
	defer m.releaseSession(s)

	if m.rootCtx.Err() != nil {
		m.finishSession(s, StatusCancelled, "приложение завершается")
		return
	}

	// 1. Working directory: a dedicated worktree, or the project itself.
	if err := m.prepareWorkdir(s); err != nil {
		m.finishSession(s, StatusFailed, err.Error())
		m.comment(s, failComment(s, err.Error()))
		return
	}

	// 2. Agent connection.
	conn, acpSessionID, cleanup, err := m.openConnection(m.rootCtx, s)
	if err != nil {
		m.finishSession(s, StatusFailed, err.Error())
		m.comment(s, failComment(s, err.Error()))
		m.cleanupWorktree(s)
		return
	}
	defer cleanup()

	// 3. The card's task, which is the whole of the session.
	m.runCardTask(s, conn, acpSessionID)

	// 4. Worktree cleanup for unsuccessful sessions.
	m.cleanupWorktree(s)
}

// prepareWorkdir sets up the session's working directory.
//
// It used to announce it on the card as well — a comment saying the agent had
// started, in which worktree, on which branch. Nothing read it: a session that
// starts is the ordinary case, and where the work lives is on the card's own
// stamp the moment the worktree exists. The card is left for the two things
// only it can carry: what the agent did, and why it could not.
func (m *Manager) prepareWorkdir(s *Session) error {
	// Three kinds of session run in the project itself even under
	// worktreeMode "always": a planning session only reads, so a worktree would
	// cost a checkout and leave a branch behind for a conversation that changes
	// nothing; a deploy session publishes an existing branch rather than writing
	// code, so a throwaway branch is not the one anybody deploys; and a test
	// session only reads the code it is checking.
	if m.cfg.UseWorktrees() && !s.Planning && s.Deploy == nil && s.Test == nil && IsGitProject(m.rootCtx, s.ProjectPath) {
		wt, err := CreateWorktree(m.rootCtx, s.ProjectPath, s.BaseBranch, s.Title, s.CardID, s.ID, m.cfg.WorktreeDir)
		if err != nil {
			return fmt.Errorf("не удалось создать git worktree: %w", err)
		}
		s.Worktree = wt
		s.usedWorktree = true
		if err := m.store.UpdateSession(s.ID, StatusRunning, "", wt.Path, wt.Path, wt.Branch, "", nil); err != nil {
			m.log.Warn("acp: failed to persist worktree info", "session", s.ID, "err", err)
		}
		// The card shows the branch and offers to deploy it, and this is the
		// first moment it exists.
		m.emitSession(s, "")
		return nil
	}
	s.Worktree = WorktreeInfo{Path: s.ProjectPath, BaseRef: "HEAD"}
	if err := m.store.UpdateSession(s.ID, StatusRunning, "", s.ProjectPath, "", s.recordedBranch(), "", nil); err != nil {
		m.log.Warn("acp: failed to persist session cwd", "session", s.ID, "err", err)
	}
	return nil
}

func (m *Manager) cleanupWorktree(s *Session) {
	if s.scratchDir != "" {
		if err := os.RemoveAll(s.scratchDir); err != nil {
			m.log.Warn("acp: failed to remove planning scratch dir", "session", s.ID, "err", err)
		}
	}
	if !s.usedWorktree || s.Status() == StatusDone || m.cfg.KeepFailedWorktrees {
		return
	}
	if removed, err := RemoveWorktreeIfClean(context.Background(), s.ProjectPath, s.Worktree); err != nil {
		m.log.Warn("acp: worktree cleanup failed", "session", s.ID, "err", err)
	} else if removed {
		s.Worktree = WorktreeInfo{}
	}
}

// runCardTask runs the card's task, reports it and ends. There is no second
// turn: what a person types goes to the agent's own CLI in a terminal window,
// not through here, so a session is exactly the piece of work a card asked for.
func (m *Manager) runCardTask(s *Session, conn *acpsdk.ClientSideConnection, acpSessionID acpsdk.SessionId) {
	finalText, err := m.runTurn(s, conn, acpSessionID, s.PromptText)
	s.setFinalText(finalText)
	m.commentFirstTurn(s, finalText, err)

	if m.rootCtx.Err() != nil {
		m.finishSession(s, StatusCancelled, "приложение завершается")
	}
}

// commentFirstTurn records the outcome of the session on the card, along with
// the terminal status that goes with it.
func (m *Manager) commentFirstTurn(s *Session, finalText string, err error) {
	switch {
	case m.rootCtx.Err() != nil:
		// Shutdown: runSession reports it.
	case s.wasCancelled():
		// A cancelled turn ends with StopReason "cancelled", not an error.
		// Nothing is said on the card: somebody pressed the button a second
		// ago and the card's own status says «отменена».
		m.finishSession(s, StatusCancelled, "сессия отменена")
	case err != nil:
		m.finishSession(s, StatusFailed, err.Error())
		// A test session reports even when its turn broke off: the screenshots
		// and the verdict it managed to write are the point of the run.
		if s.Test != nil {
			m.reportTestRun(s, finalText, err)
			return
		}
		m.comment(s, failComment(s, err.Error()))
		m.applyDeployOutcome(s)
	default:
		m.finishSession(s, StatusDone, "")
		if s.Test != nil {
			m.reportTestRun(s, finalText, nil)
			return
		}
		m.comment(s, doneComment(s, finalText))
		m.applyDeployOutcome(s)
	}
}

// connectionLost reports whether the agent connection is gone, which makes
// every further turn pointless.
func connectionLost(conn *acpsdk.ClientSideConnection) bool {
	select {
	case <-conn.Done():
		return true
	default:
		return false
	}
}

// openConnection builds the ACP stack for a session and negotiates the agent
// session. The connection is held for the session's whole life, so every turn
// runs against the same agent process and keeps the conversation.
func (m *Manager) openConnection(ctx context.Context, s *Session) (*acpsdk.ClientSideConnection, acpsdk.SessionId, func(), error) {
	specs, err := sessionMCPServers(s, m.cfg)
	if err != nil {
		return nil, "", nil, err
	}
	launch, err := m.agentLaunch(s.Agent)
	if err != nil {
		return nil, "", nil, err
	}
	conn, cleanup, err := m.connectACPAgent(ctx, s, launch)
	if err != nil {
		return nil, "", nil, err
	}

	if _, err := conn.Initialize(ctx, acpsdk.InitializeRequest{
		ProtocolVersion:    acpsdk.ProtocolVersionNumber,
		ClientCapabilities: clientCapabilities(),
	}); err != nil {
		cleanup()
		return nil, "", nil, fmt.Errorf("initialize: %w", err)
	}

	sess, err := conn.NewSession(ctx, acpsdk.NewSessionRequest{
		Cwd:        s.Worktree.Path,
		McpServers: acpMCPServers(specs),
		// Extra arguments for the CLI behind the adapter, for what ACP has no
		// word for (Remote Control). An argument the CLI does not know fails
		// right here, with the CLI's own message.
		Meta: sessionMeta(s.Agent),
	})
	if err != nil {
		cleanup()
		return nil, "", nil, fmt.Errorf("session/new: %w", err)
	}
	m.selectSessionMode(ctx, s, conn, sess, launch.mode)
	m.selectSessionModel(ctx, s, conn, sess)
	// Last, so what the user chose on the agent outranks what the kind's table
	// would have set.
	m.applyAgentOptions(ctx, s, conn, sess)
	worktreePath := ""
	if s.usedWorktree {
		worktreePath = s.Worktree.Path
	}
	if err := m.store.UpdateSession(s.ID, StatusRunning, string(sess.SessionId), s.Worktree.Path, worktreePath, s.recordedBranch(), "", nil); err != nil {
		m.log.Warn("acp: failed to persist acp session id", "session", s.ID, "err", err)
	}
	return conn, sess.SessionId, cleanup, nil
}

// runTurn sends one prompt and returns the agent's final message text. It holds
// a concurrency slot only while the agent is actually working, so an idle
// console never starves other cards.
func (m *Manager) runTurn(s *Session, conn *acpsdk.ClientSideConnection, acpSessionID acpsdk.SessionId, prompt string) (string, error) {
	select {
	case m.sem <- struct{}{}:
		defer func() { <-m.sem }()
	case <-m.rootCtx.Done():
		return "", m.rootCtx.Err()
	}

	// A browser scenario is much slower than a code edit, so a test turn gets
	// its own budget.
	timeout := m.cfg.SessionTimeout()
	if s.Test != nil {
		timeout = m.cfg.TestTimeout()
	}
	ctx, cancel := context.WithTimeout(m.rootCtx, timeout)
	defer cancel()

	s.mu.Lock()
	s.turnCancel = cancel
	// A cancel that arrived before this turn existed still applies to it: the
	// card was dragged out of the column while the agent was starting up, and
	// there was no turn to stop yet. Starting the work anyway would leave a
	// session nobody asked for holding the project.
	pending := s.cancelPending
	s.cancelPending = false
	s.cancelSent = pending
	s.status = StatusRunning
	s.turnNo++
	s.mu.Unlock()
	m.persistStatus(s, StatusRunning, "")
	if pending {
		cancel()
	}

	// Each turn reports only its own output.
	s.finalMu.Lock()
	s.finalBuf.Reset()
	s.finalMu.Unlock()

	cancelACP := func() {
		s.mu.Lock()
		already := s.cancelSent
		s.cancelSent = true
		s.mu.Unlock()
		if !already {
			_ = conn.Cancel(context.Background(), acpsdk.CancelNotification{SessionId: acpSessionID})
		}
	}
	stop := context.AfterFunc(ctx, cancelACP)
	defer stop()

	resp, err := conn.Prompt(ctx, acpsdk.PromptRequest{
		SessionId: acpSessionID,
		Prompt:    []acpsdk.ContentBlock{acpsdk.TextBlock(prompt)},
	})
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded && !s.wasCancelled() {
			return "", fmt.Errorf("таймаут хода (%s)", m.cfg.SessionTimeout())
		}
		return "", fmt.Errorf("session/prompt: %w", err)
	}
	if resp.StopReason == acpsdk.StopReasonCancelled {
		s.markCancelled()
	}

	s.finalMu.Lock()
	final := s.finalBuf.String()
	s.finalMu.Unlock()
	return final, nil
}

// sdkLogger returns a session-scoped logger for SDK connections that drops
// the SDK's routine INFO chatter (e.g. the "connection closed" notice emitted
// on normal io.Pipe teardown after every session) but keeps warnings/errors.
func (m *Manager) sdkLogger(sessionID string) *slog.Logger {
	return slog.New(&minLevelHandler{next: m.log.Handler(), min: slog.LevelWarn}).With("session", sessionID)
}

// minLevelHandler forwards only records at or above min.
type minLevelHandler struct {
	next slog.Handler
	min  slog.Level
}

func (h *minLevelHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return level >= h.min && h.next.Enabled(ctx, level)
}

func (h *minLevelHandler) Handle(ctx context.Context, r slog.Record) error {
	return h.next.Handle(ctx, r)
}

func (h *minLevelHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &minLevelHandler{next: h.next.WithAttrs(attrs), min: h.min}
}

func (h *minLevelHandler) WithGroup(name string) slog.Handler {
	return &minLevelHandler{next: h.next.WithGroup(name), min: h.min}
}

// agentLaunch resolves how an agent is started: the argv to spawn and the
// environment the kind needs on top of the agent's own.
//
// Command overrides everything, because it is how a wrapper (a proxy launcher,
// a per-account shim) gets in front of the adapter; a known kind is otherwise
// its binary plus whatever selects ACP and the model. Args are appended in both
// cases, and the generic acp kind has nothing but its Command.
func (m *Manager) agentLaunch(a AgentEntry) (launch, error) {
	def, known := acpNative[a.Kind]
	var argv []string
	switch {
	case len(a.Command) > 0:
		argv = append(argv, a.Command...)
	case known:
		bin, err := m.adapterArgv(a.Kind, a.BinPath)
		if err != nil {
			return launch{}, err
		}
		argv = append(argv, bin...)
		argv = append(argv, def.acpArgs...)
		if a.Model != "" && def.modelArgs != nil {
			argv = append(argv, def.modelArgs(a.Model)...)
		}
	default:
		return launch{}, fmt.Errorf("у агента %q (тип %s) нет команды запуска", a.Name, a.Kind)
	}
	l := launch{argv: append(argv, a.Args...), dropEnv: def.dropEnv, mode: def.mode}
	// A model asked for through the environment is set whichever way the agent
	// was launched: a wrapper replaces the argv, not the model.
	if a.Model != "" && def.modelEnv != "" {
		l.env = []string{def.modelEnv + "=" + a.Model}
	}
	return l, nil
}

// launch is how one agent process is started, once the kind's table row and the
// registry entry have been folded together.
type launch struct {
	argv    []string
	env     []string // kind-specific, overridden by the agent's own env
	dropEnv []string
	mode    string // session mode to select once connected
}

// adapterArgv resolves the adapter binary for a kind. An installed binary wins;
// failing that, a vendor adapter published on npm is run through npx, so a
// machine with Node.js needs no install step at all. Nothing else is guessed:
// an agent that cannot be started says so here rather than at the first turn.
func (m *Manager) adapterArgv(kind, override string) ([]string, error) {
	def := acpNative[kind]
	bin, err := lookupBin(firstNonEmpty(override, def.bin), "")
	if err == nil {
		return []string{bin}, nil
	}
	// A binPath the user typed is an instruction, not a hint: fall back from it
	// and the agent would silently run something else.
	if override != "" {
		return nil, fmt.Errorf("binPath %s: %w", override, err)
	}
	if def.npmPackage == "" {
		return nil, fmt.Errorf("не найден %s — укажите binPath или command у агента", def.bin)
	}
	if npx, err := lookupBin("npx", ""); err == nil {
		return []string{npx, "--yes", def.npmPackage}, nil
	}
	return nil, fmt.Errorf("не найден %s: установите его командой `npm install -g %s` "+
		"(или поставьте Node.js, тогда адаптер запустится через npx)", def.bin, def.npmPackage)
}

// connectACPAgent spawns the agent over stdio and talks pure ACP to it. The
// wire is teed into the session trace, so the debug log records the actual
// protocol for every kind.
func (m *Manager) connectACPAgent(ctx context.Context, s *Session, l launch) (*acpsdk.ClientSideConnection, func(), error) {
	if len(l.argv) == 0 {
		return nil, nil, fmt.Errorf("пустая команда запуска агента")
	}
	env, drop := spawnEnv(s.Agent, s.Net)
	// The kind's own variables sit under the agent's, which is what lets an
	// entry override a model the table would have set.
	env = append(append([]string{}, l.env...), env...)
	drop = append(drop, l.dropEnv...)
	argv := resolveArgv0(l.argv)
	proc, err := procgroup.Spawn(m.rootCtx, argv, s.Worktree.Path, env, drop...)
	if err != nil {
		return nil, nil, fmt.Errorf("spawn agent %q: %w", argv[0], err)
	}
	conn := acpsdk.NewClientSideConnection(&sessionClient{m: m, s: s},
		m.traceWriter(s.ID, proc.Stdin), m.traceReader(s.ID, proc.Stdout))
	conn.SetLogger(m.sdkLogger(s.ID))
	cleanup := func() {
		proc.KillGroup(2 * time.Second)
		_ = proc.Wait()
	}
	return conn, cleanup, nil
}

// selectSessionMode switches the agent into the mode its kind asks for. It is
// advisory: an agent that offers no such mode is left in the one it chose, and
// a refusal is logged rather than failing the session, since the mode is a
// preference and the turn may well work without it.
func (m *Manager) selectSessionMode(ctx context.Context, s *Session, conn *acpsdk.ClientSideConnection, sess acpsdk.NewSessionResponse, mode string) {
	if mode == "" || sess.Modes == nil || string(sess.Modes.CurrentModeId) == mode {
		return
	}
	offered := false
	for _, available := range sess.Modes.AvailableModes {
		if string(available.Id) == mode {
			offered = true
			break
		}
	}
	if !offered {
		return
	}
	if _, err := conn.SetSessionMode(ctx, acpsdk.SetSessionModeRequest{
		SessionId: sess.SessionId,
		ModeId:    acpsdk.SessionModeId(mode),
	}); err != nil {
		m.log.Warn("acp: agent refused the session mode", "session", s.ID, "mode", mode, "err", err)
	}
}

// selectSessionModel asks for the agent's model over ACP, for the kinds that
// have no flag or variable for it. Codex is why this exists: its adapter stopped
// reading the model off the command line and offers it as a session config
// option instead, which is the protocol's own answer and needs no CLI knowledge.
//
// Advisory like the mode: an agent that does not offer the option, or offers it
// without the model somebody asked for, keeps the model it chose and says so in
// the log — the turn works either way, and failing the card over it would be
// worse than running it on the default.
func (m *Manager) selectSessionModel(ctx context.Context, s *Session, conn *acpsdk.ClientSideConnection, sess acpsdk.NewSessionResponse) {
	configID := acpNative[s.Agent.Kind].modelConfig
	if configID == "" || s.Agent.Model == "" {
		return
	}
	for _, opt := range sess.ConfigOptions {
		sel := opt.Select
		if sel == nil || string(sel.Id) != configID {
			continue
		}
		value, ok := matchConfigValue(sel.Options, s.Agent.Model)
		if !ok {
			m.log.Warn("acp: agent offers no such model", "session", s.ID,
				"model", s.Agent.Model, "available", configValueIDs(sel.Options))
			return
		}
		if string(sel.CurrentValue) == value {
			return
		}
		if _, err := conn.SetSessionConfigOption(ctx, acpsdk.SetSessionConfigOptionRequest{
			ValueId: &acpsdk.SetSessionConfigOptionValueId{
				SessionId: sess.SessionId,
				ConfigId:  sel.Id,
				Value:     acpsdk.SessionConfigValueId(value),
			},
		}); err != nil {
			m.log.Warn("acp: agent refused the model", "session", s.ID, "model", value, "err", err)
		}
		return
	}
}

// matchConfigValue finds the option value somebody meant: its id, or the name
// shown for it, either way ignoring case.
func matchConfigValue(options acpsdk.SessionConfigSelectOptions, want string) (string, bool) {
	for _, opt := range configSelectOptions(options) {
		if string(opt.Value) == want {
			return string(opt.Value), true
		}
	}
	for _, opt := range configSelectOptions(options) {
		if strings.EqualFold(string(opt.Value), want) || strings.EqualFold(opt.Name, want) {
			return string(opt.Value), true
		}
	}
	return "", false
}

// configSelectOptions flattens the two shapes a select takes, grouped and not.
func configSelectOptions(options acpsdk.SessionConfigSelectOptions) []acpsdk.SessionConfigSelectOption {
	if options.Ungrouped != nil {
		return *options.Ungrouped
	}
	var out []acpsdk.SessionConfigSelectOption
	if options.Grouped != nil {
		for _, group := range *options.Grouped {
			out = append(out, group.Options...)
		}
	}
	return out
}

func configValueIDs(options acpsdk.SessionConfigSelectOptions) string {
	values := make([]string, 0, 8)
	for _, opt := range configSelectOptions(options) {
		values = append(values, string(opt.Value))
	}
	return strings.Join(values, ", ")
}

func (s *Session) markCancelled() {
	s.mu.Lock()
	s.cancelSent = true
	s.mu.Unlock()
}

func (s *Session) wasCancelled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cancelSent
}

// ---- card comments ----
//
// A session leaves one, at its end, and there used to be a comment for every
// step it took: started, cancelled, asked, answered, terminal opened, moved
// along the route. A card whose comments are a log of the machinery is a card
// nobody reads, and the one thing worth reading — what the agent actually did —
// was buried in it. What is left is the summary the agent wrote, or the reason
// there is no summary.

func doneComment(s *Session, finalText string) string {
	var b strings.Builder
	if s.Deploy != nil {
		// "Finished" is not "succeeded" — whether the app is up is in the
		// agent's own text below, so the header stays neutral.
		b.WriteString("Сессия деплоя завершена.\n\n")
	} else {
		b.WriteString("Агент завершил работу.\n\n")
	}
	if t := strings.TrimSpace(finalText); t != "" {
		b.WriteString(truncateRunes(t, 4000))
		b.WriteString("\n\n")
	}
	if s.Deploy != nil {
		slug := dokku.AppSlug(s.DeployBranch)
		fmt.Fprintf(&b, "Ветка: `%s`\nПриложение Dokku: `%s`\nАдрес: %s\n",
			s.DeployBranch, s.Deploy.AppName(slug), s.Deploy.URL(slug))
		fmt.Fprintf(&b, "Если агент правил файлы, изменения не закоммичены: `git -C %s diff`", s.ProjectPath)
		return b.String()
	}
	if s.usedWorktree {
		fmt.Fprintf(&b, "Worktree: `%s`\nВетка: `%s`\n", s.Worktree.Path, s.Worktree.Branch)
		fmt.Fprintf(&b, "Посмотреть дифф: `git -C %s diff %s`", s.Worktree.Path, s.Worktree.BaseRef)
	} else {
		fmt.Fprintf(&b, "Изменения не закоммичены и лежат в рабочей копии `%s`.\n", s.ProjectPath)
		fmt.Fprintf(&b, "Посмотреть дифф: `git -C %s diff`", s.ProjectPath)
	}
	return b.String()
}

func failComment(s *Session, reason string) string {
	reason = s.Net.redactProxySecret(reason)
	var b strings.Builder
	fmt.Fprintf(&b, "Сессия агента завершилась с ошибкой: %s", truncateRunes(reason, 1500))
	// 407 arrives as a bare status code from the CLI, with no hint that the
	// proxy — not the model API — refused the request.
	if s.Net.Proxy != "" && strings.Contains(reason, "407") {
		b.WriteString("\n\nПрокси требует аутентификацию (407): задай логин и пароль в конфигурации прокси (меню доски → «Агенты…» → «Настройки прокси»).")
	}
	if s.usedWorktree && s.Worktree.Path != "" {
		fmt.Fprintf(&b, "\nWorktree (если остался): `%s`", s.Worktree.Path)
	}
	return b.String()
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}
