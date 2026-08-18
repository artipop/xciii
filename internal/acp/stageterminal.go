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

// stageStartWindow is how soon after the launch an exit still counts as the CLI
// failing to start rather than as work somebody ended. Wide enough for a login
// prompt or a trust question to be answered by whoever is watching, narrow
// enough that a conversation somebody actually had is never called broken.
const stageStartWindow = 30 * time.Second

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

// stageWait is a running stage as finish_work sees it: where its report lands,
// and which card properties the stage declared it would write — the required
// ones are what the report is refused without.
type stageWait struct {
	ch     chan stageReport
	writes []PropertyWrite
	cardID string
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
	argv, _, err := terminalCommand(a, false, "", "", "")
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

	reports := m.awaitStage(t.ID, s)
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
		// And said on the card, which is the half that was missing: the app
		// closing killed the stage's CLI, the session went to cancelled where
		// only the panel would ever show it, and the next launch had nothing on
		// the board saying this card was in the middle of something. Recorded
		// here rather than at the next startup because this is the one moment
		// that knows *why* — a session found stale on launch could equally be a
		// crash.
		m.stallCardConversation(s.CardID, s.FlowNodeID,
			fmt.Sprintf("работа агента %s прервана: приложение закрылось, а о результате сказано не было — откройте терминал и доведите стадию до конца", t.AgentName))
	default:
		// The CLI is gone and never said what it did, and there are two very
		// different reasons for that.
		if code, broken := t.startupFailure(stageStartWindow); broken {
			// It died on the way up — a flag it did not understand, a folder it
			// would not run in, a missing login. The stage never happened, so
			// this is a failure the route can act on, and the card is told what
			// the CLI said rather than that "the agent did not report": a
			// variadic --mcp-config swallowing the card's task once put every
			// board on that stall message with the actual error visible only in
			// a window that had already closed.
			reason := fmt.Sprintf("CLI агента %s не запустился (код %d)", t.AgentName, code)
			m.finishSession(s, StatusFailed, reason)
			m.comment(s, startupFailComment(t, code))
			return
		}
		// Otherwise a person closed the window, which is not a verdict: the card
		// keeps its place on the route and says why it is standing there.
		m.finishSession(s, StatusCancelled, "терминал закрыт без ответа")
		m.stallCardConversation(s.CardID, s.FlowNodeID,
			fmt.Sprintf("терминал агента %s закрыт, а о результате работы не сказано — откройте терминал и доведите стадию до конца", t.AgentName))
		m.commentCard(s.CardID, stageComment(m.rootCtx, t, stageReport{}))
	}
}

// startStageTerminal opens the conversation this stage is. A person may already
// have the card's terminal for this stage open — that *is* this conversation, so
// the task goes into it rather than into a second CLI beside it.
func (m *Manager) startStageTerminal(s *Session) (*TerminalSession, error) {
	// A conversation already open on this node — a person sat down at the
	// column before the stage started — *is* this conversation: the node model
	// puts them in one place on purpose, so the task is typed into it rather
	// than into a second CLI beside it. The route adopts it: the terminal is a
	// running stage from here on, which is what keeps the bin off its row and
	// the card's comment single (stageComment reports; terminalEnded stays
	// quiet about stages).
	//
	// Only a conversation standing where the stage was told to run, though. A
	// person can open the card's terminal before the card names a folder, and
	// that conversation runs in «черновики доски» — the same node, a different
	// directory. Adopting it typed the task into a CLI sitting in the drafts
	// folder while the route believed the stage was in the card's branch: the
	// branch was made, written on the card and left empty, and finish_work
	// reported work that had landed nowhere.
	//
	// The folder is the test, and the directory too once the session has
	// claimed one — not "is this the drafts folder", because what the stage
	// depends on is that the two are in the same place, whatever that place is.
	if live := m.TerminalForCardNode(s.CardID, s.NodeID); live != nil {
		sameFolder := live.WorkdirPath == s.WorkdirPath
		samePlace := s.Worktree.Path == "" || live.Cwd == s.Worktree.Path
		if sameFolder && samePlace {
			live.mu.Lock()
			live.stage = true
			live.mu.Unlock()
			go live.deliverPrompt(s.PromptText)
			return live, nil
		}
		m.log.Info("acp: the conversation open on this node stands elsewhere, so the stage opens its own",
			"card", s.CardID, "node", s.NodeID, "conversation", live.Cwd, "stage", s.Worktree.Path)
	}
	return m.startTerminal(terminalSpec{
		cardID:      s.CardID,
		nodeID:      s.NodeID,
		columnName:  s.ColumnName,
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
		// The tools this stage comes with, on top of the agent's own: the
		// column's set, or the node's where the route names one.
		mcp: s.StageMCP,
		// Why the card is back, when it is: a resumed conversation knows its
		// task, and what it needs is the delta — see returnBrief.
		returnPrompt: m.returnBrief(s.CardID, s.NodeID),
		stage:        true,
	})
}

