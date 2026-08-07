// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package acp

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/aymanbagabas/go-pty"
	"github.com/google/uuid"
)

// A terminal session is the agent's own CLI, running in a pseudo-terminal in
// the card's working directory — the same thing a developer would open a shell
// and type, with the project, the worktree, the branch and the agent's
// environment already set up.
//
// It is deliberately *not* an ACP session: an ACP agent speaks JSON-RPC on
// stdio and has no terminal UI, so a session cannot be both. What the two share
// is everything around them — which project a card is about, which agent
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

// terminalQuietFor is how long a CLI has to print nothing before we say it is
// waiting for the person.
//
// There is nothing better to go on: what runs in the pty is a TUI, not a
// protocol, so what it wants is only ever visible on the screen. But the shape
// of the output says it anyway — an agent that is working prints continuously
// (a spinner, tool output, tokens as they arrive), and an agent that has asked
// something and stopped prints nothing at all until a key is pressed. Five
// seconds is longer than any gap between spinner frames and shorter than the
// patience of somebody waiting to be asked.
const terminalQuietFor = 5 * time.Second

// TerminalSession is one CLI in one pty.
type TerminalSession struct {
	ID          string
	CardID      string
	BoardID     string
	Title       string
	Task        string
	ProjectPath string
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
	// The board tools this CLI was given: a grant token and the config file
	// that carries it. Both die with the terminal — a door nobody is standing
	// in must not stay open.
	boardToken string
	mcpConfig  string

	mu      sync.Mutex
	buf     []byte
	subs    map[int]chan []byte
	nextSub int
	closed  bool
	// The three fields the "waiting for a person" signal is made of: when the
	// pty last moved in either direction, whether the CLI has ever printed
	// anything (a process that has not started drawing yet is not waiting), and
	// since when we have been saying it waits.
	lastActivity  time.Time
	spoke         bool
	awaitingSince time.Time
	quietFor      time.Duration

	done     chan struct{}
	exitCode int
	exitErr  error
}

// TerminalInfo is what the UI is told about a terminal session.
type TerminalInfo struct {
	ID        string `json:"id"`
	CardID    string `json:"cardId,omitempty"`
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
	// Awaiting says the CLI has gone quiet and the person it is waiting for is
	// the only thing that will move it.
	Awaiting      bool   `json:"awaiting"`
	AwaitingSince string `json:"awaitingSince,omitempty"`
}

// Info describes the session for the window that draws it.
func (t *TerminalSession) Info() TerminalInfo {
	t.mu.Lock()
	defer t.mu.Unlock()
	info := TerminalInfo{
		ID:        t.ID,
		CardID:    t.CardID,
		Title:     t.Title,
		Task:      t.Task,
		Cwd:       t.Cwd,
		Branch:    t.Branch,
		Agent:     t.AgentName,
		Kind:      t.AgentKind,
		Command:   strings.Join(t.Argv, " "),
		StartedAt: t.StartedAt.Format(time.RFC3339),
		ExitCode:  t.exitCode,
	}
	select {
	case <-t.done:
	default:
		info.Running = true
	}
	if info.Running && !t.awaitingSince.IsZero() {
		info.Awaiting = true
		info.AwaitingSince = t.awaitingSince.Format(time.RFC3339)
	}
	return info
}

// Awaiting reports whether the CLI is currently waiting for the person.
func (t *TerminalSession) Awaiting() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return !t.awaitingSince.IsZero()
}

// noteActivity records that the pty moved and answers whether that ended a wait
// — the caller emits, because it must not do so holding the lock.
func (t *TerminalSession) noteActivity(spoke bool) (ended bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.lastActivity = time.Now()
	t.spoke = t.spoke || spoke
	if t.awaitingSince.IsZero() {
		return false
	}
	t.awaitingSince = time.Time{}
	return true
}

// watchAttention turns silence into the one thing a card can say about a
// terminal without a person looking at it: this one is waiting for you.
func (t *TerminalSession) watchAttention() {
	quiet := t.quietFor
	if quiet <= 0 {
		quiet = terminalQuietFor
	}
	// A tick finer than the threshold, so "waiting since" is close to when the
	// CLI actually stopped rather than up to a whole threshold late.
	tick := time.NewTicker(quiet / 4)
	defer tick.Stop()
	for {
		select {
		case <-t.done:
			// Nothing waits for a CLI that has exited; the card says what it
			// left behind instead.
			if t.noteActivity(false) {
				t.m.emitAttention(t)
			}
			return
		case now := <-tick.C:
			t.mu.Lock()
			began := t.spoke && t.awaitingSince.IsZero() && now.Sub(t.lastActivity) >= quiet
			if began {
				t.awaitingSince = t.lastActivity.Add(quiet)
			}
			t.mu.Unlock()
			if began {
				t.m.emitAttention(t)
			}
		}
	}
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
	// Somebody is typing, so nothing is waiting for them any more — said before
	// the write, because the answer to a prompt is often what makes the CLI go
	// quiet again for a while.
	if t.noteActivity(false) {
		t.m.emitAttention(t)
	}
	_, err := t.tty.Write(p)
	return err
}

