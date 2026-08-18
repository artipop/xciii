package acp

import (
	"strings"
	"time"
)

// What a card can say about itself: which route it is on, where along it it
// stands, and what it is waiting for. The card shows this instead of making
// somebody read the comments backwards to work out why it has not moved.

// CardFlowStage is one stage of the route as the card sees it.
type CardFlowStage struct {
	NodeID  string   `json:"nodeId"`
	Column  string   `json:"column"`
	Action  string   `json:"action"`         // resolved: the stage's own, else its column's
	Crew    []string `json:"crew,omitempty"` // who works it
	Current bool     `json:"current"`
	Done    bool     `json:"done"` // the card has already been through it
}

// CardFlow is the whole answer for one card.
type CardFlow struct {
	Flow       string          `json:"flow"`
	Stages     []CardFlowStage `json:"stages"`
	CurrentID  string          `json:"currentNodeId"`
	Since      time.Time       `json:"since"`
	Branch     string          `json:"branch,omitempty"`
	WaitingFor []string        `json:"waitingFor,omitempty"` // human labels of the events the stage waits on
	Queued     bool            `json:"queued,omitempty"`     // waiting for a place in the column
	Running    bool            `json:"running,omitempty"`    // a session of this stage is working now
	// Stalled says why nothing is happening, when the machinery knows: the
	// stage would not start, the route has no edge for what arrived. It used
	// to be a comment on the card; it is state, so it lives here and goes away
	// with the next progress.
	Stalled string `json:"stalled,omitempty"`
}

// CardFlowFor describes where a card stands on its route. It returns nothing —
// and no error — for a card that is not on one, since most cards are not.
func (m *Manager) CardFlowFor(cardID string) (*CardFlow, error) {
	st, ok, err := m.flowState(cardID)
	if err != nil || !ok {
		return nil, err
	}
	flow, found := m.FlowByName(st.Flow)
	if !found {
		return nil, nil
	}

	out := &CardFlow{Flow: flow.Name, CurrentID: st.NodeID, Since: st.EnteredAt, Branch: st.Branch}

	// "Done" is what the card's own history says it has been through, not what
	// the graph makes possible: a route with a loop has no linear order. The
	// card carries that history itself; the journal answers for a card parked
	// before it did.
	visited := make(map[string]bool)
	for _, id := range st.Visited {
		visited[id] = true
	}
	if len(visited) == 0 && m.store != nil {
		if events, err := m.store.FlowEvents(cardID); err == nil {
			for _, e := range events {
				if e.FromNode != "" {
					visited[e.FromNode] = true
				}
			}
		}
	}

	for _, n := range flow.Nodes {
		action := n.Action
		if action == "" {
			if spec, ok := m.columnOf(n, flow.PropertyOr(m.triggerProperty())); ok {
				action = spec.Action
			}
		}
		crew := n.Crew()
		if len(crew) == 0 {
			if spec, ok := m.columnOf(n, flow.PropertyOr(m.triggerProperty())); ok {
				crew = spec.AgentIDs
			}
		}
		out.Stages = append(out.Stages, CardFlowStage{
			NodeID:  n.ID,
			Column:  n.Column,
			Action:  action,
			Crew:    m.crewNames(crew),
			Current: n.ID == st.NodeID,
			Done:    visited[n.ID] && n.ID != st.NodeID,
		})
	}

	// Conditions included: «на карточке выбрано «Одобрено» = «Да»» is the
	// answer to "what is this card waiting for", the kind alone is not.
	out.WaitingFor = append(out.WaitingFor, flow.WaitDescriptions(st.NodeID)...)

	m.mu.Lock()
	_, out.Running = m.byCard[cardID]
	m.mu.Unlock()
	if !out.Running {
		out.Queued = m.cardIsQueued(cardID)
	}
	if stall, ok := m.CardStall(cardID); ok {
		out.Stalled = stall.Reason
	}
	return out, nil
}

