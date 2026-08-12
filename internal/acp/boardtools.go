package acp

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/artipop/xciii/internal/boardmcp"
)

// The board tools are how an agent says something back to this application
// instead of only to the person watching it: an MCP server the app serves
// itself, over HTTP, on the front door (internal/boardmcp).
//
// What an agent may reach through it is decided here, by a grant. The token
// names the board, is minted for one agent run and dies with it, so an agent
// that read every byte of its own configuration still cannot leave cards on
// another board, and a token found afterwards opens nothing. This is the same
// bargain the dokku server takes: the model chooses steps, never targets.

// BoardGrant is one agent run's permission to work on one board.
type BoardGrant struct {
	BoardID string
	// Property is the board's column property, so a card asked for by column
	// name lands where the automation is watching. It comes from the config
	// rather than from the agent, which knows column names and nothing else.
	Property string
	// CardID is the card the run stands on, when it stands on one — a card's
	// terminal has it, a planning terminal has not. It is what a tool call that
	// names no card means: an agent working on a card is the caller these tools
	// mostly have, and making it find its own card by title first would be an
	// invitation to act on somebody else's.
	CardID string
}

// GrantBoardTools opens a grant for one agent run and returns the token that
// carries it. The caller revokes it when the run ends; a grant that outlives
// its run is a door left open.
func (m *Manager) GrantBoardTools(boardID, cardID string) string {
	if boardID == "" {
		return ""
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		// Without a token there is no door, which is the safe way to fail.
		m.log.Warn("acp: cannot mint a board tools token", "err", err)
		return ""
	}
	token := hex.EncodeToString(buf)

	m.cfgMu.RLock()
	property := m.cfg.TriggerProperty
	m.cfgMu.RUnlock()

	m.grantsMu.Lock()
	defer m.grantsMu.Unlock()
	if m.grants == nil {
		m.grants = map[string]BoardGrant{}
	}
	m.grants[token] = BoardGrant{BoardID: boardID, Property: property, CardID: cardID}
	return token
}

// RevokeBoardTools closes a grant.
func (m *Manager) RevokeBoardTools(token string) {
	if token == "" {
		return
	}
	m.grantsMu.Lock()
	defer m.grantsMu.Unlock()
	delete(m.grants, token)
}

// boardGrant resolves a token, which is the only way into everything below.
func (m *Manager) boardGrant(token string) (BoardGrant, bool) {
	m.grantsMu.RLock()
	defer m.grantsMu.RUnlock()
	g, ok := m.grants[token]
	return g, ok
}

// SetOrigin records the address the front door answers on, which is what an
// MCP server of ours is pointed at. Set once the front door is listening.
func (m *Manager) SetOrigin(url string) {
	m.grantsMu.Lock()
	defer m.grantsMu.Unlock()
	m.origin = url
}

func (m *Manager) originURL() string {
	m.grantsMu.RLock()
	defer m.grantsMu.RUnlock()
	return m.origin
}

// BoardToolsURL is where the tools are served — the front door, on the /acp/
// subtree that is already ours.
func (m *Manager) BoardToolsURL() string {
	origin := m.originURL()
	if origin == "" {
		return ""
	}
	return strings.TrimSuffix(origin, "/") + boardmcp.Path
}

// openBoardTools mints a grant for a board and writes the MCP config file the
// vendor CLI of a terminal is pointed at: an address and the grant to send with
// it. It returns the token and the file, both of which the caller must close
// when the run ends — the file carries the grant, and the grant is a door.
//
// A board nobody named, an agent whose CLI cannot be told about MCP at all, or
// an app that does not know its own address yet — each of those simply means no
// tools, never a terminal that refuses to open.
func (m *Manager) openBoardTools(boardID, cardID string, agent AgentEntry) (token, configPath string) {
	url := m.BoardToolsURL()
	if boardID == "" || url == "" || !terminalTakesMCP(agent) {
		return "", ""
	}
	token = m.GrantBoardTools(boardID, cardID)
	if token == "" {
		return "", ""
	}
	// 0600 by default, and it carries the grant, so it stays that way.
	f, err := os.CreateTemp("", "xciii-mcp-*.json")
	if err != nil {
		m.log.Warn("acp: cannot write the MCP config for a terminal", "err", err)
		m.RevokeBoardTools(token)
		return "", ""
	}
	defer f.Close()

	config := map[string]any{"mcpServers": map[string]any{boardmcp.ServerName: map[string]any{
		"type":    "http",
		"url":     url,
		"headers": map[string]string{"Authorization": "Bearer " + token},
	}}}
	if err := json.NewEncoder(f).Encode(config); err != nil {
		m.log.Warn("acp: cannot write the MCP config for a terminal", "err", err)
		m.RevokeBoardTools(token)
		_ = os.Remove(f.Name())
		return "", ""
	}
	return token, f.Name()
}