// Resize tells the CLI how big the window is, which is what makes a TUI draw
// itself correctly rather than wrapping at 80 columns.
func (t *TerminalSession) Resize(cols, rows int) error {
	if cols <= 0 || rows <= 0 {
		return nil
	}
	return t.tty.Resize(cols, rows)
}

// Done is closed when the CLI exits.
func (t *TerminalSession) Done() <-chan struct{} { return t.done }

// publish fans one chunk of output out to every window and keeps a copy.
func (t *TerminalSession) publish(chunk []byte) {
	if t.noteActivity(true) {
		t.m.emitAttention(t)
	}
	t.mu.Lock()
	defer t.mu.Unlock()
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

// StartCardTerminal opens the agent's CLI on a card: same project, same
// worktree rules and same agent as a session on that card would get.
// projectName/agentName override what the card says, for the case where it says
// nothing.
func (m *Manager) StartCardTerminal(cardID, projectName, agentName string) (*TerminalSession, error) {
	if m.reader == nil {
		return nil, fmt.Errorf("чтение карточек недоступно")
	}
	if live := m.TerminalForCard(cardID); live != nil {
		return live, nil
	}
	ctx, cancel := context.WithTimeout(m.rootCtx, 10*time.Second)
	defer cancel()
	ev, err := m.reader.CardByID(ctx, cardID)
	if err != nil {
		return nil, fmt.Errorf("не удалось прочитать карточку: %w", err)
	}

	projectPath, err := m.resolveProject(ev)
	if projectName != "" {
		projectPath, err = m.resolveNamedProject(projectName)
	}
	if err != nil {
		return nil, err
	}
	agent := AgentEntry{}
	if strings.TrimSpace(agentName) != "" {
		agent, err = m.planningAgent(agentName)
	} else {
		// The same resolution a session on this card would go through: the
		// card's own agent property, its assignee, a select option, the single
		// registered agent.
		agent, err = m.resolveAgent(ev)
	}
	if err != nil {
		return nil, err
	}
	return m.startTerminal(terminalSpec{
		cardID:      ev.CardID,
		boardID:     ev.BoardID,
		title:       ev.Title,
		task:        ev.Body,
		projectPath: projectPath,
		base:        ev.Props["branch"],
		agent:       agent,
		// A project that is not under git has no worktrees to give, and a
		// terminal in one is a terminal in the folder itself.
		worktree: m.cfg.UseWorktrees() && IsGitProject(m.rootCtx, projectPath),
	})
}

// StartPlanningTerminal opens the CLI with no card behind it — the terminal
// half of "Plan a task". It runs in the project itself and never creates a
// branch: there is nothing yet to put on one.
func (m *Manager) StartPlanningTerminal(projectName, agentName, boardID string) (*TerminalSession, error) {
	project, err := m.planningRepo(projectName)
	if err != nil {
		return nil, err
	}
	agent, err := m.planningAgent(agentName)
	if err != nil {
		return nil, err
	}
	if project.Path == "" {
		return nil, fmt.Errorf("для терминала нужен проект: выберите его в списке")
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
		task:        planningPrompt(m.SystemPrompt(), m.PlanningPrompt(), agent, project),
		projectPath: project.Path,
		agent:       agent,
		worktree:    false,
	})
}

// terminalSpec is everything startTerminal needs, resolved by the caller.
type terminalSpec struct {
	cardID string
	// boardID is also the board this terminal may write to through the board
	// tools. A card's terminal has its card's board; planning has the board it
	// was opened from, which is the only reason that dialog knows about one.
	boardID     string
	title       string
	task        string
	projectPath string
	base        string
	agent       AgentEntry
	worktree    bool
}

