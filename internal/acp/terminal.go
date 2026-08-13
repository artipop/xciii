package acp

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/aymanbagabas/go-pty"
	"github.com/google/uuid"
)

// A terminal session is the agent's own CLI, running in a pseudo-terminal in
// the card's working directory — the same thing a developer would open a shell
// and type, with the folder, the worktree, the branch and the agent's
// environment already set up.
//
// It is deliberately *not* an ACP session: an ACP agent speaks JSON-RPC on
// stdio and has no terminal UI, so a session cannot be both. What the two share
// is everything around them — which folder a card is about, which agent
// works it, which proxy and API keys that agent runs with, and where the branch
// goes — and that is what this reuses. Where an ACP session reports every step
// as it goes, a terminal session reports once, when it ends: what the CLI left
// on the branch (terminalReport).
//
// The window is where the human sits, so nothing here decides anything for
// them: no tool policy, no flow outcome, no card movement. The card is told
// what happened and stays where it is.

// terminalScrollback is how much output a session keeps for a window that
// opens late or reopens. Enough for a screen of a TUI and its history, small
// enough that an agent printing a build log cannot grow it without bound.
const terminalScrollback = 256 * 1024

// resumeRefusedWindow is how soon after a launch an exit still counts as the CLI
// refusing to continue a conversation rather than as work that ended
// (restartFresh). Generous on purpose: an unattended refusal takes under a
// second, but a folder the CLI has not been trusted in yet asks about that
// first, and somebody who answers that question should still get their terminal.
const resumeRefusedWindow = 30 * time.Second

// TerminalSession is one CLI in one pty.
type TerminalSession struct {
	ID     string
	CardID string
	// NodeID is the stage of the card's route this conversation belongs to;
	// empty for a card outside any route, and for planning terminals.
	NodeID  string
	BoardID string
	// Title is what this conversation is called. It starts as the card's title
	// (or «Планирование»), and both a person and the agent may change it: read
	// it through Info, never off the field, since either can happen while a
	// window is open.
	Title       string
	Task        string
	WorkdirPath string
	Cwd         string
	Branch      string
	AgentName   string
	AgentKind   string
	Argv        []string
	StartedAt   time.Time

	m            *Manager
	tty          pty.Pty
	cmd          *pty.Cmd
	worktree     WorktreeInfo
	usedWorktree bool
	startSHA     string
	// freshArgv is the same CLI without the flags that continue a conversation,
	// and env is what it runs with: between them, everything restartFresh needs
	// to open the terminal a refused resume did not. Empty when this launch did
	// not resume, which is the only case that restart exists for.
	freshArgv []string
	env       []string
	// launchedAt is when the process now in the pty started, which is not
	// StartedAt once a restart has happened.
	launchedAt time.Time
	restarted  bool
	ttyClosed  bool
	// The size the window last asked for, so a restarted CLI is not drawn at the
	// 80×24 a brand new pty comes with.
	cols, rows int
	// The board tools this CLI was given: a grant token and the config file
	// that carries it. Both die with the terminal — a door nobody is standing
	// in must not stay open.
	boardToken string
	mcpConfig  string

	// summary is the one line the agent wrote about this conversation, through
	// the board tools (DescribeTerminalFromTools). Under the lock because it
	// arrives from an HTTP handler while windows read it.
	summary string

	// stage marks a conversation a route opened rather than a person.
	stage bool
	// lastOutput is when the CLI last drew anything. It is how a stage tells a
	// CLI that is working from one that has stopped to ask something: an agent
	// mid-turn redraws its own spinner, and a TUI waiting on an answer draws
	// nothing at all (stageterminal.go).
	lastOutput time.Time

	mu       sync.Mutex
	buf      []byte
	subs     map[int]chan []byte
	nextSub  int
	closed   bool
	done     chan struct{}
	exitCode int
	exitErr  error
}

// TerminalInfo is what the UI is told about a terminal session.
type TerminalInfo struct {
	ID        string `json:"id"`
	CardID    string `json:"cardId,omitempty"`
	NodeID    string `json:"nodeId,omitempty"`
	Title     string `json:"title,omitempty"`
	Task      string `json:"task,omitempty"`
	Cwd       string `json:"cwd"`
	Branch    string `json:"branch,omitempty"`
	Agent     string `json:"agent"`
	Kind      string `json:"kind"`
	Command   string `json:"command"`
	Running   bool   `json:"running"`
	ExitCode  int    `json:"exitCode"`
	StartedAt string `json:"startedAt"`
	// Summary is the agent's own line about what this conversation is doing,
	// which is what makes a list of open terminals readable: a title says which
	// card, and this says what is going on in it.
	Summary string `json:"summary,omitempty"`
	// BoardFolder says Cwd is the board's own drafts folder — its directory
	// under the app's data — so the UI can name it instead of showing the path.
	BoardFolder bool `json:"boardFolder,omitempty"`
}

// Info describes the session for the window that draws it.
func (t *TerminalSession) Info() TerminalInfo {
	t.mu.Lock()
	defer t.mu.Unlock()
	info := TerminalInfo{
		ID:        t.ID,
		CardID:    t.CardID,
		NodeID:    t.NodeID,
		Title:     t.Title,
		Task:      t.Task,
		Cwd:       t.Cwd,
		Branch:    t.Branch,
		Agent:     t.AgentName,
		Kind:      t.AgentKind,
		Command:   strings.Join(t.Argv, " "),
		StartedAt: t.StartedAt.Format(time.RFC3339),
		ExitCode:  t.exitCode,
		Summary:   t.summary,
		// The UI names the board's drafts folder rather than showing a path into
		// the app's own data directory.
		BoardFolder: t.m != nil && t.Cwd != "" && t.Cwd == t.m.boardFolder(t.BoardID),
	}
	select {
	case <-t.done:
	default:
		info.Running = true
	}
	return info
}

