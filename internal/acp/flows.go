package acp

import (
	"fmt"
	"strings"
)

// A flow is the route a card takes across the board: a graph of nodes (a column
// plus what runs when a card lands in it) and edges (which event moves the card
// on, and where). Several routes coexist — not every task is deployed — so a
// flow is a named registry entry a card is matched to, exactly like the folder,
// agent and deploy-target registries.
//
// The set of edge triggers is closed and implemented in Go (see FlowTriggers):
// the graph says *what* connects to what, the code decides *when*. Nothing in
// the config is interpreted as a script.

// Node actions: what runs when a card enters the node.
const (
	FlowActionNone   = "none"   // nothing runs; the card waits for an event
	FlowActionAgent  = "agent"  // an ordinary agent session on the card task
	FlowActionDeploy = "deploy" // a deploy session (Dokku)
	FlowActionTest   = "test"   // a browser test session against the preview
)

// Edge triggers. The outcome ones are produced by the node's own action; the
// rest come from the VCS watcher.
const (
	TriggerSuccess = "success"
	TriggerFailure = "failure"
	TriggerBlocked = "blocked"

	TriggerBranchPushed = "branch.pushed"
	TriggerBranchMerged = "branch.merged"

	TriggerPROpened       = "pr.opened"
	TriggerPRMerged       = "pr.merged"
	TriggerPRClosed       = "pr.closed"
	TriggerReviewApproved = "review.approved"
	TriggerChecksPassed   = "checks.passed"
	TriggerChecksFailed   = "checks.failed"

	// TriggerCardChanged fires when a select option is set on the card while it
	// stands on the stage — a person marking «Одобрено», say. Which option is
	// the edge's own condition (If), so the trigger kind stays closed and the
	// board decides only the vocabulary.
	TriggerCardChanged = "card.changed"
)

// Trigger sources, which decide who can produce an event and what the watcher
// has to poll for.
const (
	SourceOutcome = "outcome" // the node's own action finished
	SourceGit     = "git"     // local folder, no authentication
	SourceGitHub  = "github"  // GitHub API, needs a token for private repositories
	SourceBoard   = "board"   // the card itself changed; no polling, the board pushes
)

// FlowTrigger describes one edge trigger. The list doubles as the editor's
// dropdown, so the UI can never offer a trigger the engine does not implement.
type FlowTrigger struct {
	Kind   string `json:"kind"`
	Source string `json:"source"`
	Label  string `json:"label"`
}

// FlowTriggers is the closed set, in the order the editor shows them.
var FlowTriggers = []FlowTrigger{
	{Kind: TriggerSuccess, Source: SourceOutcome, Label: "шаг прошёл"},
	{Kind: TriggerFailure, Source: SourceOutcome, Label: "шаг упал"},
	{Kind: TriggerBlocked, Source: SourceOutcome, Label: "проверить не удалось"},
	{Kind: TriggerBranchPushed, Source: SourceGit, Label: "ветка запушена"},
	{Kind: TriggerBranchMerged, Source: SourceGit, Label: "ветка влита в основную"},
	{Kind: TriggerPROpened, Source: SourceGitHub, Label: "открыт pull request"},
	{Kind: TriggerPRMerged, Source: SourceGitHub, Label: "pull request смержен"},
	{Kind: TriggerPRClosed, Source: SourceGitHub, Label: "pull request закрыт"},
	{Kind: TriggerReviewApproved, Source: SourceGitHub, Label: "ревью одобрено"},
	{Kind: TriggerChecksPassed, Source: SourceGitHub, Label: "проверки прошли"},
	{Kind: TriggerChecksFailed, Source: SourceGitHub, Label: "проверки упали"},
	{Kind: TriggerCardChanged, Source: SourceBoard, Label: "на карточке выбрано"},
}

