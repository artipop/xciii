package acp

import (
	"errors"
	"fmt"
	"strings"

	"github.com/artipop/xciii/internal/boardmcp"
)

// A column of the board and what happens in it: the action a card entering it
// starts, the agents who work it, and how many of them may work it at once.
//
// This is where "the To Test column is tested by the Tester agent" is said —
// once, for the whole board, rather than repeated inside every route that
// passes through the column. A flow then only says where a card goes next
// (see flows.go): the column is the behaviour, the flow is the route.

// ColumnSpec is one configured column.
type ColumnSpec struct {
	// The board it belongs to and the option that is the column itself. This is
	// the whole of how a column is identified; a spec that arrived with only a
	// name is bound to its option when the board is read (bindToBoardOptions).
	BoardID    string `json:"boardId,omitempty"`
	PropertyID string `json:"propertyId,omitempty"`
	OptionID   string `json:"optionId,omitempty"`

	// Property and Column are what a person reads. They are labels and nothing
	// else: renaming either used to move a card's settings to another column.
	Property string `json:"property"`
	Column   string `json:"column"`

	Action string `json:"action"` // FlowAction*

	// AgentIDs is the roster: everyone who works this column, by registry id.
	// A card picks one of them when it does not name an agent itself. Empty
	// leaves the choice to the card, exactly as before.
	AgentIDs []string `json:"agentIds,omitempty"`
	// Agents is what the roster used to be written as — the names a person
	// typed. Folded into AgentIDs once (bindrefs.go) and never written back:
	// renaming an agent used to empty the crew of every column on every board.
	Agents []string `json:"agents,omitempty"`

	// Prompt is what working in this column means, said to the agent: the
	// reviewer's brief on «Ревью», the builder's on «В работе». It goes in
	// front of the card's task for a session and into the opening of a
	// conversation held here, after the board's and the agent's own prompts —
	// those say where the agent is, this says what the *column* wants. A route
	// node may override it for its stage alone (FlowNode.Prompt). Typed by a
	// person, so it is passed through as data in whatever language they wrote.
	Prompt string `json:"prompt,omitempty"`

	// Writes and Reads are the column's declared outputs and inputs — see
	// FlowNode.Writes/Reads, which override these per route.
	Writes []PropertyWrite `json:"writes,omitempty"`
	Reads  []string        `json:"reads,omitempty"`

	// MCPServers are the tools working in this column comes with: a browser for
	// «QA», a service's own server for the column that talks to it. They are
	// handed to whichever agent works here, on top of the servers that agent
	// carries in the registry — which is what keeps one agent from having to be
	// registered twice to be configured differently in two columns.
	//
	// The shape is the one every MCP client uses (MCPServerSet), so an entry
	// can be pasted from a server's README exactly as in «Настройки → Агенты».
	// A route node may override the whole set for its stage alone
	// (FlowNode.MCPServers).
	MCPServers MCPServerSet `json:"mcpServers,omitempty"`

	// DeployID pins the deploy target for a "deploy" column, by the registry
	// entry's own id: renaming a target must not silently unpin every column
	// that sends work to it (docs/model-graph.md, contradiction 8).
	DeployID string `json:"deployId,omitempty"`
	// DeployName is what pinning used to be written as. Read once and folded
	// into DeployID (bindrefs.go); never written back.
	DeployName string `json:"deployName,omitempty"`

	// MaxRunning bounds how many sessions this column runs at once. Zero means
	// no limit of its own (the global maxConcurrent still applies).
	MaxRunning int `json:"maxRunning,omitempty"`
}

// Key identifies the column for the queue and for counting what is running in
// it. Ids are used where known, since names change and ids do not.
func (c ColumnSpec) Key() string { return c.BoardID + "|" + c.OptionID }

// columnKey is Key for a column as it arrives in an event.
func columnKey(boardID string, c Column) string { return boardID + "|" + c.OptionID }

// Columns returns a snapshot of the registry.
func (m *Manager) Columns() []ColumnSpec {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	return append([]ColumnSpec(nil), m.cfg.Columns...)
}

// BoardColumns returns the columns configured for one board — the specs the
// editor shows, plus any that name no board at all.
func (m *Manager) BoardColumns(boardID string) []ColumnSpec {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	out := make([]ColumnSpec, 0, len(m.cfg.Columns))
	for _, c := range m.cfg.Columns {
		if c.BoardID == "" || c.BoardID == boardID {
			out = append(out, c)
		}
	}
	return out
}

// matchColumn finds the spec for a column of an event, by the option the column
// is. Nothing is matched by name any more (contradiction 5): a spec that knows
// only a name is bound to its option when the board is read
// (bindToBoardOptions), and one that could not be bound describes a column the
// board has not got.
func matchColumn(specs []ColumnSpec, boardID string, c Column) (ColumnSpec, int, bool) {
	if c.OptionID == "" {
		return ColumnSpec{}, -1, false
	}
	// The board's own answer first, then one that names no board — an entry
	// that predates boards being told apart, and is offered to all of them.
	for i, s := range specs {
		if s.OptionID == c.OptionID && s.BoardID == boardID {
			return s, i, true
		}
	}
	for i, s := range specs {
		if s.OptionID == c.OptionID && s.BoardID == "" {
			return s, i, true
		}
	}
	return ColumnSpec{}, -1, false
}

// columnFor is what the trigger loop asks: does anything happen when a card
// lands here?
func (m *Manager) columnFor(boardID string, c Column) (ColumnSpec, bool) {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	spec, _, ok := matchColumn(m.cfg.Columns, boardID, c)
	return spec, ok
}