// Subscribe returns the output so far and a channel of everything after it, so
// a window that opens late — or reopens — sees the screen it missed. The
// returned function unsubscribes and must be called.
func (t *TerminalSession) Subscribe() ([]byte, <-chan []byte, func()) {
	t.mu.Lock()
	defer t.mu.Unlock()
	history := append([]byte(nil), t.buf...)
	// Buffered: a slow window must never block the pty reader, which would
	// stall the CLI itself. An overrun drops output for that window alone.
	ch := make(chan []byte, 256)
	id := t.nextSub
	t.nextSub++
	if t.subs == nil {
		t.subs = map[int]chan []byte{}
	}
	t.subs[id] = ch
	return history, ch, func() {
		t.mu.Lock()
		defer t.mu.Unlock()
		if sub, ok := t.subs[id]; ok {
			delete(t.subs, id)
			close(sub)
		}
	}
}

// Write sends keystrokes to the CLI.
func (t *TerminalSession) Write(p []byte) error {
	if len(p) == 0 {
		return nil
	}
	select {
	case <-t.done:
		return fmt.Errorf("терминал уже завершён")
	default:
	}
	_, tty := t.running()
	_, err := tty.Write(p)
	return err
}

// Resize tells the CLI how big the window is, which is what makes a TUI draw
// itself correctly rather than wrapping at 80 columns. The size is remembered as
// well as applied, because a restarted CLI gets a new pty (restartFresh) and the
// window has no reason to ask again.
func (t *TerminalSession) Resize(cols, rows int) error {
	if cols <= 0 || rows <= 0 {
		return nil
	}
	t.mu.Lock()
	t.cols, t.rows = cols, rows
	tty := t.tty
	t.mu.Unlock()
	return tty.Resize(cols, rows)
}

// running is the process and the pty of the launch in flight. Both are replaced
// when a refused resume is restarted, so nothing may hold either across that.
func (t *TerminalSession) running() (*pty.Cmd, pty.Pty) {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.cmd, t.tty
}

// closeTTY closes the pty, once. Both the app closing a terminal and the pump
// reaching the end of one get here — the close is what unblocks the reader when
// killing the CLI does not, because a child of it still holds the slave open —
// and go-pty's own Close is not safe to call twice at once.
func (t *TerminalSession) closeTTY() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.tty == nil || t.ttyClosed {
		return
	}
	t.ttyClosed = true
	_ = t.tty.Close()
}

// Done is closed when the CLI exits.
func (t *TerminalSession) Done() <-chan struct{} { return t.done }

// quietFor reports how long the CLI has drawn nothing. Zero output at all
// counts from the launch, so a CLI that never started is not read as busy.
func (t *TerminalSession) quietFor(now time.Time) time.Duration {
	t.mu.Lock()
	defer t.mu.Unlock()
	since := t.lastOutput
	if since.IsZero() {
		since = t.launchedAt
	}
	return now.Sub(since)
}

// publish fans one chunk of output out to every window and keeps a copy.
func (t *TerminalSession) publish(chunk []byte) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.lastOutput = time.Now()
	t.buf = append(t.buf, chunk...)
	if len(t.buf) > terminalScrollback {
		t.buf = append([]byte(nil), t.buf[len(t.buf)-terminalScrollback:]...)
	}
	for id, sub := range t.subs {
		select {
		case sub <- append([]byte(nil), chunk...):
		default:
			// This window stopped reading. Dropping its subscription is kinder
			// than dropping bytes silently for ever: it reconnects and gets the
			// scrollback.
			delete(t.subs, id)
			close(sub)
		}
	}
}

// finish closes every subscription once the CLI is gone.
func (t *TerminalSession) finish() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return
	}
	t.closed = true
	for id, sub := range t.subs {
		delete(t.subs, id)
		close(sub)
	}
}

// StartCardTerminal opens the agent's CLI on a card: same folder, same
// worktree rules and same agent as a session on that card would get.
// projectName/agentName override what the card says, for the case where it says
// nothing.
//
// The conversation belongs to the stage the card stands on. There is no way to
// ask for another stage's — which is the whole rule about passed stages: their
// conversations reopen only when the card comes back and they are current
// again. A card outside any route has one conversation, node "".
func (m *Manager) StartCardTerminal(cardID, projectName, agentName string) (*TerminalSession, error) {
	if m.reader == nil {
		return nil, fmt.Errorf("чтение карточек недоступно")
	}
	nodeID, crew := m.cardStage(cardID)
	if live := m.TerminalForCardNode(cardID, nodeID); live != nil {
		return live, nil
	}
	ctx, cancel := context.WithTimeout(m.rootCtx, 10*time.Second)
	defer cancel()
	ev, err := m.reader.CardByID(ctx, cardID)
	if err != nil {
		return nil, fmt.Errorf("не удалось прочитать карточку: %w", err)
	}

	workdirPath, err := m.resolveWorkdir(ev)
	if projectName != "" {
		workdirPath, err = m.resolveNamedWorkdir(projectName)
	} else if errors.As(err, &errNoWorkdir{}) {
		// The card names no folder, and a terminal does not need one: the
		// conversation opens in the card's own talk directory (startTerminal),
		// where wording and plans are discussed before any folder exists. A
		// folder the card *does* name but which is broken stays an error — the
		// person meant it, and silently talking beside it would mislead.
		workdirPath, err = "", nil
	}
	if err != nil {
		return nil, err
	}
	agent := AgentEntry{}
	switch {
	case strings.TrimSpace(agentName) != "":
		agent, err = m.planningAgent(agentName)
	default:
		// A conversation that already exists continues with whoever held it:
		// re-resolving refused the card the moment a second agent was
		// registered, and the transcript `--continue` picks up is the held
		// agent's CLI's anyway. An agent since removed falls through to the
		// usual resolution.
		if rec, ok, recErr := m.store.LastTerminalForCardNode(cardID, nodeID); recErr == nil && ok && rec.Agent != "" {
			if held, heldErr := m.planningAgent(rec.Agent); heldErr == nil {
				agent = held
				break
			}
		}
		// The same resolution a session at this stage would go through: the
		// stage's own crew first, then the card's assignee, then the single
		// registered agent. A fully busy crew does not block a *terminal* —
		// the person opening one is the person watching, so the first crew
		// member answers even mid-session elsewhere.
		agent, err = m.terminalAgent(ev, crew)
	}
	if err != nil {
		return nil, err
	}
	return m.startTerminal(terminalSpec{
		cardID:      ev.CardID,
		nodeID:      nodeID,
		boardID:     ev.BoardID,
		title:       ev.Title,
		task:        ev.Body,
		workdirPath: workdirPath,
		base:        ev.Props["branch"],
		agent:       agent,
		// A folder that is not a repository has no copies to give, and a
		// terminal in one is a terminal in the folder itself. Which of the two
		// a repository gets is the board's answer (BoardPropGit).
	})
}

