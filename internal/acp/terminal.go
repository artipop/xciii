package acp

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
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
	// NodeID is the node this conversation belongs to — the option id of the
	// card's column, or nodeNone; empty only for planning terminals.
	NodeID string
	// ColumnName is what that node was called when the conversation started.
	ColumnName string
	BoardID    string
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
	// discarded marks a conversation a person threw away, which is the one exit
	// the card must not be told about: the record is being deleted in the same
	// breath, and a comment about a terminal nobody will ever find again is a
	// note about the machinery rather than about the work.
	discarded bool
	// lastOutput is when the CLI last drew anything. It is how a stage tells a
	// CLI that is working from one that has stopped to ask something: an agent
	// mid-turn redraws its own spinner, and a TUI waiting on an answer draws
	// nothing at all (stageterminal.go).
	lastOutput time.Time
	// resizedAt is when a window last told the CLI how big it is, and workAt is
	// the last output that was not the redraw that provoked. The two exist for
	// one reason: opening the terminal resizes it, a TUI redraws itself when it
	// is resized, and that redraw is output we caused by looking. Reading it as
	// the agent doing something is what made a wait somebody had just answered
	// come back as a fresh notification a minute later, for ever
	// (attentionack.go).
	resizedAt time.Time
	workAt    time.Time

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
	// Tools says this CLI was handed the board tools, which is what makes it
	// answerable: «попросить агента назвать разговор» is a message typed into a
	// CLI that can only reply through name_conversation, so a kind that took no
	// tools must not be offered the button (AskTerminalName).
	Tools bool `json:"tools,omitempty"`
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
		Tools:       t.boardToken != "",
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
	t.resizedAt = time.Now()
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

// isDiscarded reports a conversation a person threw away, which the exit path
// reads to stay quiet about it (DeleteCardConversation).
func (t *TerminalSession) isDiscarded() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.discarded
}

// isStage reports a conversation a route is running rather than a person.
func (t *TerminalSession) isStage() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.stage
}

// startupFailure reports a CLI that exited within window of being launched, and
// exited badly: it never got as far as the work, so whatever it printed is the
// whole story. A stage reads this to tell "the agent could not be started" from
// "somebody closed the window", which look identical from outside — one is a
// failure to say out loud, the other is a person's own doing.
func (t *TerminalSession) startupFailure(window time.Duration) (int, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	// A negative code is a kill, which is this app closing the terminal.
	if t.exitCode <= 0 {
		return 0, false
	}
	return t.exitCode, time.Since(t.launchedAt) <= window
}

// tail is the last of what the CLI drew, as plain text: what it said on the way
// out, for a card that has to be told why nothing happened. The escapes a TUI
// paints with are dropped — a comment is read, not rendered.
func (t *TerminalSession) tail(n int) string {
	t.mu.Lock()
	buf := append([]byte(nil), t.buf...)
	t.mu.Unlock()
	text := strings.TrimSpace(stripANSI(string(buf)))
	if r := []rune(text); len(r) > n {
		return "…" + string(r[len(r)-n:])
	}
	return text
}