// closeBoardTools shuts the door again: the grant stops working and the file
// that carried it is gone.
func (m *Manager) closeBoardTools(token, configPath string) {
	m.RevokeBoardTools(token)
	if configPath != "" {
		_ = os.Remove(configPath)
	}
}

// CheckBoardTools reports whether a token still opens a door, which is what
// the HTTP end answers a call with before it reads a body.
func (m *Manager) CheckBoardTools(token string) error {
	if _, ok := m.boardGrant(token); !ok {
		return fmt.Errorf("нет доступа к доске")
	}
	return nil
}

// BoardToolColumn is one column as an agent is told about it: the name it must
// use and what putting a card there sets off.
type BoardToolColumn struct {
	Name   string   `json:"name"`
	Action string   `json:"action,omitempty"`
	Agents []string `json:"agents,omitempty"`
}

// BoardToolColumns answers "where can this card go, and what happens then".
// The columns come from the board's own configuration rather than from its
// schema: a column with no action is a place to park a card, and the agent
// needs to know which is which to put work where work starts.
func (m *Manager) BoardToolColumns(token string) ([]BoardToolColumn, error) {
	g, ok := m.boardGrant(token)
	if !ok {
		return nil, fmt.Errorf("нет доступа к доске")
	}
	specs := m.BoardColumns(g.BoardID)
	out := make([]BoardToolColumn, 0, len(specs))
	for _, s := range specs {
		out = append(out, BoardToolColumn{Name: s.Column, Action: s.Action, Agents: s.Agents})
	}
	return out, nil
}

// BoardToolFlowStage is one stage of a route as an agent is told about it.
type BoardToolFlowStage struct {
	Column  string   `json:"column"`
	Action  string   `json:"action,omitempty"`
	Crew    []string `json:"crew,omitempty"`
	Waiting []string `json:"waiting,omitempty"` // what moves a card off this stage
}

// BoardToolFlow is one route the board's cards may take.
type BoardToolFlow struct {
	Name   string               `json:"name"`
	Stages []BoardToolFlowStage `json:"stages"`
}

// BoardToolFlows answers "what routes does this board have, and what does each
// one do". A column says what happens to a card that lands in it; a route says
// what happens after that, which is the half an agent cannot infer from the
// columns alone — and it is how an agent knows that putting a card in one
// column will carry it through four more.
func (m *Manager) BoardToolFlows(token string) ([]BoardToolFlow, error) {
	g, ok := m.boardGrant(token)
	if !ok {
		return nil, fmt.Errorf("нет доступа к доске")
	}
	flows := m.BoardFlows(g.BoardID)
	out := make([]BoardToolFlow, 0, len(flows))
	for _, flow := range flows {
		view := BoardToolFlow{Name: flow.Name}
		property := flow.PropertyOr(m.triggerProperty())
		for _, node := range flow.Nodes {
			stage := BoardToolFlowStage{Column: node.Column, Action: node.Action, Crew: node.Crew()}
			// A stage that names neither falls back to its column's, which is
			// what the engine itself resolves — the agent must be told what
			// will run, not what the stage happened to write down.
			if spec, found := m.columnByName(property, node.Column); found {
				if stage.Action == "" {
					stage.Action = spec.Action
				}
				if len(stage.Crew) == 0 {
					stage.Crew = spec.Agents
				}
			}
			stage.Waiting = flow.WaitDescriptions(node.ID)
			view.Stages = append(view.Stages, stage)
		}
		out = append(out, view)
	}
	return out, nil
}

