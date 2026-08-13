package acp

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// A stage of a route is the agent's own CLI, in the card's terminal.
//
// It used to be an ACP session: an adapter on stdio, its questions lifted out of
// the protocol and drawn by us over the terminal — with a second CLI sitting in
// that terminal, in the same worktree, knowing nothing about the first. Two
// agents in one copy of the code, and a question about the card answered in a
// box that hid the window it was drawn on.
//
// So the terminal *is* the stage. The card's task goes to the CLI the way a
// person would give it (terminalCommand, deliverPrompt), and everything the CLI
// draws — its plan, its questions, its permission prompts — is drawn by the CLI,
// in its own screen, with nothing of ours over it. Which is the whole of what
// this buys: an agent asks the way its vendor built it to ask, and we stop
// re-implementing a TUI badly.
//
// Two things had to be answered for that to work. **How the route learns the
// stage is over**: the agent says so through the board tools (finish_work), the
// same channel it already uses to move cards — a CLI exit cannot stand in for
// it, because an interactive CLI does not exit when a turn ends. And **how a
// card that is stuck is noticed**: the CLI draws nothing while it waits, which
// is the signal AttentionTerminal is built on.
//
// A deploy and a test are still ACP sessions. Nobody watches them, their verdict
// is read by the machine rather than by a person, and there is no terminal for
// anybody to answer in.

// terminalQuietFor is how long a stage's CLI must draw nothing before the card
// says it is waiting for a person. Generous: a model thinking between tool calls
// can be silent for a while, and a card that cries out early is a card nobody
// believes.
const terminalQuietFor = 45 * time.Second

// stageGrace is how long the CLI is left alone after it reports. The report is a
// tool call, and killing the process that made it before its result is delivered
// is how an agent ends its turn on a broken pipe.
const stageGrace = 3 * time.Second

// stageReport is what an agent hands back through finish_work: whether the work
// is done, and what it did.
type stageReport struct {
	ok      bool
	summary string
}

// stageRunsInTerminal reports whether this agent can work a stage in a terminal
// at all. Three things are needed, and an agent missing any of them keeps the
// old arrangement — an ACP session — rather than a stage that could never run
// or never end.
//
// A way to hand the CLI the board tools, because a stage that cannot call
// finish_work would stand there for ever: that rules out an entry which replaced
// its terminal argv outright, since a wrapper's flags are not ours to guess.
// An interactive CLI at all: the generic acp kind is an adapter on stdio and has
// no interface to draw in a pty. And that CLI actually installed here — the
// claude adapter embeds the CLI it drives, so a machine can perfectly well run
// sessions of that kind with no `claude` on it, and a stage must not fail on a
// binary the session never needed.
func stageRunsInTerminal(a AgentEntry) bool {
	if !terminalTakesMCP(a) {
		return false
	}
	argv, _, err := terminalCommand(a, false, "", "")
	if err != nil || len(argv) == 0 {
		return false
	}
	_, err = lookupBin(argv[0], "")
	return err == nil
}