// boardFolder is «черновики доски»: the board's own directory under the app's
// data, where conversations with no folder of their own run — and where what
// an agent leaves for one card is on hand for the next. Named by the board's
// id and nothing else: a generated name (the herokuish kind) would have to be
// remembered somewhere, an id needs no state at all — and no UI ever shows
// the name, every surface says «черновики доски».
func (m *Manager) boardFolder(boardID string) string {
	if boardID == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(m.cfg.WorktreeDir), "boards", boardID)
}

// cardStage is the stage the card stands on and who works it: the node's own
// crew, else its column's. Both empty for a card outside any route.
func (m *Manager) cardStage(cardID string) (string, []string) {
	st, ok, err := m.flowState(cardID)
	if err != nil || !ok {
		return "", nil
	}
	flow, found := m.FlowByName(st.Flow)
	if !found {
		return st.NodeID, nil
	}
	node, found := flow.Node(st.NodeID)
	if !found {
		return st.NodeID, nil
	}
	crew := node.Crew()
	if len(crew) == 0 {
		if spec, ok := m.columnByName(flow.PropertyOr(m.triggerProperty()), node.Column); ok {
			crew = spec.Agents
		}
	}
	return st.NodeID, crew
}

// terminalAgent resolves who a terminal on this card speaks as. It is the
// session's own resolution with one difference: busy is not an answer, since a
// terminal is a person present, not a second unattended run.
func (m *Manager) terminalAgent(ev CardMoved, crew []string) (AgentEntry, error) {
	agent, busy, err := m.resolveSessionAgent(ev, crew)
	if err != nil {
		return AgentEntry{}, err
	}
	if !busy {
		return agent, nil
	}
	return m.planningAgent(crew[0])
}

// StartPlanningTerminal opens the CLI with no card behind it — the terminal
// half of "Plan a task". It runs in the folder itself and never creates a
// branch: there is nothing yet to put on one.
func (m *Manager) StartPlanningTerminal(projectName, agentName, boardID string) (*TerminalSession, error) {
	project, err := m.planningWorkdir(projectName)
	if err != nil {
		return nil, err
	}
	agent, err := m.planningAgent(agentName)
	if err != nil {
		return nil, err
	}
	if project.Path == "" {
		// Planning with no folder talks in «черновики доски» — the same answer
		// the card's dialog gives, for a conversation that is about the
		// board's cards rather than about code. The name is what the prompt
		// shows the agent; every UI surface says the same words.
		folder := m.boardFolder(boardID)
		if folder == "" {
			return nil, fmt.Errorf("для терминала нужна папка: выберите её в списке")
		}
		if err := os.MkdirAll(folder, 0o755); err != nil {
			return nil, fmt.Errorf("не удалось создать папку черновиков доски: %w", err)
		}
		project = WorkdirEntry{Name: "черновики доски", Path: folder}
	}
	// The same rule a card's terminal follows: asking twice means "show me the
	// one I have", not "start another CLI". A planning terminal has no card to
	// be found through, so without this a closed window left it running with
	// nothing in the UI pointing at it.
	if live := m.planningTerminal(project.Path, agent.Name); live != nil {
		return live, nil
	}
	return m.startTerminal(terminalSpec{
		title: "Планирование",
		// The board the dialog was opened from, and therefore the only board
		// the conversation may put cards on.
		boardID: boardID,
		// The planning instructions ride along as the task, which is what a
		// card's terminal already does with its card: the CLI is not ready for
		// input when it starts, so the terminal page offers it as a button
		// rather than typing it in.
		task:        planningPrompt(m.BoardPrompt(boardID), m.PlanningPrompt(), agent, project),
		workdirPath: project.Path,
		agent:       agent,
	})
}

// terminalSpec is everything startTerminal needs, resolved by the caller.
type terminalSpec struct {
	cardID string
	// nodeID is the stage of the card's route this conversation belongs to.
	// Empty for cards outside any route and for planning.
	nodeID string
	// boardID is also the board this terminal may write to through the board
	// tools. A card's terminal has its card's board; planning has the board it
	// was opened from, which is the only reason that dialog knows about one.
	boardID     string
	title       string
	task        string
	workdirPath string
	base        string
	agent       AgentEntry
	// prompt is the first message of the conversation, set only by a stage of a
	// route: the card's task, handed to the CLI the way a person would type it.
	// A terminal a person opened has none — they are about to type their own.
	prompt string
	// cwd/branch are where this conversation runs, when the caller has already
	// worked it out. A stage of a route has: the session claimed the card's
	// workspace before the terminal existed, and a stage told to run in the
	// folder itself claims nothing at all. Empty leaves the question to
	// startTerminal, which is what a person opening a terminal gets.
	cwd    string
	branch string
	// stage marks a terminal that is a stage of a route rather than somebody's
	// own conversation. What it changes is who reports to the card: a stage
	// writes one comment of its own when it ends (stageterminal.go), so this
	// terminal must not write the second one terminalEnded normally would.
	stage bool
}