func (m *Manager) startTerminal(spec terminalSpec) (*TerminalSession, error) {
	// A card whose terminal was open before goes back to the same directory and
	// asks the CLI to continue the conversation it left there. That is the
	// whole of "resume": the worktree is the card's, so the newest conversation
	// in it is the card's too, and no session id of somebody else's has to be
	// stored or guessed.
	resumeAt, resume := m.terminalResumePoint(spec)

	// The board tools: a terminal that stands on a board can hand work back to
	// it rather than leaving a person to retype the plan (boardtools.go). A
	// kind whose CLI cannot be told about MCP gets none, and the terminal opens
	// exactly as it did before.
	boardToken, mcpConfig := m.openBoardTools(spec.boardID, spec.agent)

	argv, err := terminalCommand(spec.agent, resume, mcpConfig)
	if err != nil {
		m.closeBoardTools(boardToken, mcpConfig)
		return nil, err
	}
	if _, err := exec.LookPath(argv[0]); err != nil {
		m.closeBoardTools(boardToken, mcpConfig)
		return nil, fmt.Errorf("не найден %s — CLI агента %q не установлен", argv[0], spec.agent.Name)
	}
	net, err := m.resolveNetwork(spec.agent)
	if err != nil {
		m.closeBoardTools(boardToken, mcpConfig)
		return nil, err
	}

	id := uuid.NewString()
	t := &TerminalSession{
		ID:           id,
		CardID:       spec.cardID,
		BoardID:      spec.boardID,
		Title:        spec.title,
		Task:         spec.task,
		ProjectPath:  spec.projectPath,
		Cwd:          spec.projectPath,
		AgentName:    spec.agent.Name,
		AgentKind:    spec.agent.Kind,
		Argv:         argv,
		StartedAt:    time.Now(),
		m:            m,
		done:         make(chan struct{}),
		lastActivity: time.Now(),
		quietFor:     m.terminalQuiet,
		boardToken:   boardToken,
		mcpConfig:    mcpConfig,
	}

	switch {
	case resume:
		t.Cwd = resumeAt.Cwd
		t.Branch = resumeAt.Branch
		// The worktree is the earlier terminal's; this one is a visitor and
		// must not remove it on the way out.
		t.worktree = WorktreeInfo{Path: resumeAt.Cwd, Branch: resumeAt.Branch}
	// A terminal gets a worktree for the same reason a session does: two of
	// them, or a terminal beside a running session, must not share one checkout.
	case spec.worktree && spec.cardID != "":
		wt, err := CreateWorktree(m.rootCtx, spec.projectPath, spec.base, spec.title, spec.cardID, id, m.cfg.WorktreeDir)
		if err != nil {
			return nil, fmt.Errorf("не удалось создать git worktree: %w", err)
		}
		t.worktree = wt
		t.usedWorktree = true
		t.Cwd = wt.Path
		t.Branch = wt.Branch
	}
	t.startSHA = headSHA(m.rootCtx, t.Cwd)

	tty, err := pty.New()
	if err != nil {
		m.releaseTerminalWorktree(t)
		return nil, fmt.Errorf("не удалось открыть pty: %w", err)
	}
	t.tty = tty

	cmd := tty.CommandContext(m.rootCtx, argv[0], argv[1:]...)
	cmd.Dir = t.Cwd
	env, drop := spawnEnv(spec.agent, net)
	cmd.Env = terminalEnv(env, drop)
	if err := cmd.Start(); err != nil {
		_ = tty.Close()
		m.releaseTerminalWorktree(t)
		return nil, fmt.Errorf("не удалось запустить %s: %w", argv[0], err)
	}
	t.cmd = cmd

	m.mu.Lock()
	if m.terminals == nil {
		m.terminals = map[string]*TerminalSession{}
	}
	m.terminals[id] = t
	m.mu.Unlock()

	// Recorded even for a planning terminal, so "where was I" survives the app
	// being closed — which is the only reason a terminal can be resumed at all.
	if err := m.store.InsertTerminal(TerminalRecord{
		ID: id, CardID: t.CardID, BoardID: t.BoardID, Title: t.Title,
		ProjectPath: t.ProjectPath, Cwd: t.Cwd, Branch: t.Branch,
		Agent: t.AgentName, Kind: t.AgentKind, StartedAt: t.StartedAt,
	}); err != nil {
		m.log.Warn("acp: failed to record terminal session", "terminal", id, "err", err)
	}

	m.log.Info("acp: terminal started", "terminal", id, "card", t.CardID, "agent", t.AgentName, "cwd", t.Cwd)
	m.emitTerminal(t)
	if t.CardID != "" {
		where := t.Cwd
		if t.Branch != "" {
			where = fmt.Sprintf("%s\nВетка: `%s`", t.Cwd, t.Branch)
		}
		m.commentCard(t.CardID, fmt.Sprintf("Открыт терминал агента %s (`%s`).\nКаталог: `%s`", t.AgentName, strings.Join(argv, " "), where))
	}

	go t.pump()
	go t.watchAttention()
	return t, nil
}

