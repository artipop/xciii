package acp

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// The flow engine. One entry point — enterNode — and two ways in: a human drags
// a card into a column that is a node, or an event moves the card on. Both end
// in the same place, so a route behaves the same whether it is walked by hand or
// by itself.

// cardIdleWait bounds how long a transition waits for the card's previous
// session to let go of its project before starting the next one.
const cardIdleWait = 20 * time.Second

// handleFlowMove routes a board event through the card's flow. It reports
// whether the flow took charge of the event: a card with a route is never also
// handled by the standalone trigger columns, or the two would fight.
func (m *Manager) handleFlowMove(ev CardMoved) bool {
	projectPath, _ := m.resolveProject(ev)
	flow := m.resolveFlow(ev, projectPath)
	if flow == nil {
		return false
	}
	property := flow.PropertyOr(m.triggerProperty())
	if !strings.EqualFold(ev.ToColumn.PropertyName, property) {
		return false // some other select property changed; not the route's business
	}

	node, ok := flow.NodeByColumn(ev.ToColumn.Name)
	if !ok {
		// The card was dragged off its route. Stop what was running for it and
		// forget where it stood — but never drag it back: the human wins.
		if _, was := flow.NodeByColumn(ev.FromColumn.Name); was {
			m.CancelSessionForCard(ev.CardID, "карточка убрана из флоу")
			m.clearFlowState(ev.CardID)
		}
		return true
	}
	if !m.claimIdempotent(ev, "flow") {
		return true
	}
	// A card moved while it was working: the old session is pointless now.
	m.CancelSessionForCard(ev.CardID, "карточка перенесена в другую колонку")

	f, n := *flow, node
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		m.enterNode(ev, f, n, false, "", "перенос вручную")
	}()
	return true
}

// enterNode is what "the card is now on this stage" means: move it if we are
// the ones advancing it, remember the position, say why, and run the stage.
func (m *Manager) enterNode(ev CardMoved, flow FlowEntry, node FlowNode, move bool, on, detail string) {
	if move {
		property := flow.PropertyOr(m.triggerProperty())
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		err := m.writer.MoveCardByOptionName(ctx, ev.CardID, property, node.Column)
		cancel()
		if err != nil {
			m.log.Warn("acp: flow move failed", "card", ev.CardID, "column", node.Column, "err", err)
			m.commentCard(ev.CardID, fmt.Sprintf("Флоу «%s»: не удалось перевести карточку в «%s»: %v",
				flow.Name, node.Column, err))
			return
		}
		// A card that moved is a card that moved: the board shows it in the new
		// column, and a comment saying so on every stage of every route turned
		// the card into a log of its own route. Only a move that did *not*
		// happen is worth a comment, which is the branch above.
	}

	projectPath, _ := m.resolveProject(ev)
	from, previousBranch := "", ""
	if st, ok, _ := m.flowState(ev.CardID); ok {
		from, previousBranch = st.NodeID, st.Branch
	}
	m.saveFlowState(FlowState{
		CardID:      ev.CardID,
		BoardID:     ev.BoardID,
		Flow:        flow.Name,
		NodeID:      node.ID,
		Branch:      m.flowBranch(ev, projectPath, previousBranch),
		ProjectPath: projectPath,
	})
	m.appendFlowEvent(FlowEventRecord{
		CardID: ev.CardID, Flow: flow.Name, FromNode: from, ToNode: node.ID, On: on, Detail: detail,
	})
	m.log.Info("acp: flow node entered", "card", ev.CardID, "flow", flow.Name, "node", node.ID, "on", on)

	m.runNodeAction(ev, flow, node)
}

// flowBranch is the branch a card's route follows — what the VCS watcher polls
// for, and what a later stage deploys. In order:
//
//  1. what the card says, since that is somebody's decision;
//  2. the branch its last session worked on — with worktrees (the default) the
//     agent commits to a branch of its own that the card never learns about, so
//     without this the route would watch whatever the project had checked
//     out and wait for a merge that never comes;
//  3. what the route already carried, so a card that stops mentioning its
//     branch does not silently stop being watched;
//  4. the project's checked-out branch, for a card nobody has worked yet.
func (m *Manager) flowBranch(ev CardMoved, projectPath, previous string) string {
	if b := strings.TrimSpace(ev.Props["branch"]); b != "" {
		return b
	}
	if b := m.cardBranch(ev.CardID); b != "" {
		return b
	}
	if previous != "" {
		return previous
	}
	if projectPath == "" {
		return ""
	}
	branch, err := resolveDeployBranch(ev, projectPath)
	if err != nil {
		return ""
	}
	return branch
}