func (m *Manager) startTerminal(spec terminalSpec) (*TerminalSession, error) {
	// A card whose terminal was open before goes back to the same directory and
	// asks the CLI to continue the conversation it left there. That is the
	// whole of "resume": the worktree is the card's, so the newest conversation
	// in it is the card's too, and no session id of somebody else's has to be
	// stored or guessed.
	resumeAt, resume := m.terminalResumePoint(spec)

	// Minted before anything can fail, because the grant carries it: the tools
	// let the agent say what this conversation is about, and that needs a name
	// for "this conversation" (DescribeTerminalFromTools).
	id := uuid.NewString()

	// The board tools: a terminal that stands on a board can hand work back to
	// it rather than leaving a person to retype the plan (boardtools.go). A
	// kind whose CLI cannot be told about MCP gets none, and the terminal opens
	// exactly as it did before.
	boardToken, mcpConfig := m.openBoardTools(spec.boardID, spec.cardID, id, spec.agent)

	argv, promptTaken, err := terminalCommand(spec.agent, resume, mcpConfig, spec.prompt)
	if err != nil {
		m.closeBoardTools(boardToken, mcpConfig)
		return nil, err
	}
	// The same lookup a session's agent gets, rather than PATH alone: a GUI
	// launch is given launchd's PATH, and the usual install locations are what
	// is left when the login shell could not be asked for the user's own
	// (internal/userpath).
	bin, err := lookupBin(argv[0], fmt.Sprintf("не найден %s — CLI агента %q не установлен", argv[0], spec.agent.Name))
	if err != nil {
		m.closeBoardTools(boardToken, mcpConfig)
		return nil, err
	}
	argv[0] = bin
	// The same CLI without the resume flags, kept for the one restart a refused
	// resume gets (restartFresh). Built here because this is where the binary has
	// already been found, and it cannot fail after the argv above did not.
	var freshArgv []string
	if resume {
		if fresh, _, freshErr := terminalCommand(spec.agent, false, mcpConfig, spec.prompt); freshErr == nil && len(fresh) > 0 {
			fresh[0] = bin
			freshArgv = fresh
		}
	}
	net, err := m.resolveNetwork(spec.agent)
	if err != nil {
		m.closeBoardTools(boardToken, mcpConfig)
		return nil, err
	}

	t := &TerminalSession{
		ID:          id,
		CardID:      spec.cardID,
		NodeID:      spec.nodeID,
		BoardID:     spec.boardID,
		Title:       spec.title,
		Task:        spec.task,
		WorkdirPath: spec.workdirPath,
		Cwd:         spec.workdirPath,
		AgentName:   spec.agent.Name,
		AgentKind:   spec.agent.Kind,
		Argv:        argv,
		freshArgv:   freshArgv,
		StartedAt:   time.Now(),
		m:           m,
		done:        make(chan struct{}),
		boardToken:  boardToken,
		mcpConfig:   mcpConfig,
		stage:       spec.stage,
	}

	switch {
	case resume:
		t.Cwd = resumeAt.Cwd
		t.Branch = resumeAt.Branch
		// The worktree is the earlier terminal's; this one is a visitor and
		// must not remove it on the way out.
		t.worktree = WorktreeInfo{Path: resumeAt.Cwd, Branch: resumeAt.Branch}
		// The same conversation continued, so what it was called and what it was
		// about come with it: a name a person typed must not be replaced by the
		// card's title the next time the terminal opens.
		if resumeAt.Title != "" {
			t.Title = resumeAt.Title
		}
		t.summary = resumeAt.Summary
	// A terminal takes the card's workspace — the same branch and the same
	// directory its sessions work in. It used to make one of its own, so a
	// person talking to an agent about a card was in a different copy from the
	// agent working on it.
	case spec.workdirPath != "" && spec.cardID != "":
		ws, err := m.ClaimWorkspace(WorkSpec{
			Workdir: spec.workdirPath,
			Owner:   spec.cardID,
			BoardID: spec.boardID,
			Title:   spec.title,
		})
		if err != nil {
			// Every failure below the grant has to give it back: the token
			// lives in m.grants and in a temp file, and a terminal that never
			// started is a door nobody will ever close.
			m.closeBoardTools(boardToken, mcpConfig)
			return nil, err
		}
		t.worktree = WorktreeInfo{Path: ws.Cwd, Branch: ws.Branch, BaseRef: ws.Base}
		// Only a copy this terminal *made* is its to put away; the card's
		// branch outlives every conversation held on it.
		t.usedWorktree = ws.Fresh && ws.Mode == WorkModeWorktree
		t.Cwd = ws.Cwd
		t.Branch = ws.Branch
	}

	// A caller that already knows where this runs outranks both: a stage of a
	// route is handed the workspace its session claimed, and the copy is that
	// session's to put away rather than this terminal's.
	if spec.cwd != "" {
		t.Cwd, t.Branch = spec.cwd, spec.branch
		t.worktree = WorktreeInfo{Path: spec.cwd, Branch: spec.branch}
		t.usedWorktree = false
	}

	// A conversation with no folder runs in «черновики доски» — the board's own
	// directory under the app's data, which is what every UI surface calls
	// it. One folder per board, deliberately: what an agent writes there for
	// one card (a brief, a draft) is on hand when another card of the same
	// board is talked over. The price is that the CLI's directory-scoped
	// resume is board-scoped here too — the same trade every non-git folder
	// folder already makes.
	if t.Cwd == "" && spec.cardID != "" {
		folder := m.boardFolder(spec.boardID)
		if err := os.MkdirAll(folder, 0o755); err != nil {
			m.closeBoardTools(boardToken, mcpConfig)
			return nil, fmt.Errorf("не удалось создать папку черновиков доски: %w", err)
		}
		t.Cwd = folder
	}
	t.startSHA = headSHA(m.rootCtx, t.Cwd)

	tty, err := pty.New()
	if err != nil {
		m.closeBoardTools(boardToken, mcpConfig)
		m.releaseTerminalWorktree(t)
		return nil, fmt.Errorf("не удалось открыть pty: %w", err)
	}
	t.tty = tty

	cmd := tty.CommandContext(m.rootCtx, argv[0], argv[1:]...)
	cmd.Dir = t.Cwd
	env, drop := spawnEnv(spec.agent, net)
	// The kind's own drops apply here exactly as they do to a session
	// (agentLaunch): a terminal runs the same vendor CLI, so the variables that
	// must not be inherited are the same ones. Leaving them out was the reason a
	// terminal opened from a dev build could never continue anything —
	// CLAUDE_CODE_CHILD_SESSION came through and the CLI saved no transcript.
	drop = append(drop, acpNative[spec.agent.Kind].dropEnv...)
	cmd.Env = terminalEnv(env, drop)
	t.env = cmd.Env
	if err := cmd.Start(); err != nil {
		_ = tty.Close()
		m.closeBoardTools(boardToken, mcpConfig)
		m.releaseTerminalWorktree(t)
		return nil, fmt.Errorf("не удалось запустить %s: %w", argv[0], err)
	}
	t.cmd = cmd
	t.launchedAt = time.Now()

	m.mu.Lock()
	if m.terminals == nil {
		m.terminals = map[string]*TerminalSession{}
	}
	m.terminals[id] = t
	m.mu.Unlock()

	// Recorded even for a planning terminal, so "where was I" survives the app
	// being closed — which is the only reason a terminal can be resumed at all.
	if err := m.store.InsertTerminal(TerminalRecord{
		ID: id, CardID: t.CardID, NodeID: t.NodeID, BoardID: t.BoardID, Title: t.Title,
		WorkdirPath: t.WorkdirPath, Cwd: t.Cwd, Branch: t.Branch,
		Agent: t.AgentName, Kind: t.AgentKind, Summary: t.summary, StartedAt: t.StartedAt,
	}); err != nil {
		m.log.Warn("acp: failed to record terminal session", "terminal", id, "err", err)
	}

	m.log.Info("acp: terminal started", "terminal", id, "card", t.CardID, "agent", t.AgentName, "cwd", t.Cwd)
	m.emitTerminal(t)

	// Opening it is not commented on the card: the window is in front of
	// whoever opened it, and the card's own face carries the console button
	// while one runs. What the card is told is what the terminal left behind —
	// terminalReport, when the CLI exits.

	go t.pump()
	// What the command line could not carry is typed in instead, once the CLI is
	// listening. A resumed conversation is always this way round.
	if spec.prompt != "" && !promptTaken {
		go t.deliverPrompt(spec.prompt)
	}
	return t, nil
}