// FlowEntry is one named route in the registry.
type FlowEntry struct {
	// ID is what a card's place on its route points at. The name used to be the
	// key, so renaming a route lost the position of every card standing on it
	// (docs/model-graph.md, contradiction 4). Minted when a route without one is
	// first validated.
	ID   string `json:"id,omitempty"`
	Name string `json:"name"` // shown on screen; matches the card "Flow" option

	// BoardID is the board the route belongs to. A route that came from a
	// board's own settings carries it, so two boards can hold routes of the
	// same name and not see each other's. Empty means every board, which is
	// what a route configured before boards were told apart means.
	BoardID string `json:"boardId,omitempty"`

	// WorkspaceID ties the route to an entry of the folder registry, so a card
	// that only names its folder still finds its route. By id, like everything
	// else that points at a registry entry.
	WorkspaceID string `json:"workspaceId,omitempty"`
	// WorkdirName is what that used to be written as. Folded into WorkspaceID
	// once (bindrefs.go); never written back.
	WorkdirName string `json:"projectName,omitempty"`
	// Property is the select property whose options are the flow's columns.
	// Empty means Config.TriggerProperty.
	Property string `json:"property,omitempty"`

	Nodes []FlowNode `json:"nodes"`
	Edges []FlowEdge `json:"edges"`
}

// FlowNode is one stage of a route: the column a card stands in. What happens
// there is the column's business (see columns.go) — a stage only overrides what
// it names itself, which is how one column can behave differently in two routes.
type FlowNode struct {
	ID       string `json:"id"`                 // stable identifier, generated by the editor
	Column   string `json:"column"`             // option name on the board
	OptionID string `json:"optionId,omitempty"` // the option itself, so a rename changes nothing

	// Action overrides the column's. Empty means "whatever the column does";
	// "none" means the stage runs nothing and waits for an event.
	Action string `json:"action,omitempty"`

	// AgentIDs is the crew for this stage alone, overriding the column's.
	AgentIDs []string `json:"agentIds,omitempty"`
	// AgentNames and AgentName are what the crew used to be written as. Read on
	// load and folded into AgentIDs (bindrefs.go); never written back.
	AgentNames []string `json:"agentNames,omitempty"`
	AgentName  string   `json:"agentName,omitempty"`

	// DeployID overrides the column's deploy target for this stage, by the
	// registry entry's id rather than its name (contradiction 8).
	DeployID string `json:"deployId,omitempty"`
	// DeployName is what the override used to be written as. Read on load and
	// folded into DeployID (bindrefs.go); never written back.
	DeployName string `json:"deployName,omitempty"`

	// Prompt overrides the column's instructions for this stage alone
	// (ColumnSpec.Prompt). Empty inherits, exactly as Action and the crew do.
	Prompt string `json:"prompt,omitempty"`

	// Writes are the properties this stage leaves on the card — its declared
	// outputs, which is what makes a transition on a property deterministic:
	// an edge that reads «Вердикт» can point at the stage that must write it.
	// An agent stage delivers the values through finish_work and a required
	// one is refused without them; a deploy stage writes its preview URL into
	// each named property, a test stage its verdict. Empty inherits the
	// column's, exactly as the crew does.
	Writes []PropertyWrite `json:"writes,omitempty"`

	// Reads are the properties whose values open this stage's brief: what an
	// earlier stage wrote — the preview URL, the reviewer's verdict — handed
	// to the agent instead of hoping it asks get_card. Empty inherits.
	Reads []string `json:"reads,omitempty"`

	// MCPServers are the tools this stage hands to whoever works it, on top of
	// whatever that agent carries of its own. Empty inherits the column's
	// (ColumnSpec.MCPServers), exactly as the crew and the prompt do.
	MCPServers MCPServerSet `json:"mcpServers,omitempty"`

	// RunIn is where this stage's work happens: RunInOwner — the card's own
	// workspace, so the stage sees the card's branch; RunInWorkdir — the folder
	// itself, on whatever is checked out there.
	//
	// It exists because the answer is the board's to choose rather than ours:
	// checking a card's own code before anything is merged is a QA stage in the
	// card's workspace, and checking what was published is a QA stage in the
	// folder. Empty keeps the sensible default for the action (RunsIn).
	RunIn string `json:"runIn,omitempty"`

	// X and Y are where the builder left the stage on its canvas. Absent means
	// "lay it out for me" — a route written by hand never has to place anything.
	X float64 `json:"x,omitempty"`
	Y float64 `json:"y,omitempty"`
}