// validateColumn normalizes and checks one spec against the registries it may
// reference.
func validateColumn(c ColumnSpec, agents []AgentEntry, deploys []DeployEntry) (ColumnSpec, error) {
	// A leftover name means the board's own copy could not be bound to this
	// machine's registry (adoptColumns); refusing here is what routes the column
	// back to being kept on the board verbatim.
	if len(c.Agents) > 0 {
		return ColumnSpec{}, fmt.Errorf("агент %q не найден в реестре (%s)", c.Agents[0], agentNames(agents))
	}
	if c.DeployName != "" {
		return ColumnSpec{}, fmt.Errorf("цель деплоя %q не найдена в реестре (%s)", c.DeployName, deployNames(deploys))
	}
	c.Property = strings.TrimSpace(c.Property)
	c.Column = strings.TrimSpace(c.Column)
	if c.Column == "" {
		return ColumnSpec{}, fmt.Errorf("не указана колонка")
	}
	if c.Property == "" {
		return ColumnSpec{}, fmt.Errorf("не указано свойство колонки %q", c.Column)
	}
	c.Action = strings.TrimSpace(c.Action)
	if c.Action == "" {
		c.Action = FlowActionNone
	}
	switch c.Action {
	case FlowActionNone, FlowActionAgent, FlowActionDeploy, FlowActionTest:
	default:
		return ColumnSpec{}, fmt.Errorf("неизвестное действие %q у колонки %q", c.Action, c.Column)
	}

	roster := make([]string, 0, len(c.AgentIDs))
	seen := make(map[string]bool, len(c.AgentIDs))
	for _, id := range c.AgentIDs {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		if _, ok := agentByID(agents, id); !ok {
			return ColumnSpec{}, fmt.Errorf("колонка %q ссылается на агента, которого нет в реестре (есть: %s)", c.Column, agentNames(agents))
		}
		seen[id] = true
		roster = append(roster, id)
	}
	c.AgentIDs = roster

	c.DeployID = strings.TrimSpace(c.DeployID)
	if c.DeployID != "" {
		if _, ok := deployByID(deploys, c.DeployID); !ok {
			return ColumnSpec{}, fmt.Errorf("колонка %q ссылается на цель деплоя, которой нет в реестре (есть: %s)", c.Column, deployNames(deploys))
		}
	}
	if c.MaxRunning < 0 {
		return ColumnSpec{}, fmt.Errorf("лимит одновременных сессий не может быть отрицательным")
	}
	servers, err := validateStageMCP(c.MCPServers)
	if err != nil {
		return ColumnSpec{}, fmt.Errorf("колонка %q: %w", c.Column, err)
	}
	c.MCPServers = servers
	return c, nil
}

// validateStageMCP checks the servers a column or a stage hands to its agent.
// The same rules an agent's own set is held to, plus one: the board's own
// server is in the file these are written into (boardtools.go), and a set that
// took its name would put out the tools a stage ends through — finish_work
// among them, so the route would never learn the stage was over.
func validateStageMCP(servers MCPServerSet) (MCPServerSet, error) {
	for name := range servers {
		if strings.EqualFold(strings.TrimSpace(name), boardmcp.ServerName) {
			return nil, fmt.Errorf("имя %q занято сервером доски", name)
		}
	}
	return validateMCPServers(servers)
}

// SaveColumn adds or replaces a column spec (matched by board+option, else by
// names) and persists the config.
func (m *Manager) SaveColumn(c ColumnSpec) (ColumnSpec, error) {
	m.listenBeforeSpeaking(c.BoardID)
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()

	c, err := validateColumn(c, m.cfg.Agents, m.cfg.Deploys)
	if err != nil {
		return ColumnSpec{}, err
	}
	for i, existing := range m.cfg.Columns {
		if sameColumn(existing, c) {
			m.cfg.Columns[i] = c
			return c, m.saveBoardsLocked(existing.BoardID, c.BoardID)
		}
	}
	m.cfg.Columns = append(m.cfg.Columns, c)
	return c, m.saveBoardsLocked(c.BoardID)
}

// RemoveColumn forgets a column's settings. The column itself stays on the
// board — only what happens in it goes away.
func (m *Manager) RemoveColumn(boardID, optionID, column string) error {
	m.listenBeforeSpeaking(boardID)
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	target := ColumnSpec{BoardID: boardID, OptionID: optionID, Column: column}
	for i, existing := range m.cfg.Columns {
		if sameColumn(existing, target) {
			m.cfg.Columns = append(m.cfg.Columns[:i], m.cfg.Columns[i+1:]...)
			return m.saveBoardsLocked(existing.BoardID, boardID)
		}
	}
	return fmt.Errorf("настройки колонки не найдены")
}

// sameColumn reports whether two specs describe one column: the same option of
// the same board, or — for a spec that has no ids yet — the same name.
func sameColumn(a, b ColumnSpec) bool {
	if a.OptionID != "" && b.OptionID != "" {
		return a.OptionID == b.OptionID && a.BoardID == b.BoardID
	}
	return strings.EqualFold(a.Column, b.Column) &&
		(a.BoardID == b.BoardID || a.BoardID == "" || b.BoardID == "")
}

// errStageBusy is not a failure: the column's crew is fully occupied, so the
// card waits for a free member instead of taking its failure branch.
var errStageBusy = errors.New("состав колонки занят")