// ansiEscape matches what a TUI paints with: CSI sequences and the OSC ones
// that set a window title. Enough to make a dying CLI's last words readable in
// a card comment, which is all this is for — nothing here tries to be an
// emulator, xterm.js on the other end of the pty is that.
var ansiEscape = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|\r`)

func stripANSI(s string) string { return ansiEscape.ReplaceAllString(s, "") }

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

// resizeEcho is how long after a window tells the CLI its size the output that
// follows still counts as the CLI redrawing itself rather than as the agent
// doing something. Generous for a repaint, far short of a turn.
const resizeEcho = 3 * time.Second

// workedAt is when the CLI last drew something a person did not cause by
// looking at it. See resizedAt.
func (t *TerminalSession) workedAt() time.Time {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.workAt
}

// publish fans one chunk of output out to every window and keeps a copy.
func (t *TerminalSession) publish(chunk []byte) {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := time.Now()
	t.lastOutput = now
	if now.Sub(t.resizedAt) > resizeEcho {
		t.workAt = now
	}
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

// A conversation is keyed by the card's node: the option id of the column the
// card stands in — the same id a route's stage hangs off (FlowNode.ID), so the
// stage that runs in a column and the person who opens a terminal there are in
// **one** conversation, with the column's own agent, workspace and prompt.
// Come back to the node and you come back to the session.
//
// This replaced a special key for "the card's own conversation, apart from
// every stage's" (@brainstorm). That split existed to stop a stage typing the
// card's task into a person's discussion, and the node model answers the same
// problem at the source: what a column means — who works there and what they
// are told — is the column's setting, so the conversation a stage joins is the
// conversation a person deliberately opened *about that stage*.
//
// nodeNone is the node of a card that has no column at all, spelled with `@`
// because option ids are not made of it: a card can be talked over the moment
// it exists, before anybody files it anywhere.
const nodeNone = "@none"

// StartCardTerminal opens the conversation of the node the card stands on —
// «обсудить эту карточку», and, on a column that runs an agent, «сесть рядом с
// работой»: person and stage share the node's one conversation.
// projectName/agentName override what the card says, for the case where it
// says nothing.
//
// It asks little of the card. A card with no folder is an ordinary case —
// wording, a brief and a plan all come before anybody decides where the work
// lives — and on a column that runs no agent it claims no workspace, so no
// branch appears because somebody wanted to think out loud. On an agent
// column the opposite is deliberate: the conversation *is* the stage's, so it
// works where the stage works — the card's workspace — and a stage starting
// later joins it there instead of opening a second CLI beside it.
func (m *Manager) StartCardTerminal(cardID, projectName, agentName string) (*TerminalSession, error) {
	if m.reader == nil {
		return nil, fmt.Errorf("чтение карточек недоступно")
	}
	ctx, cancel := context.WithTimeout(m.rootCtx, 10*time.Second)
	defer cancel()
	ev, err := m.reader.CardByID(ctx, cardID)
	if err != nil {
		return nil, fmt.Errorf("не удалось прочитать карточку: %w", err)
	}
	place := m.cardPlace(ev)
	if live := m.TerminalForCardNode(cardID, place.node); live != nil {
		return live, nil
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
		if rec, ok, recErr := m.store.LastTerminalForCardNode(cardID, place.node); recErr == nil && ok && rec.Agent != "" {
			if held, heldErr := m.planningAgent(rec.Agent); heldErr == nil {
				agent = held
				break
			}
		}
		// The same resolution a session at this node would go through: the
		// node's own crew first, then the card's assignee, then the single
		// registered agent. A fully busy crew does not block a *terminal* —
		// the person opening one is the person watching, so the first crew
		// member answers even mid-session elsewhere.
		agent, err = m.terminalAgent(ev, place.crew)
	}
	if err != nil {
		return nil, err
	}
	spec := terminalSpec{
		cardID:      ev.CardID,
		nodeID:      place.node,
		columnName:  place.column,
		boardID:     ev.BoardID,
		title:       ev.Title,
		task:        ev.Body,
		intro:       joinPrompts(place.prompt, cardInputs(ev, place.reads), cardIntro(ev)),
		workdirPath: workdirPath,
		base:        ev.Props["branch"],
		agent:       agent,
	}
	// Where the conversation runs is the node's answer. An agent column works
	// the card, so its conversation claims the card's workspace exactly as its
	// stage would (startTerminal's own claim path; a stage told to run in the
	// folder runs there). Every other column's conversation stands beside the
	// work and creates nothing: the copy the card already has, else the folder,
	// else the board's drafts.
	if place.works && workdirPath != "" {
		if place.runIn == RunInWorkdir {
			spec.cwd = workdirPath
		}
	} else {
		spec.cwd, spec.branch = m.talkingPlace(ev.BoardID, ev.CardID, workdirPath)
	}
	return m.startTerminal(spec)
}

// cardPlace is the node a card stands on, with what that node has to say about
// a conversation held there: what the column is called, who works it, whether
// it runs an agent at all, where, and with which instructions.
type cardPlace struct {
	node   string
	column string
	crew   []string
	works  bool // the node runs an agent, so its conversation is the stage's
	runIn  string
	prompt string
	reads  []string
}

// cardPlace resolves where the card is. The route's own record answers first —
// its node ids survive column renames — and is checked against the column the
// card actually shows, so a card dragged off its route by hand is placed where
// it stands, not where the route last saw it. A card outside any route is
// placed by the value of the trigger property; one with no value at all stands
// on nodeNone, which is still a place to talk.
func (m *Manager) cardPlace(ev CardMoved) cardPlace {
	property := m.triggerProperty()
	if st, ok, _ := m.flowState(ev.CardID); ok {
		if flow, found := m.FlowByName(st.Flow); found {
			property = flow.PropertyOr(property)
			if node, has := flow.Node(st.NodeID); has && columnMatchesCard(ev, property, node.Column) {
				place := cardPlace{node: st.NodeID, column: node.Column, crew: node.Crew(), runIn: node.RunIn}
				spec, _ := m.columnByName(property, node.Column)
				if len(place.crew) == 0 {
					place.crew = spec.Agents
				}
				action := node.Action
				if action == "" {
					action = spec.Action
				}
				place.works = action == FlowActionAgent
				place.runIn = node.RunsIn(action)
				place.prompt = firstNonEmpty(node.Prompt, spec.Prompt)
				place.reads = node.Reads
				if len(place.reads) == 0 {
					place.reads = spec.Reads
				}
				return place
			}
		}
	}
	for _, opt := range ev.SelectedOptions {
		if !strings.EqualFold(opt.PropertyName, property) || opt.OptionID == "" {
			continue
		}
		place := cardPlace{node: opt.OptionID, column: opt.Name}
		if spec, ok := m.columnFor(ev.BoardID, opt); ok {
			place.crew = spec.Agents
			place.works = spec.Action == FlowActionAgent
			place.prompt = spec.Prompt
			place.reads = spec.Reads
		}
		return place
	}
	return cardPlace{node: nodeNone}
}

// columnMatchesCard reports whether the card's value on the property is this
// column — or whether the card cannot say (no options carried, as in a test
// fake), in which case the route's record is trusted.
func columnMatchesCard(ev CardMoved, property, column string) bool {
	if len(ev.SelectedOptions) == 0 {
		return true
	}
	for _, opt := range ev.SelectedOptions {
		if strings.EqualFold(opt.PropertyName, property) {
			return strings.EqualFold(opt.Name, column)
		}
	}
	return true
}

// joinPrompts is texts separated by blank lines, empties dropped.
func joinPrompts(parts ...string) string {
	var out []string
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, "\n\n")
}


// cardIntro is what the card's own conversation opens with: which card it is
// about, in the card's own words.
//
// It is here because the person opening this panel has the card in front of
// them and the agent has nothing — the conversation used to start on a blank
// screen, and the first thing anybody typed was the title they were looking at.
// The agent is told to wait, because this is a card being thought about rather
// than a task being handed over; the stage of a route says the opposite, and
// says it with its own prompt.
//
// English, like everything the system says to an agent: the app is used in more
// than one language, and the card underneath is in whichever one the person
// writes — which is the language the answer should come back in.
func cardIntro(ev CardMoved) string {
	title := strings.TrimSpace(ev.Title)
	if title == "" {
		return ""
	}
	var b strings.Builder
	b.WriteString("We are looking at a card on the board. Nothing is being asked of you yet — read it and wait for the person. Answer in the language the card is written in.\n\n")
	fmt.Fprintf(&b, "Card: %s", title)
	if body := strings.TrimSpace(ev.Body); body != "" {
		fmt.Fprintf(&b, "\n\nDescription:\n%s", truncateRunes(body, cardIntroBodyLimit))
	}
	return b.String()
}

// cardIntroBodyLimit is how much of a card's description travels into the
// opening message. A card is a person's own writing and can be a page of it;
// what the conversation needs is what the card is about, and the agent can read
// the rest through get_card.
const cardIntroBodyLimit = 4000

// talkingPlace is where the card's own conversation runs. The copy the card
// already has, when it has one — talking about the work beside the work is the
// point, and a copy folded away is put back from its branch rather than
// remade — otherwise the folder itself. Never a claim: a conversation that
// invented a branch would leave one behind on every card somebody thought
// about, and the card's work is the route's business, not this one's. An empty
// answer means there is no folder at all, and startTerminal talks in the
// board's drafts.
func (m *Manager) talkingPlace(boardID, cardID, workdirPath string) (cwd, branch string) {
	if workdirPath == "" {
		return "", ""
	}
	if held, ok := m.heldWorkspace(workdirPath, cardID, m.WorkModeFor(boardID, workdirPath)); ok && held.Cwd != "" {
		return held.Cwd, held.Branch
	}
	return workdirPath, ""
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
	// nodeID is the node this conversation belongs to — the option id of the
	// card's column, or nodeNone. Empty only for planning, which has no card.
	nodeID string
	// columnName is what that node is called right now, frozen into the record:
	// past columns are facts about the past, and the board no longer remembers
	// an option somebody deleted.
	columnName string
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
	// intro is the same thing for a conversation that is *starting*: what the
	// card says, so the agent is looking at what the person is looking at. It is
	// dropped on a resume, where the conversation already knows — a stage's
	// prompt is not, because a stage hands over a task every time it runs.
	intro string
	// returnPrompt replaces prompt when the conversation is *resumed*: the card
	// came back to this node, and the conversation already knows its task — what
	// it does not know is why it is back, which is what this carries (the
	// trigger, and what the stage it returned from reported). Empty resumes
	// deliver prompt as before.
	returnPrompt string
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

	// A conversation that is starting opens with what the card says (cardIntro);
	// one that is being continued opens with nothing, because it was told a
	// while ago and repeating it would read as a new instruction. A stage
	// resuming after the card came back says only what is new — why it is back
	// and what the previous stage reported — for the same reason.
	if !resume && spec.prompt == "" {
		spec.prompt = spec.intro
	}
	if resume && spec.returnPrompt != "" {
		spec.prompt = spec.returnPrompt
	}

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
		ColumnName:  spec.columnName,
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
	// A caller that already worked out where this runs outranks everything: a
	// stage was handed its session's workspace, and a card's own conversation
	// was told to stand beside the work rather than claim any (talkingPlace).
	// Nothing is claimed here, so no branch appears because somebody opened a
	// terminal.
	case spec.cwd != "":
		t.Cwd, t.Branch = spec.cwd, spec.branch
		t.worktree = WorktreeInfo{Path: spec.cwd, Branch: spec.branch}
	case resume:
		t.Cwd = resumeAt.Cwd
		t.Branch = resumeAt.Branch
		// The worktree is the earlier terminal's; this one is a visitor and
		// must not remove it on the way out.
		t.worktree = WorktreeInfo{Path: resumeAt.Cwd, Branch: resumeAt.Branch}
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
			Agent:   &spec.agent,
			Task:    spec.task,
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

	// The same conversation continued, so what it was called and what it was
	// about come with it: a name a person typed must not be replaced by the
	// card's title the next time the terminal opens. Outside the switch above
	// because a resumed conversation may still have been told where to run.
	if resume {
		if resumeAt.Title != "" {
			t.Title = resumeAt.Title
		}
		t.summary = resumeAt.Summary
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
		ID: id, CardID: t.CardID, NodeID: t.NodeID, ColumnName: t.ColumnName, BoardID: t.BoardID,
		Title: t.Title, WorkdirPath: t.WorkdirPath, Cwd: t.Cwd, Branch: t.Branch,
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
	// is what the card was rescued from — and a conversation somebody deleted
	// reports nothing at all, since the record it would point at is going too.
	if t.CardID != "" && !t.stage && !t.isDiscarded() {
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

// DeleteCardConversation throws one node's conversation away: the CLI in it is
// ended and the record goes with it, so the next conversation on that node
// opens on a blank screen instead of continuing this one.
//
// It is the only way a conversation ends for good — everything about a terminal
// is kept on purpose, which is the whole of what makes «продолжить» possible —
// so somebody whose conversation went somewhere useless has nothing else to do
// about it. The one refusal is a stage the route is running right now: the
// route opened it and is waiting on it, and a card standing on a stage whose
// CLI was taken out from under it is a stall nobody asked for.
func (m *Manager) DeleteCardConversation(cardID, nodeID string) error {
	if strings.TrimSpace(cardID) == "" {
		return fmt.Errorf("не сказано, у какой карточки удалить разговор")
	}
	if live := m.TerminalForCardNode(cardID, nodeID); live != nil {
		if live.isStage() {
			return fmt.Errorf("это разговор работающей стадии маршрута — его ведёт маршрут")
		}
		live.mu.Lock()
		live.discarded = true
		live.mu.Unlock()
		if err := m.CloseTerminal(live.ID); err != nil {
			return err
		}
	}
	if err := m.store.DeleteTerminalsForCardNode(cardID, nodeID); err != nil {
		return fmt.Errorf("не удалось забыть разговор: %w", err)
	}
	m.log.Info("acp: conversation discarded", "card", cardID, "node", nodeID)
	return nil
}

// AskTerminalName types the one message this app ever puts into a conversation
// somebody else is having: «назови этот разговор».
//
// It is worth the intrusion because nothing else can answer it. A terminal is a
// vendor CLI in a pty, so no protocol carries a name for what is happening in
// it, and until the agent says so a row in the list reads «клаус · черновики
// доски» — which is true of every other row too. The agent knows: it is the one
// having the conversation. So it is asked, in the conversation, and it answers
// through the tool it already has (name_conversation) rather than into the
// screen, where nothing of ours could read it.
//
// The ask waits for the CLI to go quiet before it is typed (deliverPrompt), so
// it lands between turns rather than in the middle of one.
func (m *Manager) AskTerminalName(terminalID string) error {
	t := m.Terminal(terminalID)
	if t == nil {
		return fmt.Errorf("терминал уже завершён")
	}
	if !t.Info().Tools {
		return fmt.Errorf("этому CLI не передаются инструменты доски — ответить названием ему нечем")
	}
	go t.deliverPrompt(namingAsk)
	return nil
}

// namingAsk is that message. English, like everything the system says to an
// agent, with the answer's language asked for separately: the app is used in
// more than one, and the name belongs to the conversation rather than to us.
const namingAsk = "Name this conversation: call the board tool name_conversation with a short title, " +
	"three to five words, saying what we are doing here. Write the title in the language we are talking in. " +
	"Do nothing else."

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
	// Acked is a wait a person has already seen — waved away, or opened. It is
	// still a wait: the card keeps its amber button, because that is part of the
	// card. What it stops is the notification, which interrupts (attentionack.go).
	Acked bool `json:"acked,omitempty"`
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
	// Stamped here rather than stored on the record: an ack is dropped by the
	// terminal drawing something, and a copy taken when the wait was raised
	// would say the opposite of what is true now (attentionack.go).
	for i := range out {
		out[i].Acked = m.ackStanding(out[i].Key)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Since < out[j].Since })
	return out
}

func (m *Manager) emitAttentionRecord(a Attention) {
	if m == nil {
		return
	}
	a = a.withKey()
	a.Acked = a.Awaiting && m.ackStanding(a.Key)
	if m.ui == nil {
		return
	}
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
		"acked":      a.Acked,
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

// CardConversation is one node's conversation as the card's panel lists them:
// which column, who spoke there, whether it is running, and whether the card
// is standing on it — the one the panel opens.
type CardConversation struct {
	NodeID string `json:"nodeId,omitempty"`
	Column string `json:"column,omitempty"`
	// NoColumn marks the conversation of a card that had no column when it was
	// held (nodeNone). A flag rather than a name, because what it is called is
	// the screen's business and the screen is in Russian.
	NoColumn   bool   `json:"noColumn,omitempty"`
	Agent      string `json:"agent,omitempty"`
	Running    bool   `json:"running,omitempty"`
	Current    bool   `json:"current,omitempty"`
	TerminalID string `json:"terminalId,omitempty"` // set while running
	StartedAt  string `json:"startedAt,omitempty"`
	EndedAt    string `json:"endedAt,omitempty"`
	ExitCode   int    `json:"exitCode,omitempty"`
	// Stage says a route is running this conversation right now — the one row
	// that cannot be deleted, since the route is waiting on it.
	Stage bool `json:"stage,omitempty"`

	// What the row says about itself, so the card's panel reads like the list of
	// open terminals rather than like a row of stage labels: what the
	// conversation is called (a person's name for it, or the agent's own), the
	// line the agent wrote about what is going on in it, and where it is
	// happening. A live conversation answers for itself — a title and a recap
	// both change while somebody is looking at them.
	Title       string `json:"title,omitempty"`
	Summary     string `json:"summary,omitempty"`
	Folder      string `json:"folder,omitempty"`
	BoardFolder bool   `json:"boardFolder,omitempty"`
	// Tools says the CLI in it can be asked to name the conversation.
	Tools bool `json:"tools,omitempty"`
}

// CardConversations lists the card's conversations, one per node it has stood
// on: the current node's first — synthesized when nothing has been said there
// yet, because it is the one the panel opens — then the others, newest first.
func (m *Manager) CardConversations(cardID string) []CardConversation {
	recs, err := m.store.TerminalsForCard(cardID)
	if err != nil {
		m.log.Warn("acp: cannot read the card's terminals", "card", cardID, "err", err)
		return nil
	}
	// The card itself answers two questions the records cannot: which node it
	// stands on now, and what it is called — so a conversation nobody has named
	// is not named after it (every terminal starts out titled with the card's
	// title, and a list where every row says the same thing is a list of one
	// thing repeated).
	var place cardPlace
	var cardTitle string
	if m.reader != nil {
		ctx, cancel := context.WithTimeout(m.rootCtx, 5*time.Second)
		if ev, err := m.reader.CardByID(ctx, cardID); err == nil {
			place = m.cardPlace(ev)
			cardTitle = ev.Title
		}
		cancel()
	}
	columns := m.stageColumns(cardID)
	columnOf := func(node, recorded string) string {
		// The route's own name for the node wins — it survives renames — then
		// what the record froze, then what the card shows for the node it is
		// standing on.
		if name := columns[node]; name != "" {
			return name
		}
		if recorded != "" {
			return recorded
		}
		if node == place.node {
			return place.column
		}
		return ""
	}

	out := make([]CardConversation, 0, len(recs)+1)
	for _, rec := range recs {
		c := CardConversation{
			NodeID:      rec.NodeID,
			Column:      columnOf(rec.NodeID, rec.ColumnName),
			NoColumn:    rec.NodeID == nodeNone,
			Agent:       rec.Agent,
			Title:       conversationTitle(rec.Title, cardTitle),
			Summary:     rec.Summary,
			Folder:      m.folderLabel(rec.WorkdirPath),
			BoardFolder: rec.WorkdirPath == "",
			Current:     rec.NodeID == place.node,
			StartedAt:   rec.StartedAt.Format(time.RFC3339),
			ExitCode:    rec.ExitCode,
		}
		if rec.EndedAt != nil {
			c.EndedAt = rec.EndedAt.Format(time.RFC3339)
		}
		if live := m.TerminalForCardNode(cardID, rec.NodeID); live != nil {
			info := live.Info()
			c.Running = true
			c.TerminalID = info.ID
			c.Agent = info.Agent
			c.Title = conversationTitle(info.Title, cardTitle)
			c.Summary = info.Summary
			c.Tools = info.Tools
			c.Stage = live.isStage()
		}
		out = append(out, c)
	}

	// The current node's row exists even before anybody has spoken there: it is
	// what a click opens, and a card that moved to «Ревью» five seconds ago has
	// a place to talk about the review.
	sort.SliceStable(out, func(i, j int) bool { return out[i].Current && !out[j].Current })
	if place.node != "" && (len(out) == 0 || !out[0].Current) {
		out = append([]CardConversation{{
			NodeID:   place.node,
			Column:   place.column,
			NoColumn: place.node == nodeNone,
			Current:  true,
		}}, out...)
	}
	return out
}

// conversationTitle is the name a row carries, and the card's own title is not
// one: a terminal starts out titled after its card, so keeping that would name
// every row of the list after the card it is on. What is left is a name
// somebody gave — a person through RenameTerminal, or the agent through
// name_conversation — and where there is none the screen says what the
// conversation *is*: «Обсуждение», or the column of its stage.
func conversationTitle(title, cardTitle string) string {
	if cardTitle != "" && strings.TrimSpace(title) == strings.TrimSpace(cardTitle) {
		return ""
	}
	return title
}

// folderLabel is what a conversation's folder is called on screen: the name it
// was registered under, since that is the name the person answered «в какой
// папке» with. A path with no entry behind it — a folder somebody has since
// removed from the registry — is named by its last element, and an empty path
// is «черновики доски», which the caller says with BoardFolder instead.
func (m *Manager) folderLabel(workdirPath string) string {
	if workdirPath == "" {
		return ""
	}
	if entry, ok := m.WorkdirAt(workdirPath); ok {
		return entry.Name
	}
	return filepath.Base(workdirPath)
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