// PropertyWrite is one property a stage puts on the card: its name on the
// board, and whether the stage may finish without it. The value is not here —
// an agent supplies it through finish_work, and a machine stage (deploy, test)
// knows its own.
type PropertyWrite struct {
	Property string `json:"property"`
	Required bool   `json:"required,omitempty"`
}

// Where a stage's work happens.
const (
	// RunInOwner is the card's own workspace — its branch, its copy.
	RunInOwner = "owner"
	// RunInWorkdir is the folder itself, whatever is checked out there.
	RunInWorkdir = "workdir"
)

// RunsIn is where this stage runs, with the default for its action filled in.
// The defaults are what the code did before the field existed: an agent writes
// code, so it works in the card's own workspace; a deploy publishes a branch
// that already exists and a test drives a browser against something already
// published, so neither needs a checkout of the card's.
func (n FlowNode) RunsIn(action string) string {
	switch strings.ToLower(strings.TrimSpace(n.RunIn)) {
	case RunInOwner:
		return RunInOwner
	case RunInWorkdir:
		return RunInWorkdir
	}
	if action == FlowActionDeploy || action == FlowActionTest {
		return RunInWorkdir
	}
	return RunInOwner
}

// Crew is the agents this stage may run on, if it names any — registry ids.
func (n FlowNode) Crew() []string { return n.AgentIDs }

// asColumn is the stage's column in the shape the column registry matches.
func (n FlowNode) asColumn(property string) Column {
	return Column{PropertyName: property, Name: n.Column, OptionID: n.OptionID}
}

// FlowEdge is one transition. On is a FlowTrigger kind; success/failure are the
// node's own outcomes, which the editor shows as the node's two outputs.
type FlowEdge struct {
	From string `json:"from"`
	To   string `json:"to"`
	On   string `json:"on"`

	// If makes the transition conditional. Several conditional edges may share
	// one (From, On) — the first whose condition holds wins, and an edge with
	// no condition is the fallback. For TriggerCardChanged the condition is not
	// a guard but the event itself: which option firing it means.
	If *EdgeCond `json:"if,omitempty"`
}

// EdgeCond is what a conditional transition asks about, in exactly one of two
// forms. Both are questions about the card, not scripts: a select property
// having a value, or the words the stage's own agent signed off with.
type EdgeCond struct {
	// Property/Value: the card's select property carries this option.
	Property string `json:"property,omitempty"`
	Value    string `json:"value,omitempty"`

	// CommentContains: the agent's closing comment contains this text — how a
	// stage lets the agent itself route the card («READY TO DEPLOY»).
	CommentContains string `json:"commentContains,omitempty"`
}

// holds evaluates the condition against the card and, for the comment form,
// the agent's closing words. A nil condition always holds — an unconditional
// edge is the fallback.
func (c *EdgeCond) holds(props map[string]string, agentText string) bool {
	if c == nil {
		return true
	}
	if c.CommentContains != "" {
		return containsFold(agentText, c.CommentContains)
	}
	got := props[strings.ToLower(strings.TrimSpace(c.Property))]
	return strings.EqualFold(strings.TrimSpace(got), strings.TrimSpace(c.Value))
}