// runCardTaskInTerminal runs the card's task as a conversation in a terminal and
// waits for the agent to say what became of it.
func (m *Manager) runCardTaskInTerminal(s *Session) {
	t, err := m.startStageTerminal(s)
	if err != nil {
		m.finishSession(s, StatusFailed, err.Error())
		m.comment(s, failComment(s, err.Error()))
		return
	}

	reports := m.awaitStage(t.ID)
	defer m.forgetStage(t.ID)

	// The session's own cancel, which is what dragging the card out of the
	// column reaches (CancelSessionForCard). There is no turn to interrupt here
	// — the CLI is a process, not a protocol — so cancelling ends the
	// conversation the stage started.
	ctx, cancel := context.WithCancel(m.rootCtx)
	defer cancel()
	s.mu.Lock()
	s.turnCancel = cancel
	pending := s.cancelPending
	s.cancelPending = false
	s.status = StatusRunning
	s.mu.Unlock()
	m.persistStatus(s, StatusRunning, "")
	if pending {
		cancel()
	}

	watching := make(chan struct{})
	go m.watchStageQuiet(s, t, watching)

	var report stageReport
	var reported bool
	select {
	case report = <-reports:
		reported = true
	case <-t.Done():
	case <-ctx.Done():
	}
	close(watching)

	switch {
	case reported:
		m.closeStageTerminal(t)
		s.setFinalText(report.summary)
		if report.ok {
			m.finishSession(s, StatusDone, "")
		} else {
			m.finishSession(s, StatusFailed, "агент не смог закончить работу")
		}
		m.commentCard(s.CardID, stageComment(m.rootCtx, t, report))
	case ctx.Err() != nil && m.rootCtx.Err() == nil:
		// Somebody took the card back. The conversation goes with the stage:
		// leaving the CLI running would leave an agent working on a card that is
		// no longer here.
		m.closeStageTerminal(t)
		m.finishSession(s, StatusCancelled, "сессия отменена")
	case m.rootCtx.Err() != nil:
		m.finishSession(s, StatusCancelled, "приложение завершается")
	default:
		// The CLI is gone and never said what it did. That is not a failed
		// stage — a person may simply have closed the window — so the card keeps
		// its place on the route and says why it is standing there.
		m.finishSession(s, StatusCancelled, "терминал закрыт без ответа")
		m.stallCard(s.CardID, s.FlowNodeID,
			fmt.Sprintf("терминал агента %s закрыт, а о результате работы не сказано — откройте терминал и доведите стадию до конца", t.AgentName))
		m.commentCard(s.CardID, stageComment(m.rootCtx, t, stageReport{}))
	}
}

// startStageTerminal opens the conversation this stage is. A person may already
// have the card's terminal for this stage open — that *is* this conversation, so
// the task goes into it rather than into a second CLI beside it.
func (m *Manager) startStageTerminal(s *Session) (*TerminalSession, error) {
	if live := m.TerminalForCardNode(s.CardID, s.FlowNodeID); live != nil {
		go live.deliverPrompt(s.PromptText)
		return live, nil
	}
	return m.startTerminal(terminalSpec{
		cardID:      s.CardID,
		nodeID:      s.FlowNodeID,
		boardID:     s.BoardID,
		title:       s.Title,
		task:        s.PromptText,
		workdirPath: s.WorkdirPath,
		base:        s.BaseBranch,
		agent:       s.Agent,
		// The session has already worked out where this stage runs — the card's
		// workspace, or the folder itself when the stage says so — so the
		// terminal is told rather than left to claim one of its own.
		cwd:    s.Worktree.Path,
		branch: s.Worktree.Branch,
		prompt: s.PromptText,
		stage:  true,
	})
}

// closeStageTerminal ends the conversation once the stage is over, after the
// grace the report needs to reach the agent.
func (m *Manager) closeStageTerminal(t *TerminalSession) {
	select {
	case <-t.Done():
		return
	case <-time.After(stageGrace):
	}
	if err := m.CloseTerminal(t.ID); err != nil {
		m.log.Warn("acp: could not close the stage's terminal", "terminal", t.ID, "err", err)
	}
	// Waited for, not assumed: the worktree is folded away right after this, and
	// FoldWorktree refuses a directory a CLI is still running in.
	select {
	case <-t.Done():
	case <-time.After(10 * time.Second):
	}
}

// awaitStage registers the channel finish_work delivers on, keyed by the
// conversation the grant names.
func (m *Manager) awaitStage(terminalID string) chan stageReport {
	ch := make(chan stageReport, 1)
	m.stageMu.Lock()
	defer m.stageMu.Unlock()
	if m.stageWaits == nil {
		m.stageWaits = map[string]chan stageReport{}
	}
	m.stageWaits[terminalID] = ch
	return ch
}

func (m *Manager) forgetStage(terminalID string) {
	m.stageMu.Lock()
	defer m.stageMu.Unlock()
	delete(m.stageWaits, terminalID)
	delete(m.stageWaiting, terminalID)
}