// promptSettle is how long the CLI has to draw nothing before the task is typed
// into it, and promptWait is how long we wait for that quiet at all. A TUI paints
// continuously while it starts up, so quiet is what "ready for input" looks like
// from outside; the deadline is there because a CLI asking something on its first
// frame would otherwise hold the task for ever, and a task typed under a question
// is at least visible to whoever opens the terminal.
const (
	promptSettle = 2 * time.Second
	promptWait   = 30 * time.Second
)

// deliverPrompt types the stage's task into a CLI that could not take it on its
// command line — a resumed conversation, or a kind whose CLI we do not know a
// flag for. Bracketed paste is what keeps a task of several lines one message:
// a bare newline inside a TUI's input is a send.
func (t *TerminalSession) deliverPrompt(text string) {
	if text == "" {
		return
	}
	deadline := time.Now().Add(promptWait)
	for {
		select {
		case <-t.done:
			return
		case <-time.After(250 * time.Millisecond):
		}
		if t.quietFor(time.Now()) >= promptSettle || time.Now().After(deadline) {
			break
		}
	}
	if err := t.Write([]byte("\x1b[200~" + text + "\x1b[201~\r")); err != nil {
		t.m.log.Warn("acp: could not hand the task to the terminal", "terminal", t.ID, "err", err)
	}
}

// pump moves the CLI's output to every window until the process exits — and
// starts it once more, without the resume flags, when what exited was a resume
// the CLI refused (restartFresh). Only the last exit is the terminal's.
func (t *TerminalSession) pump() {
	for {
		cmd, tty := t.running()
		t.copyOutput(tty)
		waitErr := cmd.Wait()
		code := -1
		if cmd.ProcessState != nil {
			code = cmd.ProcessState.ExitCode()
		}
		t.mu.Lock()
		t.exitErr, t.exitCode = waitErr, code
		t.mu.Unlock()
		if !t.restartFresh() {
			break
		}
	}
	close(t.done)
	t.finish()
	t.closeTTY()
	t.m.terminalEnded(t)
}

// copyOutput fans one process's output out to every window. A read on the pty
// master ends as soon as the child is gone, which is what makes the end of this
// the moment to wait for it.
func (t *TerminalSession) copyOutput(tty pty.Pty) {
	buf := make([]byte, 32*1024)
	for {
		n, err := tty.Read(buf)
		if n > 0 {
			t.publish(buf[:n])
		}
		if err != nil {
			return
		}
	}
}

// restartFresh runs the CLI again without the flags that continue a
// conversation, after a resumed launch exited straight away, and reports whether
// it did.
//
// "Continue what is in this directory" is a promise about the CLI's own history,
// and our record of a terminal is not that history: a terminal that was opened
// and never spoken in leaves a row here and nothing there — which is what a
// `wails3 dev` restart makes of every terminal that was open — and `claude
// --continue` then prints "No conversation found to continue" and exits 1. The
// person who clicked the button wanted a terminal, so they get one; what they
// got before was a dead window and a comment on the card saying the CLI closed
// with code 1. Nothing vendor-specific is read to find this out, which is the
// point: the same restart covers a pruned transcript, a `codex resume --last`
// with nothing to resume, and whatever the next CLI does about it.
//
// Once only, and only for an exit too soon to have been work: a refused resume
// dies before it draws anything, while a CLI a person used and closed exits 0 —
// or exits nonzero much later, and that is its own report to make. A kill (code
// -1) is this app closing the terminal or shutting down, and must never come
// back.
func (t *TerminalSession) restartFresh() bool {
	t.mu.Lock()
	fresh, restarted, code, since := t.freshArgv, t.restarted, t.exitCode, time.Since(t.launchedAt)
	t.mu.Unlock()
	if len(fresh) == 0 || restarted || code <= 0 || since > resumeRefusedWindow {
		return false
	}
	if t.m.rootCtx != nil && t.m.rootCtx.Err() != nil {
		return false
	}

	// A new pty: this one's slave is the controlling terminal of the process that
	// has just gone, and a second process cannot be started in it.
	tty, err := pty.New()
	if err != nil {
		t.m.log.Warn("acp: cannot open a pty to restart the terminal", "terminal", t.ID, "err", err)
		return false
	}
	cmd := tty.CommandContext(t.m.rootCtx, fresh[0], fresh[1:]...)
	cmd.Dir = t.Cwd
	cmd.Env = t.env
	if err := cmd.Start(); err != nil {
		_ = tty.Close()
		t.m.log.Warn("acp: cannot restart the terminal without resuming", "terminal", t.ID, "err", err)
		return false
	}

	t.mu.Lock()
	old, oldClosed := t.tty, t.ttyClosed
	t.tty, t.cmd, t.ttyClosed = tty, cmd, false
	// The argv is what the UI shows as the command, and the exit code is now
	// nobody's: this terminal is running again.
	t.Argv, t.restarted, t.launchedAt = fresh, true, time.Now()
	t.exitCode, t.exitErr = 0, nil
	cols, rows := t.cols, t.rows
	t.mu.Unlock()
	// Ours alone to close: anything else that wanted this pty gone asked under
	// the lock, and got either the flag above or the new pty.
	if !oldClosed {
		_ = old.Close()
	}
	if cols > 0 && rows > 0 {
		_ = tty.Resize(cols, rows)
	}

	// Said in the window, under the CLI's own refusal, because that is where
	// somebody is reading. The card is told nothing: nothing happened to it.
	t.publish([]byte("\r\n\x1b[33mПродолжить прошлый разговор не удалось — открыт новый.\x1b[0m\r\n"))
	t.m.log.Info("acp: resume refused, terminal restarted fresh",
		"terminal", t.ID, "card", t.CardID, "agent", t.AgentName)
	return true
}