// Describe is the condition in the reader's language, for edge labels and card
// comments.
func (c *EdgeCond) Describe() string {
	if c == nil {
		return ""
	}
	if c.CommentContains != "" {
		return fmt.Sprintf("в ответе агента есть «%s»", c.CommentContains)
	}
	return fmt.Sprintf("«%s» = «%s»", c.Property, c.Value)
}

func containsFold(haystack, needle string) bool {
	return strings.Contains(strings.ToLower(haystack), strings.ToLower(needle))
}

// Trigger looks a trigger kind up in the closed set.
func Trigger(kind string) (FlowTrigger, bool) {
	for _, t := range FlowTriggers {
		if t.Kind == kind {
			return t, true
		}
	}
	return FlowTrigger{}, false
}

// TriggerLabel is the human phrasing used in card comments.
func TriggerLabel(kind string) string {
	if t, ok := Trigger(kind); ok {
		return t.Label
	}
	return kind
}

// IsVCSTrigger reports whether the trigger comes from the folder — the ones
// the watcher has to poll for. Board triggers are pushed, not polled, so they
// are deliberately not here.
func IsVCSTrigger(kind string) bool {
	t, ok := Trigger(kind)
	return ok && (t.Source == SourceGit || t.Source == SourceGitHub)
}

// IsGitHubTrigger reports whether the trigger needs the GitHub API.
func IsGitHubTrigger(kind string) bool {
	t, ok := Trigger(kind)
	return ok && t.Source == SourceGitHub
}

// Node returns the node with the given id.
func (f FlowEntry) Node(id string) (FlowNode, bool) {
	for _, n := range f.Nodes {
		if n.ID == id {
			return n, true
		}
	}
	return FlowNode{}, false
}

// NodeByColumn returns the node sitting on a column, matched the way every
// other column comparison in the package is: case-insensitively.
func (f FlowEntry) NodeByColumn(column string) (FlowNode, bool) {
	column = strings.TrimSpace(column)
	if column == "" {
		return FlowNode{}, false
	}
	for _, n := range f.Nodes {
		if strings.EqualFold(n.Column, column) {
			return n, true
		}
	}
	return FlowNode{}, false
}

// Next returns the node an event moves the card to: among the edges for this
// event, the first whose condition holds against the card — and an edge with no
// condition holds always, which makes it the fallback however the editor
// ordered it.
func (f FlowEntry) Next(nodeID, on string, props map[string]string, agentText string) (FlowNode, *EdgeCond, bool) {
	var fallback *FlowEdge
	for i, e := range f.Edges {
		if e.From != nodeID || e.On != on {
			continue
		}
		if e.If == nil {
			if fallback == nil {
				fallback = &f.Edges[i]
			}
			continue
		}
		if e.If.holds(props, agentText) {
			node, ok := f.Node(e.To)
			return node, e.If, ok
		}
	}
	if fallback != nil {
		node, ok := f.Node(fallback.To)
		return node, nil, ok
	}
	return FlowNode{}, nil, false
}

// HasEdge reports whether the node has any transition for an event at all —
// what "this stage listens for X" means, before any condition is asked.
func (f FlowEntry) HasEdge(nodeID, on string) bool {
	for _, e := range f.Edges {
		if e.From == nodeID && e.On == on {
			return true
		}
	}
	return false
}

// WaitsFor lists the VCS triggers a node has edges for. An empty result means
// the card parked on this node needs no polling at all.
func (f FlowEntry) WaitsFor(nodeID string) []string {
	var out []string
	for _, e := range f.Edges {
		if e.From == nodeID && IsVCSTrigger(e.On) {
			out = append(out, e.On)
		}
	}
	return out
}

// WaitDescriptions is what a parked card says it is waiting on, conditions
// included — «на карточке выбрано «Одобрено» = «Да»», not just the kind.
func (f FlowEntry) WaitDescriptions(nodeID string) []string {
	var out []string
	for _, e := range f.Edges {
		if e.From != nodeID || e.On == TriggerSuccess || e.On == TriggerFailure || e.On == TriggerBlocked {
			continue
		}
		label := TriggerLabel(e.On)
		if desc := e.If.Describe(); desc != "" {
			label += " " + desc
		}
		out = append(out, label)
	}
	return out
}