// cardBranch is the branch the card was last worked on, as recorded by its own
// sessions. Empty when it has never been worked on, or when the store is not
// there (tests).
func (m *Manager) cardBranch(cardID string) string {
	if m.store == nil || cardID == "" {
		return ""
	}
	branch, err := m.store.LatestBranchForCard(cardID)
	if err != nil {
		m.log.Warn("acp: cannot read the card's branch", "card", cardID, "err", err)
		return ""
	}
	return branch
}

// runNodeAction starts whatever the stage does. A stage that cannot even start
// counts as a failed one, so the route can carry the card to its failure branch
// instead of silently stalling.
func (m *Manager) runNodeAction(ev CardMoved, flow FlowEntry, node FlowNode) {
	// The stage stands on a column, and the column says who works it and how
	// many at once. The stage overrides only what it names itself.
	spec, _ := m.columnFor(ev.BoardID, node.asColumn(flow.PropertyOr(m.triggerProperty())))
	opts := startOptions{flowName: flow.Name, flowNodeID: node.ID, column: spec,
		deployOverride: node.DeployName, agentCrew: node.Crew()}

	action := node.Action
	if action == "" {
		action = spec.Action // the stage does whatever its column does
	}
	switch action {
	case FlowActionNone, "":
		return
	case FlowActionAgent:
	case FlowActionDeploy:
		opts.deploy = true
	case FlowActionTest:
		opts.test = true
	default:
		m.log.Warn("acp: unknown flow action", "flow", flow.Name, "node", node.ID, "action", action)
		return
	}

	// The previous stage's session may still be releasing its project.
	m.waitForCardIdle(ev.CardID)

	s, err := m.startSession(ev, opts)
	if errors.Is(err, errStageBusy) {
		m.enqueueStage(ev, spec, flow.Name, node.ID)
		return
	}
	// The card is somebody's: the route keeps its place and waits for them to
	// move it on. Not a failed stage — the work is being done, just not by us.
	var mine AssignedToHumanError
	if errors.As(err, &mine) {
		m.sayCardIsTaken(ev.CardID, mine)
		return
	}
	if err != nil {
		m.log.Warn("acp: flow action not started", "card", ev.CardID, "node", node.ID, "err", err)
		m.commentCard(ev.CardID, fmt.Sprintf("Флоу «%s», стадия «%s»: шаг не запущен: %v", flow.Name, node.Column, err))
		m.advanceFlow(ev.CardID, TriggerFailure, "шаг не удалось запустить")
		return
	}
	m.log.Info("acp: flow action started", "session", s.ID, "card", ev.CardID, "action", action)
}

// advanceFlow moves a card along the edge matching an event.
func (m *Manager) advanceFlow(cardID, on, detail string) {
	m.advanceFlowWith(cardID, on, detail, "")
}