// returnBrief is what a stage's conversation is told when the card comes back
// to its node: not the task — the conversation already had it, and a resumed
// CLI reads a repeated brief as a fresh instruction — but why it is back, in
// the words of whatever sent it. The latest arrival on this node carries the
// trigger and, for a stage's own verdict, what that stage reported
// (FlowEventRecord.Said): «ревьюер вернул с такими-то замечаниями» is exactly
// the new input the resumed session works from. Empty when the card has not
// been away, and the resume then delivers the ordinary prompt.
func (m *Manager) returnBrief(cardID, nodeID string) string {
	events, err := m.store.FlowEvents(cardID)
	if err != nil || len(events) == 0 {
		return ""
	}
	var arrival *FlowEventRecord
	for i := len(events) - 1; i >= 0; i-- {
		if events[i].ToNode == nodeID {
			arrival = &events[i]
			break
		}
	}
	if arrival == nil || arrival.FromNode == "" || arrival.FromNode == nodeID {
		return ""
	}
	from := arrival.FromNode
	if flow, ok := m.FlowByID(arrival.FlowID); ok {
		if node, has := flow.Node(from); has {
			from = node.Column
		}
	}
	var b strings.Builder
	fmt.Fprintf(&b, "The card is back on this stage. It went to «%s» and returned: %s.", from, firstNonEmpty(arrival.Detail, TriggerLabel(arrival.On)))
	if said := strings.TrimSpace(arrival.Said); said != "" {
		fmt.Fprintf(&b, "\n\nWhat that stage reported:\n%s", truncateRunes(said, 4000))
	}
	b.WriteString("\n\nThe original task still stands; continue from where this conversation left off.")
	return b.String()
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
// conversation the grant names — with the stage's declared writes, which is
// what the report is checked against.
func (m *Manager) awaitStage(terminalID string, s *Session) chan stageReport {
	ch := make(chan stageReport, 1)
	m.stageMu.Lock()
	defer m.stageMu.Unlock()
	if m.stageWaits == nil {
		m.stageWaits = map[string]stageWait{}
	}
	m.stageWaits[terminalID] = stageWait{ch: ch, writes: s.Writes, cardID: s.CardID}
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
//
// fields are the stage's outputs, written onto the card **here, before the
// report is delivered** — deliberately in this order, twice over. The route
// advances on the report and its edges read the card as it is then, so a value
// an edge branches on has to be standing before the outcome fires. And a write
// the board refuses — a select with no such option, a property the board does
// not have — comes back as this tool call's own error, to the one party that
// can fix the value: the agent. A stage that declared a required write is
// refused without it, which is what makes an edge on that property a
// transition and not a hope.
func (m *Manager) FinishWorkFromTools(token string, ok bool, summary string, fields map[string]string) error {
	g, found := m.boardGrant(token)
	if !found {
		return fmt.Errorf("нет доступа к доске")
	}
	m.stageMu.Lock()
	wait, waiting := m.stageWaits[g.TerminalID]
	m.stageMu.Unlock()
	if !waiting {
		return fmt.Errorf("этот разговор — не стадия маршрута: сказать здесь «работа закончена» некому, переложите карточку через move_card")
	}
	for _, w := range wait.writes {
		if !w.Required {
			continue
		}
		if strings.TrimSpace(fieldValue(fields, w.Property)) == "" {
			return fmt.Errorf("стадия обязана записать свойство %q — передай его в properties", w.Property)
		}
	}
	if len(fields) > 0 {
		if g.Property != "" {
			if _, taken := fieldsHave(fields, g.Property); taken {
				return fmt.Errorf("колонка (%s) меняется не здесь: карточку двигает сам исход работы, либо move_card", g.Property)
			}
		}
		if m.writer == nil {
			return fmt.Errorf("доска недоступна")
		}
		ctx, cancel := context.WithTimeout(m.rootCtx, 10*time.Second)
		defer cancel()
		if err := m.writer.SetCardFields(ctx, wait.cardID, fields); err != nil {
			return err
		}
	}
	select {
	case wait.ch <- stageReport{ok: ok, summary: strings.TrimSpace(summary)}:
		return nil
	default:
		return fmt.Errorf("об окончании работы уже сказано")
	}
}

// fieldValue reads a field the way a person named the property: ignoring case.
func fieldValue(fields map[string]string, property string) string {
	v, _ := fieldsHave(fields, property)
	return v
}

func fieldsHave(fields map[string]string, property string) (string, bool) {
	for k, v := range fields {
		if strings.EqualFold(k, property) {
			return v, true
		}
	}
	return "", false
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
		// The stage is over — reported, cancelled or its CLI gone. Whoever was
		// told about it has been told about something that no longer exists, so
		// the next stage in this terminal starts with nothing waved away.
		//
		// Deliberately here and not in the lower above: a wait going down
		// because the CLI drew a line is the ordinary middle of a stage, and
		// forgetting the ack there is what would put the notification back
		// forty-five seconds later (attentionack.go).
		m.clearAck(t.ID)
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
	if waiting {
		// The wait is being raised again after the silence broke, and whether
		// that is worth interrupting anybody over depends on what broke it. The
		// CLI doing a turn and stopping again is a new question; the CLI
		// repainting because somebody opened the window to look is the person
		// who was already told (attentionack.go).
		m.clearAckIfWorked(t.ID, t.workedAt())
	}
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

// startupFailComment tells the card that the agent could not be started, in the
// CLI's own words. Those words are the whole value of it: the terminal has
// closed by the time anybody looks, so what it printed on the way out exists
// nowhere else.
func startupFailComment(t *TerminalSession, code int) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Не удалось запустить агента %s: CLI завершился сразу после старта с кодом %d.", t.AgentName, code)
	if said := t.tail(1500); said != "" {
		b.WriteString("\n\nЧто он сказал:\n\n```\n")
		b.WriteString(said)
		b.WriteString("\n```")
	}
	fmt.Fprintf(&b, "\n\nКоманда: `%s`", strings.Join(t.Argv, " "))
	return b.String()
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