// PropertyOr returns the select property the flow's columns belong to.
func (f FlowEntry) PropertyOr(fallback string) string {
	if p := strings.TrimSpace(f.Property); p != "" {
		return p
	}
	return fallback
}

// Flows returns a snapshot of the registry.
func (m *Manager) Flows() []FlowEntry {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	return append([]FlowEntry(nil), m.cfg.Flows...)
}

// BoardFlows returns the routes a board may use: its own, plus those tied to no
// board in particular. It is what the editor lists, so one board never offers
// another's routes.
func (m *Manager) BoardFlows(boardID string) []FlowEntry {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	return boardFlows(m.cfg.Flows, boardID)
}

func boardFlows(flows []FlowEntry, boardID string) []FlowEntry {
	out := make([]FlowEntry, 0, len(flows))
	for _, f := range flows {
		if f.BoardID == "" || boardID == "" || f.BoardID == boardID {
			out = append(out, f)
		}
	}
	return out
}

// validateFlow normalizes and checks one route. folders/agents/deploys are the
// registries its nodes may reference.
func validateFlow(f FlowEntry, workdirs []WorkdirEntry, agents []AgentEntry, deploys []DeployEntry) (FlowEntry, error) {
	// See validateColumn: names in, ids stored, and a name that folds into
	// nothing is refused here so the board keeps its own copy untouched.
	bindFlowRefs(&f, agents, deploys)
	bindFlowWorkspace(&f, workdirs)
	for _, n := range f.Nodes {
		if len(n.AgentNames) > 0 {
			return FlowEntry{}, fmt.Errorf("агент %q стадии %q не найден в реестре (%s)", n.AgentNames[0], n.ID, agentNames(agents))
		}
		if n.DeployName != "" {
			return FlowEntry{}, fmt.Errorf("цель деплоя %q стадии %q не найдена в реестре (%s)", n.DeployName, n.ID, deployNames(deploys))
		}
	}
	f.Name = strings.TrimSpace(f.Name)
	if f.Name == "" {
		return FlowEntry{}, fmt.Errorf("имя флоу не может быть пустым")
	}
	// A route with no id gets one here, which is the moment it becomes a thing
	// a card can point at.
	if strings.TrimSpace(f.ID) == "" {
		f.ID = newID()
	}
	if f.WorkspaceID != "" {
		if _, ok := workdirByID(workdirs, f.WorkspaceID); !ok {
			return FlowEntry{}, fmt.Errorf("маршрут %q ссылается на папку, которой нет в реестре (%s)", f.Name, workdirNames(workdirs))
		}
	}
	if f.WorkdirName != "" {
		return FlowEntry{}, fmt.Errorf("папка %q не найдена в реестре (%s)", f.WorkdirName, workdirNames(workdirs))
	}
	f.Property = strings.TrimSpace(f.Property)
	if len(f.Nodes) == 0 {
		return FlowEntry{}, fmt.Errorf("флоу %q не содержит ни одной стадии", f.Name)
	}

	seenID := make(map[string]bool, len(f.Nodes))
	seenColumn := make(map[string]bool, len(f.Nodes))
	for i, n := range f.Nodes {
		n.ID = strings.TrimSpace(n.ID)
		n.Column = strings.TrimSpace(n.Column)
		// An empty action is not "nothing": it means the stage does whatever
		// its column does. "none" is how a stage says it runs nothing at all.
		n.Action = strings.TrimSpace(n.Action)
		if n.ID == "" {
			return FlowEntry{}, fmt.Errorf("у стадии %d нет идентификатора", i+1)
		}
		if seenID[n.ID] {
			return FlowEntry{}, fmt.Errorf("идентификатор стадии %q встречается дважды", n.ID)
		}
		if n.Column == "" {
			return FlowEntry{}, fmt.Errorf("у стадии %q не выбрана колонка", n.ID)
		}
		lower := strings.ToLower(n.Column)
		if seenColumn[lower] {
			return FlowEntry{}, fmt.Errorf("колонка %q занята двумя стадиями — карточка не сможет понять, где она", n.Column)
		}
		switch n.Action {
		case "", FlowActionNone, FlowActionAgent, FlowActionDeploy, FlowActionTest:
		default:
			return FlowEntry{}, fmt.Errorf("неизвестное действие %q у стадии %q", n.Action, n.ID)
		}

		crew := n.AgentIDs
		n.AgentIDs = nil
		seenAgent := make(map[string]bool, len(crew))
		for _, id := range crew {
			id = strings.TrimSpace(id)
			if id == "" || seenAgent[id] {
				continue
			}
			if _, ok := agentByID(agents, id); !ok {
				return FlowEntry{}, fmt.Errorf("стадия %q ссылается на агента, которого нет в реестре (есть: %s)", n.ID, agentNames(agents))
			}
			seenAgent[id] = true
			n.AgentIDs = append(n.AgentIDs, id)
		}
		n.DeployID = strings.TrimSpace(n.DeployID)
		if n.DeployID != "" {
			if _, ok := deployByID(deploys, n.DeployID); !ok {
				return FlowEntry{}, fmt.Errorf("стадия %q ссылается на цель деплоя, которой нет в реестре (есть: %s)", n.ID, deployNames(deploys))
			}
		}
		servers, err := validateStageMCP(n.MCPServers)
		if err != nil {
			return FlowEntry{}, fmt.Errorf("стадия %q: %w", n.Column, err)
		}
		n.MCPServers = servers
		seenID[n.ID] = true
		seenColumn[lower] = true
		f.Nodes[i] = n
	}

	// Several conditional edges may share one (from, on) — the conditions tell
	// them apart. What stays ambiguous, and refused, is two edges with nothing
	// to tell them apart: two unconditional ones.
	seenFallback := make(map[string]bool, len(f.Edges))
	for i, e := range f.Edges {
		e.From = strings.TrimSpace(e.From)
		e.To = strings.TrimSpace(e.To)
		e.On = strings.TrimSpace(e.On)
		if !seenID[e.From] {
			return FlowEntry{}, fmt.Errorf("переход ведёт из несуществующей стадии %q", e.From)
		}
		if !seenID[e.To] {
			return FlowEntry{}, fmt.Errorf("переход из %q ведёт в несуществующую стадию %q", e.From, e.To)
		}
		trigger, ok := Trigger(e.On)
		if !ok {
			return FlowEntry{}, fmt.Errorf("неизвестное событие перехода %q", e.On)
		}
		if e.If != nil {
			cond, err := validateEdgeCond(*e.If, trigger)
			if err != nil {
				return FlowEntry{}, fmt.Errorf("переход по событию %q: %w", TriggerLabel(e.On), err)
			}
			e.If = &cond
		}
		if e.On == TriggerCardChanged && e.If == nil {
			return FlowEntry{}, fmt.Errorf("переход «%s» должен говорить, какая опция его запускает", TriggerLabel(e.On))
		}
		if e.If == nil {
			key := e.From + "|" + e.On
			if seenFallback[key] {
				return FlowEntry{}, fmt.Errorf("у стадии %q два перехода по событию %q без условий — куда ехать, непонятно", e.From, TriggerLabel(e.On))
			}
			seenFallback[key] = true
		}
		f.Edges[i] = e
	}
	return f, nil
}