// advanceFlowWith is advanceFlow carrying the agent's closing words, which is
// what a comment condition on an outcome edge is asked about. Everything else
// passes "" — there was no agent speaking.
func (m *Manager) advanceFlowWith(cardID, on, detail, agentText string) {
	st, ok, err := m.flowState(cardID)
	if err != nil || !ok {
		return
	}
	flow, ok := m.FlowByName(st.Flow)
	if !ok {
		m.log.Info("acp: flow gone, card stays put", "card", cardID, "flow", st.Flow)
		return
	}
	node, ok := flow.Node(st.NodeID)
	if !ok {
		m.commentCard(cardID, fmt.Sprintf("Флоу «%s»: стадия %q исчезла из маршрута — карточка осталась на месте.", flow.Name, st.NodeID))
		return
	}
	if !flow.HasEdge(node.ID, on) {
		// A missing edge for an outcome is worth saying out loud: the route
		// stops here and somebody has to know why. VCS events are only polled
		// for where an edge exists, so silence is correct for them.
		if !IsVCSTrigger(on) && on != TriggerCardChanged {
			m.commentCard(cardID, fmt.Sprintf("Флоу «%s»: у стадии «%s» нет перехода по событию «%s» — карточка осталась на месте.",
				flow.Name, node.Column, TriggerLabel(on)))
		}
		return
	}

	// The card is read before the edge is chosen: a conditional edge asks
	// about the card as it is now, not as it was when it parked here.
	if m.reader == nil {
		m.log.Warn("acp: no board reader, cannot advance flow", "card", cardID)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	ev, err := m.reader.CardByID(ctx, cardID)
	cancel()
	if err != nil {
		m.log.Warn("acp: cannot read card for flow transition", "card", cardID, "err", err)
		return
	}

	next, cond, ok := flow.Next(node.ID, on, ev.Props, agentText)
	if !ok {
		// Edges exist for this event, but no condition held and there is no
		// fallback. That is a decision the route made, and worth recording —
		// once per parking, not per poll: a VCS event repeats every interval.
		if !IsVCSTrigger(on) {
			m.commentCard(cardID, fmt.Sprintf("Флоу «%s»: событие «%s» пришло, но ни одно условие стадии «%s» не выполнено — карточка осталась на месте.",
				flow.Name, TriggerLabel(on), node.Column))
		}
		return
	}

	// One event moves a card once.
	key := fmt.Sprintf("flow|%s|%s|%s", cardID, node.ID, on)
	if fresh, err := m.store.ClaimIdempotency(key, "", m.cfg.IdempotencyWindow()); err != nil {
		m.log.Error("acp: flow idempotency check failed", "err", err)
		return
	} else if !fresh {
		return
	}

	if detail == "" {
		detail = TriggerLabel(on)
	}
	if desc := cond.Describe(); desc != "" {
		detail += ", " + desc
	}
	m.enterNode(ev, flow, next, true, on, detail)
}

// handleCardChanged advances a parked card when a select option set on it is
// what its stage waits for. The event is any select change that was not a move
// on the route's own column — the trigger loop hands those here.
//
// Only edges whose condition names the changed property react: setting
// «Приоритет» must not wake a stage waiting on «Одобрено», and must not leave a
// "nothing matched" comment either — the change was simply not addressed to it.
func (m *Manager) handleCardChanged(ev CardMoved) bool {
	if ev.ToColumn.Name == "" {
		return false // an option was cleared, not chosen
	}
	st, ok, err := m.flowState(ev.CardID)
	if err != nil || !ok {
		return false
	}
	flow, ok := m.FlowByName(st.Flow)
	if !ok {
		return false
	}
	watched := false
	for _, e := range flow.Edges {
		if e.From == st.NodeID && e.On == TriggerCardChanged && e.If != nil &&
			strings.EqualFold(e.If.Property, ev.ToColumn.PropertyName) {
			watched = true
			break
		}
	}
	if !watched {
		return false
	}

	// A person marking an option on a working card is a person intervening: the
	// route is about to move it, so whatever ran here is over. A cancelled
	// session produces no outcome, so the two paths cannot double-move.
	m.CancelSessionForCard(ev.CardID, "на карточке выбрана опция, по которой стадия едет дальше")

	detail := fmt.Sprintf("на карточке выбрано «%s» = «%s»", ev.ToColumn.PropertyName, ev.ToColumn.Name)
	m.advanceFlow(ev.CardID, TriggerCardChanged, detail)
	return true
}

// flowAfterSession is called once a session has fully released its resources:
// its outcome is the event its stage moves on. A cancelled session produces no
// outcome at all — somebody intervened, and the route waits for them.
func (m *Manager) flowAfterSession(s *Session) {
	if s.FlowName == "" {
		return
	}
	outcome, detail := s.flowOutcome()
	if outcome == "" {
		return
	}
	m.advanceFlowWith(s.CardID, outcome, detail, s.agentFinalText())
}

// waitForCardIdle waits until the card has no live session, so the next stage
// does not collide with the previous one over the project.
func (m *Manager) waitForCardIdle(cardID string) {
	deadline := time.Now().Add(cardIdleWait)
	for time.Now().Before(deadline) {
		m.mu.Lock()
		_, live := m.byCard[cardID]
		m.mu.Unlock()
		if !live {
			return
		}
		select {
		case <-m.rootCtx.Done():
			return
		case <-time.After(100 * time.Millisecond):
		}
	}
	m.log.Warn("acp: previous session still running, starting the next stage anyway", "card", cardID)
}

// VCSEvent is one project event the watcher observed. It is the engine's
// second input, next to session outcomes.
type VCSEvent struct {
	Kind        string
	ProjectPath string
	Branch      string
	Detail      string
}

// OnVCSEvent advances every card parked on a node that waits for this event in
// this project and branch.
func (m *Manager) OnVCSEvent(ev VCSEvent) {
	states, err := m.flowStates()
	if err != nil {
		m.log.Error("acp: cannot read flow states", "err", err)
		return
	}
	for _, st := range states {
		if !strings.EqualFold(st.Branch, ev.Branch) || st.ProjectPath != ev.ProjectPath {
			continue
		}
		detail := ev.Detail
		if detail == "" {
			detail = TriggerLabel(ev.Kind)
		}
		m.advanceFlow(st.CardID, ev.Kind, detail)
	}
}

// FlowTargets is what the VCS watcher has to poll: one entry per (project,
// branch) a parked card is waiting on, with the triggers it waits for. Nothing
// waiting means no polling at all.
type FlowTarget struct {
	ProjectPath string
	Branch      string
	Triggers    []string
}

// FlowTargets collects the poll targets from the cards currently on a route.
func (m *Manager) FlowTargets() []FlowTarget {
	states, err := m.flowStates()
	if err != nil {
		m.log.Error("acp: cannot read flow states", "err", err)
		return nil
	}
	byKey := map[string]*FlowTarget{}
	for _, st := range states {
		if st.ProjectPath == "" || st.Branch == "" {
			continue
		}
		flow, ok := m.FlowByName(st.Flow)
		if !ok {
			continue
		}
		waits := flow.WaitsFor(st.NodeID)
		if len(waits) == 0 {
			continue
		}
		key := st.ProjectPath + "\x00" + st.Branch
		t, ok := byKey[key]
		if !ok {
			t = &FlowTarget{ProjectPath: st.ProjectPath, Branch: st.Branch}
			byKey[key] = t
		}
		for _, w := range waits {
			if !containsString(t.Triggers, w) {
				t.Triggers = append(t.Triggers, w)
			}
		}
	}
	out := make([]FlowTarget, 0, len(byKey))
	for _, t := range byKey {
		out = append(out, *t)
	}
	return out
}

// triggerProperty is the select property columns are named on.
func (m *Manager) triggerProperty() string {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	return m.cfg.TriggerProperty
}

// The store wrappers below keep the engine readable and tolerate a manager
// built without a store (tests that never touch a route).

func (m *Manager) flowState(cardID string) (FlowState, bool, error) {
	if m.store == nil {
		return FlowState{}, false, nil
	}
	return m.store.FlowStateForCard(cardID)
}

func (m *Manager) flowStates() ([]FlowState, error) {
	if m.store == nil {
		return nil, nil
	}
	return m.store.FlowStates()
}

func (m *Manager) saveFlowState(st FlowState) {
	if m.store == nil {
		return
	}
	if err := m.store.SaveFlowState(st); err != nil {
		m.log.Error("acp: cannot save flow state", "card", st.CardID, "err", err)
	}
}

func (m *Manager) clearFlowState(cardID string) {
	if m.store == nil {
		return
	}
	if err := m.store.ClearFlowState(cardID); err != nil {
		m.log.Error("acp: cannot clear flow state", "card", cardID, "err", err)
	}
}

func (m *Manager) appendFlowEvent(r FlowEventRecord) {
	if m.store == nil {
		return
	}
	if err := m.store.AppendFlowEvent(r); err != nil {
		m.log.Error("acp: cannot record flow event", "card", r.CardID, "err", err)
	}
}

func containsString(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}