// terminalEnded reports what the CLI left behind and forgets the session.
func (m *Manager) terminalEnded(t *TerminalSession) {
	m.mu.Lock()
	delete(m.terminals, t.ID)
	m.mu.Unlock()

	m.log.Info("acp: terminal finished", "terminal", t.ID, "card", t.CardID, "exit", t.exitCode)
	if err := m.store.FinishTerminal(t.ID, time.Now(), t.exitCode); err != nil {
		m.log.Warn("acp: failed to record terminal end", "terminal", t.ID, "err", err)
	}
	// A stage of a route writes its own comment, once, and that comment already
	// carries this report (stageterminal.go). Two comments for one piece of work
	// is what the card was rescued from.
	if t.CardID != "" && !t.stage {
		m.commentCard(t.CardID, terminalReport(m.rootCtx, t))
	}
	m.closeBoardTools(t.boardToken, t.mcpConfig)
	// A worktree with nothing in it is a branch nobody asked for; one with
	// commits stays, exactly as a session's does.
	m.releaseTerminalWorktree(t)
	m.emitTerminal(t)
}

// releaseTerminalWorktree removes the worktree when the terminal left it clean.
func (m *Manager) releaseTerminalWorktree(t *TerminalSession) {
	if !t.usedWorktree {
		return
	}
	removed, err := RemoveWorktreeIfClean(m.rootCtx, t.WorkdirPath, t.worktree)
	if err != nil {
		m.log.Warn("acp: failed to clean up terminal worktree", "terminal", t.ID, "err", err)
		return
	}
	if removed {
		t.usedWorktree = false
	}
}

// Terminal returns a live terminal session by id.
func (m *Manager) Terminal(id string) *TerminalSession {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.terminals[id]
}

// TerminalForCard returns the card's live terminal session on any stage, if it
// has one — "somebody is working this card in a CLI right now".
func (m *Manager) TerminalForCard(cardID string) *TerminalSession {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, t := range m.terminals {
		if t.CardID != "" && t.CardID == cardID {
			return t
		}
	}
	return nil
}

// TerminalForCardNode returns the live conversation of one stage of the card.
// A live terminal on a *passed* stage is deliberately not this: it stays
// reachable by id until its CLI exits, but the stage the card left cannot be
// where a new ask lands.
func (m *Manager) TerminalForCardNode(cardID, nodeID string) *TerminalSession {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, t := range m.terminals {
		if t.CardID != "" && t.CardID == cardID && t.NodeID == nodeID {
			return t
		}
	}
	return nil
}

// planningTerminal is the live card-less terminal for this folder and
// agent, if one is open.
func (m *Manager) planningTerminal(workdirPath, agentName string) *TerminalSession {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, t := range m.terminals {
		if t.CardID == "" && t.WorkdirPath == workdirPath && t.AgentName == agentName {
			return t
		}
	}
	return nil
}

// LiveTerminals lists every terminal currently running, newest first. It is how
// the UI stays able to point at one: a window can be closed, and a terminal
// without a card has nothing else to be found through.
func (m *Manager) LiveTerminals() []TerminalInfo {
	m.mu.Lock()
	live := make([]*TerminalSession, 0, len(m.terminals))
	for _, t := range m.terminals {
		live = append(live, t)
	}
	m.mu.Unlock()

	out := make([]TerminalInfo, 0, len(live))
	for _, t := range live {
		out = append(out, t.Info())
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt > out[j].StartedAt })
	return out
}

// RenameTerminal is a person calling a conversation what it is to them. The
// title starts as the card's, which answers "which card" and nothing else, and a
// list of open terminals is read by what each one is *about*.
//
// It is written to the record as well as to the live session, so the name comes
// back when the conversation does (startTerminal, on resume).
func (m *Manager) RenameTerminal(id, title string) error {
	title = strings.TrimSpace(title)
	if title == "" {
		return fmt.Errorf("название не может быть пустым")
	}
	t := m.Terminal(id)
	if t == nil {
		return fmt.Errorf("терминал %s не активен", id)
	}
	t.mu.Lock()
	t.Title = title
	t.mu.Unlock()
	if err := m.store.RenameTerminal(id, title); err != nil {
		m.log.Warn("acp: failed to record a terminal's new name", "terminal", id, "err", err)
	}
	m.emitTerminal(t)
	return nil
}

// SetTerminalSummary records what the agent said this conversation is about.
// Empty clears it, which is how an agent takes back a line that has stopped
// being true; nothing else is validated, because it is one line of prose.
func (m *Manager) SetTerminalSummary(id, summary string) error {
	summary = strings.TrimSpace(summary)
	// A recap is drawn in one line beside a title. An agent asked for a summary
	// sometimes writes a paragraph, and the list is not the place to read one.
	// Counted in runes, because this line is Russian more often than not and
	// cutting bytes would cut a letter in half.
	if runes := []rune(summary); len(runes) > terminalSummaryLimit {
		summary = strings.TrimSpace(string(runes[:terminalSummaryLimit])) + "…"
	}
	// One line: a newline in the middle would break the row it is drawn in.
	summary = strings.Join(strings.Fields(summary), " ")
	t := m.Terminal(id)
	if t == nil {
		return fmt.Errorf("терминал %s не активен", id)
	}
	t.mu.Lock()
	t.summary = summary
	t.mu.Unlock()
	if err := m.store.SetTerminalSummary(id, summary); err != nil {
		m.log.Warn("acp: failed to record a terminal's summary", "terminal", id, "err", err)
	}
	m.emitTerminal(t)
	return nil
}