// validateEdgeCond normalizes one condition and checks it makes sense on its
// trigger: the agent's words exist only where an agent just spoke — on the
// stage's own outcome.
func validateEdgeCond(c EdgeCond, trigger FlowTrigger) (EdgeCond, error) {
	c.Property = strings.TrimSpace(c.Property)
	c.Value = strings.TrimSpace(c.Value)
	c.CommentContains = strings.TrimSpace(c.CommentContains)

	hasProp := c.Property != "" || c.Value != ""
	hasComment := c.CommentContains != ""
	switch {
	case hasProp && hasComment:
		return EdgeCond{}, fmt.Errorf("условие либо про свойство карточки, либо про ответ агента — не оба сразу")
	case !hasProp && !hasComment:
		return EdgeCond{}, fmt.Errorf("пустое условие")
	case hasProp && (c.Property == "" || c.Value == ""):
		return EdgeCond{}, fmt.Errorf("условию нужны и свойство, и значение")
	case hasComment && trigger.Source != SourceOutcome:
		return EdgeCond{}, fmt.Errorf("условие про ответ агента возможно только на исходе шага — здесь агент ничего не говорил")
	}
	return c, nil
}

// sameFlow reports whether two entries are one route of the registry: the same
// id, or — for an entry that has none yet — the same name on the same board.
// This is the predicate every edit is keyed on, which is what lets two boards
// each have their own «Фича», and what makes renaming one an edit rather than a
// lookup that fails (contradiction 4).
func sameFlow(a, b FlowEntry) bool {
	if a.ID != "" && b.ID != "" {
		return a.ID == b.ID
	}
	return strings.EqualFold(strings.TrimSpace(a.Name), strings.TrimSpace(b.Name)) &&
		(a.BoardID == b.BoardID || a.BoardID == "" || b.BoardID == "")
}