// cardIsQueued reports whether the card is waiting for a place in its column.
func (m *Manager) cardIsQueued(cardID string) bool {
	st, ok, err := m.flowState(cardID)
	if err != nil || !ok {
		return false
	}
	flow, found := m.FlowByName(st.Flow)
	if !found {
		return false
	}
	node, found := flow.Node(st.NodeID)
	if !found {
		return false
	}
	spec, found := m.columnOf(node, flow.PropertyOr(m.triggerProperty()))
	if !found {
		return false
	}
	q, ok, err := m.store.NextQueuedStage(spec.Key())
	return err == nil && ok && q.CardID == cardID
}

// columnOf finds the configured column a route's stage stands on.
//
// By the stage's option id where it has one, which is what makes renaming a
// column — or the property it lives on — cost nothing (contradiction 1 of
// docs/model-graph.md). The names are the fallback for a route written before
// stages recorded an option, and `matchColumn` backfills those the first time a
// card moves through, so the fallback empties itself.
func (m *Manager) columnOf(node FlowNode, property string) (ColumnSpec, bool) {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	if node.OptionID != "" {
		for _, c := range m.cfg.Columns {
			if c.OptionID != "" && c.OptionID == node.OptionID {
				return c, true
			}
		}
	}
	for _, c := range m.cfg.Columns {
		if strings.EqualFold(c.Column, node.Column) &&
			(property == "" || c.Property == "" || strings.EqualFold(c.Property, property)) {
			return c, true
		}
	}
	return ColumnSpec{}, false
}

// FlowStageCount is how busy one stage of a route is right now.
type FlowStageCount struct {
	NodeID  string `json:"nodeId"`
	Cards   int    `json:"cards"`   // cards standing on this stage
	Running int    `json:"running"` // of those, being worked on now
	Queued  int    `json:"queued"`  // of those, waiting for a place in the column
}

// FlowOverview is one route and where the board's cards are along it.
type FlowOverview struct {
	Flow   string           `json:"flow"`
	Stages []FlowStageCount `json:"stages"`
	Cards  int              `json:"cards"`
}

// BoardFlowOverview answers "where is everything right now" for a board: for
// each route it may use, how many cards stand on each of its stages and which
// of them are moving. It is the map the workflow view draws — the same data the
// engine runs on, rather than a second bookkeeping of it.
func (m *Manager) BoardFlowOverview(boardID string) ([]FlowOverview, error) {
	flows := m.BoardFlows(boardID)
	if len(flows) == 0 {
		return nil, nil
	}
	states, err := m.flowStates()
	if err != nil {
		return nil, err
	}

	// One pass over the live sessions, rather than one lookup per card.
	m.mu.Lock()
	running := make(map[string]bool, len(m.active))
	for cardID := range m.byCard {
		running[cardID] = true
	}
	m.mu.Unlock()

	out := make([]FlowOverview, 0, len(flows))
	for _, flow := range flows {
		view := FlowOverview{Flow: flow.Name}
		counts := make(map[string]*FlowStageCount, len(flow.Nodes))
		for _, n := range flow.Nodes {
			counts[n.ID] = &FlowStageCount{NodeID: n.ID}
		}
		for _, st := range states {
			if !strings.EqualFold(st.Flow, flow.Name) {
				continue
			}
			if boardID != "" && st.BoardID != "" && st.BoardID != boardID {
				continue
			}
			count, ok := counts[st.NodeID]
			if !ok {
				continue // the card stands on a stage the route no longer has
			}
			count.Cards++
			view.Cards++
			switch {
			case running[st.CardID]:
				count.Running++
			case m.cardIsQueued(st.CardID):
				count.Queued++
			}
		}
		for _, n := range flow.Nodes {
			view.Stages = append(view.Stages, *counts[n.ID])
		}
		out = append(out, view)
	}
	return out, nil
}