// pump moves the CLI's output to every window until the process exits.
func (t *TerminalSession) pump() {
	buf := make([]byte, 32*1024)
	for {
		n, err := t.tty.Read(buf)
		if n > 0 {
			t.publish(buf[:n])
		}
		if err != nil {
			break
		}
	}
	waitErr := t.cmd.Wait()
	t.exitErr = waitErr
	if t.cmd.ProcessState != nil {
		t.exitCode = t.cmd.ProcessState.ExitCode()
	}
	close(t.done)
	t.finish()
	_ = t.tty.Close()
	t.m.terminalEnded(t)
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
	if t.CardID != "" {
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
	removed, err := RemoveWorktreeIfClean(m.rootCtx, t.ProjectPath, t.worktree)
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

// TerminalForCard returns the card's live terminal session, if it has one.
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

// planningTerminal is the live card-less terminal for this project and
// agent, if one is open.
func (m *Manager) planningTerminal(projectPath, agentName string) *TerminalSession {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, t := range m.terminals {
		if t.CardID == "" && t.ProjectPath == projectPath && t.AgentName == agentName {
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

// CloseTerminal ends the CLI and everything it started.
func (m *Manager) CloseTerminal(id string) error {
	t := m.Terminal(id)
	if t == nil {
		return fmt.Errorf("терминал %s не активен", id)
	}
	if t.cmd != nil && t.cmd.Process != nil {
		_ = t.cmd.Process.Kill()
	}
	return t.tty.Close()
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
		if t.cmd != nil && t.cmd.Process != nil {
			_ = t.cmd.Process.Kill()
		}
		_ = t.tty.Close()
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

// The two reasons, and they are answered in different places.
//
// AttentionQuestion is the protocol asking: an ACP session sent
// session/request_permission or an elicitation, and the agent is waiting on the
// answer with its turn still open (question.go). It is answered on the card.
//
// AttentionQuiet is a terminal, where there is no protocol to ask through — an
// agent CLI in a pty draws a TUI, so silence is the only signal
// (terminalQuietFor). It is answered by typing in that window.
const (
	AttentionQuestion = "question"
	AttentionQuiet    = "quiet"
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

// attention describes the session the way the UI wants it.
func (t *TerminalSession) attention() Attention {
	info := t.Info()
	return Attention{
		TerminalID: info.ID,
		CardID:     info.CardID,
		BoardID:    t.BoardID,
		Title:      info.Title,
		Agent:      info.Agent,
		Reason:     AttentionQuiet,
		Awaiting:   info.Awaiting,
		Since:      info.AwaitingSince,
	}
}

// Attention lists everything currently waiting for a person, oldest wait first:
// the one that has been ignored longest is the one worth showing.
func (m *Manager) Attention() []Attention {
	m.mu.Lock()
	live := make([]*TerminalSession, 0, len(m.terminals))
	for _, t := range m.terminals {
		live = append(live, t)
	}
	m.mu.Unlock()

	out := make([]Attention, 0, len(live))
	for _, t := range live {
		if a := t.attention(); a.Awaiting {
			out = append(out, a.withKey())
		}
	}

	for _, q := range m.Questions() {
		out = append(out, q.attention().withKey())
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Since < out[j].Since })
	return out
}

// emitAttention tells the UI that a terminal started or stopped waiting for a
// person, so a card can show it without polling.
func (m *Manager) emitAttention(t *TerminalSession) {
	if m == nil {
		return
	}
	m.emitAttentionRecord(t.attention())
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

// terminalEnv applies spawnEnv's result to the current environment: drop first,
// then add, so an agent's own value wins over an inherited one exactly as it
// does for an ACP session.
func terminalEnv(add []string, drop []string) []string {
	dropped := make(map[string]bool, len(drop))
	for _, name := range drop {
		dropped[name] = true
	}
	env := make([]string, 0, len(add)+32)
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
	rec, ok, err := m.store.LastTerminalForCard(spec.cardID)
	if err != nil {
		m.log.Warn("acp: failed to read the card's last terminal", "card", spec.cardID, "err", err)
		return TerminalRecord{}, false
	}
	if !ok || rec.Cwd == "" || rec.ProjectPath != spec.projectPath {
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
	if rec.EndedAt != nil {
		out.EndedAt = rec.EndedAt.Format(time.RFC3339)
	}
	return out
}