// AddFlow registers a new route and persists the config.
func (m *Manager) AddFlow(f FlowEntry) (FlowEntry, error) {
	m.listenBeforeSpeaking(f.BoardID)
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	f, err := validateFlow(f, m.cfg.Workdirs, m.cfg.Agents, m.cfg.Deploys)
	if err != nil {
		return FlowEntry{}, err
	}
	// By id, and by name as well: validateFlow has just minted an id for a new
	// route, so an id comparison alone would never see the collision the name
	// check is here for.
	for _, e := range m.cfg.Flows {
		if sameFlow(e, f) || flowNameTaken(e, f) {
			return FlowEntry{}, fmt.Errorf("флоу с именем %q уже существует", e.Name)
		}
	}
	m.cfg.Flows = append(m.cfg.Flows, f)
	return f, m.saveBoardsLocked(f.BoardID)
}

// UpdateFlow replaces an existing route (matched by board and name) and
// persists.
func (m *Manager) UpdateFlow(f FlowEntry) (FlowEntry, error) {
	m.listenBeforeSpeaking(f.BoardID)
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	f, err := validateFlow(f, m.cfg.Workdirs, m.cfg.Agents, m.cfg.Deploys)
	if err != nil {
		return FlowEntry{}, err
	}
	for i, e := range m.cfg.Flows {
		if !sameFlow(e, f) {
			continue
		}
		if !strings.EqualFold(e.Name, f.Name) {
			for _, other := range m.cfg.Flows {
				if !sameFlow(other, f) && flowNameTaken(other, f) {
					return FlowEntry{}, fmt.Errorf("флоу с именем %q уже существует", other.Name)
				}
			}
		}
		// The board it belongs to is the editor's to state: a route the
		// registry held for every board becomes this board's own the moment
		// this board edits it, and the other boards keep what they had.
		f.ID = e.ID
		m.cfg.Flows[i] = f
		return f, m.saveBoardsLocked(e.BoardID, f.BoardID)
	}
	return FlowEntry{}, fmt.Errorf("флоу %q не найден", f.Name)
}