// BoardToolCard is one card as an agent is told about it: named values only,
// because names are the whole vocabulary these tools have.
type BoardToolCard struct {
	ID      string   `json:"id"`
	Title   string   `json:"title"`
	Column  string   `json:"column,omitempty"`
	Options []string `json:"options,omitempty"`
	Body    string   `json:"body,omitempty"` // only when one card was asked about
	// Mine says this is the card the agent's own run stands on — the one a call
	// that names no card acts on.
	Mine bool `json:"mine,omitempty"`

	// Where the card stands on its route, for the cards that are on one.
	Flow    string   `json:"flow,omitempty"`
	Stage   string   `json:"stage,omitempty"`
	Waiting []string `json:"waiting,omitempty"`
	Running bool     `json:"running,omitempty"`
	Queued  bool     `json:"queued,omitempty"`
}

// BoardToolCards lists the granted board's cards, optionally only those in one
// column. Nothing else an agent can do to a card is possible without this: every
// other call takes an id, and an id is not something a conversation carries.
func (m *Manager) BoardToolCards(ctx context.Context, token, column string) ([]BoardToolCard, error) {
	g, ok := m.boardGrant(token)
	if !ok {
		return nil, fmt.Errorf("нет доступа к доске")
	}
	if m.reader == nil {
		return nil, fmt.Errorf("доска недоступна")
	}
	events, err := m.reader.CardsForBoard(ctx, g.BoardID)
	if err != nil {
		return nil, err
	}

	// The routes are read once for the whole listing rather than once per card:
	// a board's cards are hundreds and its routes are a handful.
	states := map[string]FlowState{}
	if all, err := m.flowStates(); err == nil {
		for _, st := range all {
			states[st.CardID] = st
		}
	}
	m.mu.Lock()
	running := make(map[string]bool, len(m.byCard))
	for cardID := range m.byCard {
		running[cardID] = true
	}
	m.mu.Unlock()

	column = strings.TrimSpace(column)
	out := make([]BoardToolCard, 0, len(events))
	for _, ev := range events {
		card := m.toolCard(g, ev)
		if column != "" && !strings.EqualFold(card.Column, column) {
			continue
		}
		if st, on := states[ev.CardID]; on {
			card.Flow = st.Flow
			if flow, found := m.FlowByName(st.Flow); found {
				if node, has := flow.Node(st.NodeID); has {
					card.Stage = node.Column
				}
				card.Waiting = flow.WaitDescriptions(st.NodeID)
			}
			card.Running = running[ev.CardID]
			card.Queued = !card.Running && m.cardIsQueued(ev.CardID)
		}
		out = append(out, card)
	}
	return out, nil
}

// BoardToolCardByID is one card in full — its description included, and where it
// stands on its route. A cardID of "" is the run's own card, which is what an
// agent working on one means when it asks about "the card".
func (m *Manager) BoardToolCardByID(ctx context.Context, token, cardID string) (BoardToolCard, error) {
	g, ev, err := m.grantedCard(ctx, token, cardID)
	if err != nil {
		return BoardToolCard{}, err
	}
	card := m.toolCard(g, ev)
	card.Body = ev.Body
	if flow, err := m.CardFlowFor(ev.CardID); err == nil && flow != nil {
		card.Flow = flow.Flow
		card.Waiting = flow.WaitingFor
		card.Running = flow.Running
		card.Queued = flow.Queued
		for _, stage := range flow.Stages {
			if stage.Current {
				card.Stage = stage.Column
			}
		}
	}
	return card, nil
}

// UpdateCardFromTools changes a card: its title, its column, its other named
// values. A cardID of "" is the run's own card.
//
// Moving a card is this same call with a column in it, and that is deliberate:
// a column is a property like the others, and what makes moving special is not
// how it is written but what the board does about it afterwards.
func (m *Manager) UpdateCardFromTools(ctx context.Context, token, cardID string, edit CardEdit) error {
	g, ev, err := m.grantedCard(ctx, token, cardID)
	if err != nil {
		return err
	}
	if m.writer == nil {
		return fmt.Errorf("доска недоступна")
	}
	if strings.TrimSpace(edit.Title) == "" && strings.TrimSpace(edit.Column) == "" && len(edit.Options) == 0 {
		return fmt.Errorf("не сказано, что менять")
	}
	edit.Property = g.Property
	if err := m.writer.UpdateCard(ctx, ev.CardID, edit); err != nil {
		return err
	}
	m.log.Info("acp: card changed by an agent", "card", ev.CardID, "board", g.BoardID, "column", edit.Column)
	return nil
}