// FinishWorkFromTools is the agent saying the stage is over. It is the one thing
// a route cannot find out for itself: an interactive CLI does not exit when a
// turn ends, and a person typing in the same terminal afterwards is the ordinary
// case rather than a signal.
func (m *Manager) FinishWorkFromTools(token string, ok bool, summary string) error {
	g, found := m.boardGrant(token)
	if !found {
		return fmt.Errorf("нет доступа к доске")
	}
	m.stageMu.Lock()
	ch := m.stageWaits[g.TerminalID]
	m.stageMu.Unlock()
	if ch == nil {
		return fmt.Errorf("этот разговор — не стадия маршрута: сказать здесь «работа закончена» некому, переложите карточку через move_card")
	}
	select {
	case ch <- stageReport{ok: ok, summary: strings.TrimSpace(summary)}:
		return nil
	default:
		return fmt.Errorf("об окончании работы уже сказано")
	}
}

// watchStageQuiet raises the card while the stage's CLI is drawing nothing, and
// lowers it again the moment it draws something. See AttentionTerminal for why
// silence means what it means here and did not before.
func (m *Manager) watchStageQuiet(s *Session, t *TerminalSession, stop <-chan struct{}) {
	quiet := m.terminalQuiet
	if quiet <= 0 {
		quiet = terminalQuietFor
	}
	tick := time.NewTicker(quiet / 5)
	defer tick.Stop()

	waiting := false
	defer func() {
		if waiting {
			m.raiseStageWait(s, t, false)
		}
	}()
	for {
		select {
		case <-stop:
			return
		case <-t.Done():
			return
		case now := <-tick.C:
			if quietNow := t.quietFor(now) >= quiet; quietNow != waiting {
				waiting = quietNow
				m.raiseStageWait(s, t, waiting)
				if waiting {
					m.setStatus(s, StatusWaitingPermission)
				} else {
					m.setStatus(s, StatusRunning)
				}
			}
		}
	}
}

// raiseStageWait records and emits "this card is waiting for a person". It is kept
// as well as emitted, because the socket may reconnect and ask for the whole
// list — and a card waiting to be answered is exactly the wrong thing to lose.
func (m *Manager) raiseStageWait(s *Session, t *TerminalSession, waiting bool) {
	a := Attention{
		TerminalID: t.ID,
		CardID:     s.CardID,
		BoardID:    s.BoardID,
		Title:      s.Title,
		Agent:      s.Agent.Name,
		Reason:     AttentionTerminal,
		Text:       "агент ждёт ответа в терминале",
		Awaiting:   waiting,
		Since:      time.Now().Format(time.RFC3339),
	}
	m.stageMu.Lock()
	if m.stageWaiting == nil {
		m.stageWaiting = map[string]Attention{}
	}
	if waiting {
		m.stageWaiting[t.ID] = a
	} else {
		delete(m.stageWaiting, t.ID)
	}
	m.stageMu.Unlock()
	m.emitAttentionRecord(a)
}

// stageAttention is every stage currently waiting for a person, for the list the
// UI asks for when its socket reconnects.
func (m *Manager) stageAttention() []Attention {
	m.stageMu.Lock()
	defer m.stageMu.Unlock()
	out := make([]Attention, 0, len(m.stageWaiting))
	for _, a := range m.stageWaiting {
		out = append(out, a)
	}
	return out
}

// stageComment is the one thing the card is told about a stage: what the agent
// says it did, and what actually landed on the branch. An empty report is a
// conversation that ended without one.
func stageComment(ctx context.Context, t *TerminalSession, rep stageReport) string {
	var b strings.Builder
	switch {
	case rep.ok:
		b.WriteString("Агент завершил работу.")
	case rep.summary != "":
		b.WriteString("Агент не смог закончить работу.")
	default:
		b.WriteString("Терминал агента закрыт, о результате работы агент не сказал.")
	}
	if rep.summary != "" {
		b.WriteString("\n\n")
		b.WriteString(truncateRunes(rep.summary, 4000))
	}
	if landed := workLanded(ctx, t); landed != "" {
		b.WriteString("\n\n")
		b.WriteString(landed)
	}
	return b.String()
}