// RemoveFlow deletes a board's route by name and persists. Cards currently on
// it stop moving by themselves; nothing else happens to them.
func (m *Manager) RemoveFlow(boardID, flowID string) error {
	m.listenBeforeSpeaking(boardID)
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	// By id: a route being deleted is one somebody is looking at, and looking
	// at it is how they got the id. A name would find whichever route currently
	// answers to it, which is not necessarily the one on screen.
	target := FlowEntry{BoardID: boardID, ID: strings.TrimSpace(flowID)}
	for i, e := range m.cfg.Flows {
		if sameFlow(e, target) {
			m.cfg.Flows = append(m.cfg.Flows[:i], m.cfg.Flows[i+1:]...)
			return m.saveBoardsLocked(e.BoardID, boardID)
		}
	}
	return fmt.Errorf("маршрут не найден")
}

// resolveFlow maps a card to its route. Priority mirrors every other registry:
//  1. a "flow" property or a select option naming an entry;
//  2. the flow tied to the folder the card resolved to;
//  3. the single registered flow.
//
// Nothing matched is not an error: the card simply has no route, and the legacy
// trigger columns keep working for it.
func (m *Manager) resolveFlow(ev CardMoved, workdirPath string) *FlowEntry {
	m.cfgMu.RLock()
	flows := boardFlows(m.cfg.Flows, ev.BoardID)
	workdirs := append([]WorkdirEntry(nil), m.cfg.Workdirs...)
	m.cfgMu.RUnlock()

	if len(flows) == 0 {
		return nil
	}
	find := func(name string) *FlowEntry {
		for i := range flows {
			if strings.EqualFold(strings.TrimSpace(name), flows[i].Name) {
				return &flows[i]
			}
		}
		return nil
	}
	if explicit := strings.TrimSpace(ev.Props["flow"]); explicit != "" {
		if f := find(explicit); f != nil {
			return f
		}
	}
	for _, opt := range ev.OptionNames {
		if f := find(opt); f != nil {
			return f
		}
	}
	// The folder the card resolved to, by the id the route records for it.
	if w, ok := workdirForPath(workdirs, workdirPath); ok {
		for i := range flows {
			if flows[i].WorkspaceID != "" && flows[i].WorkspaceID == w.ID {
				return &flows[i]
			}
		}
	}
	if len(flows) == 1 {
		return &flows[0]
	}
	return nil
}

// FlowByID returns a registered route. Cards point at a route by id, so this is
// what every reader asks; the name answers nothing any more.
func (m *Manager) FlowByID(id string) (FlowEntry, bool) {
	id = strings.TrimSpace(id)
	if id == "" {
		return FlowEntry{}, false
	}
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	for _, f := range m.cfg.Flows {
		if f.ID == id {
			return f, true
		}
	}
	return FlowEntry{}, false
}

// FlowByName is how a person's own words reach a route — a card naming its
// route with an option, and the editor. It is not how a card's position is
// resolved: that is FlowByID.
func (m *Manager) FlowByName(name string) (FlowEntry, bool) {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	for _, f := range m.cfg.Flows {
		if strings.EqualFold(f.Name, name) {
			return f, true
		}
	}
	return FlowEntry{}, false
}

func hasWorkdir(workdirs []WorkdirEntry, name string) bool {
	for _, r := range workdirs {
		if strings.EqualFold(r.Name, name) {
			return true
		}
	}
	return false
}

func hasAgent(agents []AgentEntry, name string) bool {
	for _, a := range agents {
		if strings.EqualFold(a.Name, name) {
			return true
		}
	}
	return false
}


// flowNameTaken reports whether an existing route already goes by this name on
// a board that would see it. Names stay unique because a card names its route
// with an option a person picks, and two routes called one thing is a question
// nobody can answer.
func flowNameTaken(existing, edit FlowEntry) bool {
	return strings.EqualFold(strings.TrimSpace(existing.Name), strings.TrimSpace(edit.Name)) &&
		(existing.BoardID == edit.BoardID || existing.BoardID == "" || edit.BoardID == "")
}