// CommentFromTools writes on a card in the agent's own voice. It is how an agent
// says something that belongs to the card rather than to the conversation it is
// having — the same place a session's report goes, so a person reading the card
// later finds one history and not two.
func (m *Manager) CommentFromTools(ctx context.Context, token, cardID, text string) error {
	_, ev, err := m.grantedCard(ctx, token, cardID)
	if err != nil {
		return err
	}
	if strings.TrimSpace(text) == "" {
		return fmt.Errorf("пустой комментарий")
	}
	if m.writer == nil {
		return fmt.Errorf("доска недоступна")
	}
	return m.writer.AddComment(ctx, ev.CardID, text)
}

// CreateCardFromTools is the write itself. Everything an agent may decide is a
// name a person would have typed; the board is the grant's.
func (m *Manager) CreateCardFromTools(ctx context.Context, token string, card NewCard) (string, error) {
	g, ok := m.boardGrant(token)
	if !ok {
		return "", fmt.Errorf("нет доступа к доске")
	}
	if strings.TrimSpace(card.Title) == "" {
		return "", fmt.Errorf("у карточки должен быть заголовок")
	}
	if m.writer == nil {
		return "", fmt.Errorf("доска недоступна")
	}
	card.BoardID = g.BoardID
	card.Property = g.Property

	id, err := m.writer.CreateCard(ctx, card)
	if err != nil {
		return "", err
	}
	m.log.Info("acp: card created by an agent", "card", id, "board", g.BoardID, "column", card.Column)
	return id, nil
}

// grantedCard resolves the card a call names — or the run's own card, when it
// names none — and refuses one that is not on the granted board. That check is
// what keeps the grant a board and not a doorway: card ids are guessable in the
// sense that an agent may read one anywhere, and without this a token for one
// board would edit cards on every other.
func (m *Manager) grantedCard(ctx context.Context, token, cardID string) (BoardGrant, CardMoved, error) {
	g, ok := m.boardGrant(token)
	if !ok {
		return BoardGrant{}, CardMoved{}, fmt.Errorf("нет доступа к доске")
	}
	cardID = strings.TrimSpace(cardID)
	if cardID == "" {
		cardID = g.CardID
	}
	if cardID == "" {
		return g, CardMoved{}, fmt.Errorf("не сказано, о какой карточке речь")
	}
	if m.reader == nil {
		return g, CardMoved{}, fmt.Errorf("доска недоступна")
	}
	ev, err := m.reader.CardByID(ctx, cardID)
	if err != nil {
		return g, CardMoved{}, fmt.Errorf("карточка %s не найдена", cardID)
	}
	if ev.BoardID != g.BoardID {
		return g, CardMoved{}, fmt.Errorf("карточка %s не на этой доске", cardID)
	}
	return g, ev, nil
}

// toolCard is a card read back the way it was written: the column by name, and
// everything else selected on it by name too, minus the column so it is not said
// twice.
func (m *Manager) toolCard(g BoardGrant, ev CardMoved) BoardToolCard {
	card := BoardToolCard{
		ID:    ev.CardID,
		Title: ev.Title,
		Mine:  g.CardID != "" && ev.CardID == g.CardID,
	}
	if g.Property != "" {
		// Props is what the board renders a property as, and it upper-cases a
		// select value on the way out. The agent is told the option's own name,
		// because that is the name it has to send back.
		card.Column = ev.Props[strings.ToLower(g.Property)]
		for _, name := range ev.OptionNames {
			if strings.EqualFold(name, card.Column) {
				card.Column = name
				break
			}
		}
	}
	for _, name := range ev.OptionNames {
		if card.Column != "" && strings.EqualFold(name, card.Column) {
			continue
		}
		card.Options = append(card.Options, name)
	}
	return card
}