// terminalSummaryLimit is how much of the agent's line is kept. Generous enough
// for a sentence, short enough that the list stays a list.
const terminalSummaryLimit = 200

// CloseTerminal ends the CLI and everything it started.
func (m *Manager) CloseTerminal(id string) error {
	t := m.Terminal(id)
	if t == nil {
		return fmt.Errorf("терминал %s не активен", id)
	}
	cmd, _ := t.running()
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
	t.closeTTY()
	return nil
}

// shutdownTerminals ends every terminal when the app is closing.
func (m *Manager) shutdownTerminals() {
	m.mu.Lock()
	live := make([]*TerminalSession, 0, len(m.terminals))
	for _, t := range m.terminals {
		live = append(live, t)
	}
	m.mu.Unlock()
	for _, t := range live {
		cmd, _ := t.running()
		if cmd != nil && cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		t.closeTTY()
	}
}

// Attention is one thing waiting for a person, from either of the two places an
// agent can want one — see the reasons below. The card is what the UI shows it
// on; a planning terminal has no card at all.
type Attention struct {
	// Key identifies this wait for the UI, which keeps them in a map.
	Key        string `json:"key"`
	TerminalID string `json:"terminalId,omitempty"`
	CardID     string `json:"cardId,omitempty"`
	BoardID    string `json:"boardId,omitempty"`
	Title      string `json:"title,omitempty"`
	Agent      string `json:"agent,omitempty"`
	Reason     string `json:"reason"`
	// Tool is set for a permission question: what the agent wants to use.
	Tool string `json:"tool,omitempty"`
	// A question carries itself, so it can be answered where it is read.
	QuestionID string           `json:"questionId,omitempty"`
	Text       string           `json:"text,omitempty"`
	Options    []QuestionOption `json:"options,omitempty"`
	FreeText   bool             `json:"freeText,omitempty"`
	// Awaiting is false in an event that says a wait ended; the list only ever
	// carries true.
	Awaiting bool   `json:"awaiting"`
	Since    string `json:"since,omitempty"`
}

// The two reasons a card can want a person.
//
// AttentionQuestion is the protocol asking: an ACP session sent
// session/request_permission or an elicitation, and the agent is waiting on the
// answer with its turn still open (question.go). Only a deploy or a test is
// still such a session.
//
// AttentionTerminal is a stage of a route whose CLI has stopped drawing. There
// is no protocol to ask through in a pty, so this is silence standing in for a
// question — which is exactly what was thrown out once, and it is back because
// what it means has changed. Silence used to be measured on a terminal somebody
// had opened and left, where "nothing is happening" is the ordinary state, and
// it announced "needs you" five seconds later every time. Here the agent was
// handed a task and has not said it is finished, so a CLI drawing nothing is
// waiting on somebody: an agent mid-turn redraws its own spinner, and the
// permission box it stops at is a still frame.
const (
	AttentionQuestion = "question"
	AttentionTerminal = "terminal"
)

// withKey fills in what identifies this wait. A question is keyed by its own id
// rather than by its card: an agent making two tool calls at once asks twice,
// and answering one must not take the other off the screen.
func (a Attention) withKey() Attention {
	switch {
	case a.TerminalID != "":
		a.Key = a.TerminalID
	case a.QuestionID != "":
		a.Key = "q:" + a.QuestionID
	default:
		a.Key = "card:" + a.CardID
	}
	return a
}

// Attention lists every question waiting for a person, oldest first: the one
// that has been ignored longest is the one worth showing.
func (m *Manager) Attention() []Attention {
	questions := m.Questions()
	out := make([]Attention, 0, len(questions))
	for _, q := range questions {
		out = append(out, q.attention().withKey())
	}
	for _, a := range m.stageAttention() {
		out = append(out, a.withKey())
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Since < out[j].Since })
	return out
}

func (m *Manager) emitAttentionRecord(a Attention) {
	if m == nil || m.ui == nil {
		return
	}
	a = a.withKey()
	m.ui.Emit(EventAttention, map[string]any{
		"key":        a.Key,
		"terminalId": a.TerminalID,
		"cardId":     a.CardID,
		"boardId":    a.BoardID,
		"title":      a.Title,
		"agent":      a.Agent,
		"reason":     a.Reason,
		"tool":       a.Tool,
		"questionId": a.QuestionID,
		"text":       a.Text,
		"options":    a.Options,
		"freeText":   a.FreeText,
		"awaiting":   a.Awaiting,
		"since":      a.Since,
	})
}

// emitTerminal tells the UI a terminal appeared, changed or ended.
func (m *Manager) emitTerminal(t *TerminalSession) {
	if m.ui == nil {
		return
	}
	info := t.Info()
	m.ui.Emit(EventTerminal, map[string]any{
		"terminalId": info.ID,
		"cardId":     info.CardID,
		"running":    info.Running,
		"exitCode":   info.ExitCode,
	})
}

// terminalEmulator is what the CLI is being drawn on, and it is written rather
// than inherited: the other end of this pty is xterm.js, which is a 256-colour,
// true-colour emulator whatever launched the app.
//
// Inheriting was the bug. A packaged .app is a child of launchd, which sets
// neither of these, and a CLI with no TERM draws itself in black and white —
// `wails3 dev` hid it for as long as it did because a build started from a
// shell inherits the outer terminal's. And inheriting is wrong even when there
// is something to inherit: tmux's `screen`, a CI runner's `dumb` and an ssh
// session's `vt100` all describe a terminal that is not the one this output is
// painted on.
var terminalEmulator = []string{
	"TERM=xterm-256color",
	"COLORTERM=truecolor",
}

// terminalEnv applies spawnEnv's result to the current environment: drop first,
// then add, so an agent's own value wins over an inherited one exactly as it
// does for an ACP session — terminalEmulator included, since an entry naming
// its own TERM is somebody saying they know better.
func terminalEnv(add []string, drop []string) []string {
	dropped := make(map[string]bool, len(drop)+len(terminalEmulator))
	for _, name := range drop {
		dropped[name] = true
	}
	for _, kv := range terminalEmulator {
		if name, _, ok := strings.Cut(kv, "="); ok {
			dropped[name] = true
		}
	}
	env := make([]string, 0, len(add)+len(terminalEmulator)+32)
	env = append(env, terminalEmulator...)
	for _, kv := range environ() {
		name, _, ok := strings.Cut(kv, "=")
		if ok && dropped[name] {
			continue
		}
		env = append(env, kv)
	}
	return append(env, add...)
}

// terminalResumePoint answers where a card's terminal should pick up: the
// directory the last one worked in, when it is still there and the CLI knows
// how to continue a conversation. Anything else — no history, a worktree the
// user has since removed, a kind with no resume flag — starts fresh.
func (m *Manager) terminalResumePoint(spec terminalSpec) (TerminalRecord, bool) {
	if spec.cardID == "" || !terminalCanResume(spec.agent) {
		return TerminalRecord{}, false
	}
	// Per stage: the conversation continued is the one this stage left. The
	// worktree is directory-scoped, though, and so is the CLI's own resume —
	// the metadata is per stage, the transcript `--continue` picks up is the
	// newest one in the directory.
	rec, ok, err := m.store.LastTerminalForCardNode(spec.cardID, spec.nodeID)
	if err != nil {
		m.log.Warn("acp: failed to read the card's last terminal", "card", spec.cardID, "err", err)
		return TerminalRecord{}, false
	}
	if !ok || rec.Cwd == "" || rec.WorkdirPath != spec.workdirPath {
		return TerminalRecord{}, false
	}
	if info, err := os.Stat(rec.Cwd); err != nil || !info.IsDir() {
		return TerminalRecord{}, false
	}
	return rec, true
}

// ResumableTerminal describes what a card would reopen, so the UI can say
// "продолжить" rather than "открыть" — and say nothing at all when there is
// nothing to continue.
type ResumableTerminal struct {
	Available bool   `json:"available"`
	Cwd       string `json:"cwd,omitempty"`
	Branch    string `json:"branch,omitempty"`
	Agent     string `json:"agent,omitempty"`
	EndedAt   string `json:"endedAt,omitempty"`
}

// CardConversation is one stage's conversation as the card's panel lists them:
// which stage, who spoke there, whether it is running, and whether the card is
// standing on it — the only one a new terminal can open.
type CardConversation struct {
	NodeID     string `json:"nodeId,omitempty"`
	Column     string `json:"column,omitempty"`
	Agent      string `json:"agent,omitempty"`
	Running    bool   `json:"running,omitempty"`
	Current    bool   `json:"current,omitempty"`
	TerminalID string `json:"terminalId,omitempty"` // set while running
	StartedAt  string `json:"startedAt,omitempty"`
	EndedAt    string `json:"endedAt,omitempty"`
	ExitCode   int    `json:"exitCode,omitempty"`
}

// CardConversations lists the card's conversations, one per stage it was
// worked on, newest first. A passed stage's entry is history until the card
// comes back; the current stage's is what the terminal button opens.
func (m *Manager) CardConversations(cardID string) []CardConversation {
	recs, err := m.store.TerminalsForCard(cardID)
	if err != nil {
		m.log.Warn("acp: cannot read the card's terminals", "card", cardID, "err", err)
		return nil
	}
	if len(recs) == 0 {
		return nil
	}
	currentNode, _ := m.cardStage(cardID)
	columns := m.stageColumns(cardID)

	out := make([]CardConversation, 0, len(recs))
	for _, rec := range recs {
		c := CardConversation{
			NodeID:    rec.NodeID,
			Column:    columns[rec.NodeID],
			Agent:     rec.Agent,
			Current:   rec.NodeID == currentNode,
			StartedAt: rec.StartedAt.Format(time.RFC3339),
			ExitCode:  rec.ExitCode,
		}
		if rec.EndedAt != nil {
			c.EndedAt = rec.EndedAt.Format(time.RFC3339)
		}
		if live := m.TerminalForCardNode(cardID, rec.NodeID); live != nil {
			c.Running = true
			c.TerminalID = live.ID
		}
		out = append(out, c)
	}
	return out
}

// stageColumns maps the card's route nodes to the columns a person knows them
// by. Empty for a card outside any route.
func (m *Manager) stageColumns(cardID string) map[string]string {
	st, ok, err := m.flowState(cardID)
	if err != nil || !ok {
		return nil
	}
	flow, found := m.FlowByName(st.Flow)
	if !found {
		return nil
	}
	out := make(map[string]string, len(flow.Nodes))
	for _, n := range flow.Nodes {
		out[n.ID] = n.Column
	}
	return out
}

// TerminalHistoryForCard reports whether the card has a terminal to resume.
func (m *Manager) TerminalHistoryForCard(cardID string) ResumableTerminal {
	rec, ok, err := m.store.LastTerminalForCard(cardID)
	if err != nil || !ok || rec.Cwd == "" {
		return ResumableTerminal{}
	}
	if info, err := os.Stat(rec.Cwd); err != nil || !info.IsDir() {
		return ResumableTerminal{}
	}
	out := ResumableTerminal{
		Available: canResumeTerminal(rec.Kind),
		Cwd:       rec.Cwd,
		Branch:    rec.Branch,
		Agent:     rec.Agent,
	}
	// A folderless conversation lives in «черновики доски», which is not where
	// any work lives — and the stamp under the card's title reads Cwd as the
	// worktree. The conversation stays resumable; the address is nobody's
	// business.
	if rec.WorkdirPath == "" {
		out.Cwd = ""
	}
	if rec.EndedAt != nil {
		out.EndedAt = rec.EndedAt.Format(time.RFC3339)
	}
	return out
}
