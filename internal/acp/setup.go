package acp

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// A board arrives knowing how the work on it is organised. What it cannot know
// is the machine: which agent runs, in which folder, where it publishes, what
// it drives a browser with. The setup wizard asks for that — and *what* it asks
// is the board's business, because a board of household chores has nowhere to
// deploy to and nothing to test, and an unanswerable question reads as a broken
// feature.
//
// So the steps are a plan, resolved here, out of three things:
//
//   - what the board asks for, in a property of its own (BoardPropSetup), the
//     way it already carries its columns and its routes;
//   - failing that, what its automation implies — a board that runs a deploy
//     needs somewhere to deploy to;
//   - and what this machine already has, so a question already answered is not
//     asked again.
//
// The steps themselves are a closed set implemented here, exactly like
// FlowTriggers: a board picks from it and cannot invent one. A board that could
// declare arbitrary fields would be a program, and nothing on this side could
// promise the answer fits the registry it is going into.

// Setup step kinds.
const (
	// SetupStepName is the board's own name, and the one step that asks about
	// the board rather than about this machine. It is first and it is not
	// optional: a board arrives called what its template is called, so the
	// second one made from «Разработка» is a second «Разработка» in the
	// sidebar, and the moment to say what this one is for is the moment it is
	// made.
	SetupStepName    = "name"
	SetupStepWorkdir = "project" // a folder on this machine an agent works in
	SetupStepAgent   = "agent"   // the agent that picks a card up
	SetupStepDeploy  = "deploy"  // a Dokku host to publish a branch to
	SetupStepBrowser = "browser" // the MCP server a test session drives
	SetupStepSource  = "source"  // what puts cards on the board by itself
	SetupStepDone    = "done"    // no question: how to use what was set up
)

// Setup step status.
const (
	SetupPending = "pending" // still to be answered
	SetupDone    = "done"    // answered, or already true of this machine
	SetupSkipped = "skipped" // deliberately passed over
)

// setupWizardStep is not a step: it is the row that remembers the wizard itself
// was offered for a board. It lives in the same table because it is the same
// kind of fact — something this machine knows about this board — and it cannot
// live in the page, where localStorage is keyed by origin and the desktop app
// takes a fresh port (and therefore a fresh origin) on every launch, so a
// refusal lasted exactly one run.
const setupWizardStep = "wizard"

// Setup requirements: what an answer to a step has to satisfy on this machine.
// A closed set like the steps themselves, and derived from what the board's
// automation actually does rather than named by anybody: a board that publishes
// a branch or waits for one needs a folder under git, and a board that does
// neither must not be asked to make its folder of notes into a repository.
const (
	SetupRequiresGit = "git"
)

// SetupStepDef describes one step the app can actually carry out. The list
// doubles as the wizard's shape, so the UI can never offer a step there is no
// registry behind.
type SetupStepDef struct {
	Kind string `json:"kind"`
	// Registry the step fills, and therefore what makes it already answered.
	// Empty for a step that asks nothing.
	Registry string `json:"registry,omitempty"`
	// Optional says the step may be passed over — everything else on the board
	// still works without it.
	Optional bool `json:"optional"`
}

// SetupStepDefs is the closed set, in the order a wizard walks them. The order
// is the order the work needs them in: an agent has nowhere to work without a
// folder, and neither publishing nor testing means anything without an agent.
var SetupStepDefs = []SetupStepDef{
	// No registry: what answers it is the board itself, so there is nothing on
	// this machine that could have answered it already.
	{Kind: SetupStepName},
	{Kind: SetupStepWorkdir, Registry: "projects"},
	{Kind: SetupStepAgent, Registry: "agents"},
	{Kind: SetupStepDeploy, Registry: "deploys", Optional: true},
	{Kind: SetupStepBrowser, Registry: "agentMCP", Optional: true},
	// A source is nobody's prerequisite — it feeds the board rather than works
	// on it — so it comes last of the questions. It is never inferred either:
	// no arrangement of columns implies that cards should arrive by themselves,
	// so only a board that asks for it in acpSetup is asked.
	{Kind: SetupStepSource, Registry: "sources", Optional: true},
	{Kind: SetupStepDone},
}

// SetupStepDefinition returns the definition of a kind, if the app has one.
func SetupStepDefinition(kind string) (SetupStepDef, bool) {
	for _, def := range SetupStepDefs {
		if strings.EqualFold(def.Kind, kind) {
			return def, true
		}
	}
	return SetupStepDef{}, false
}

// BoardSetup is what a board asks to be asked, in its own property. Only the
// kinds and their order are the board's to choose; what each one does is this
// side's.
type BoardSetup struct {
	Steps []BoardSetupStep `json:"steps"`
}

// BoardSetupStep is one entry of that list.
type BoardSetupStep struct {
	Kind string `json:"kind"`
	// Hint is a sentence of the board's own, shown beside the step's usual
	// explanation — "the folder with your household notes", say. It is text and
	// nothing else: a board cannot describe a field, only comment on one.
	Hint string `json:"hint,omitempty"`
	// Required overrides an optional step for this board: a board whose route
	// deploys cannot be set up without somewhere to deploy to.
	Required bool `json:"required,omitempty"`
}

// SetupStep is one resolved step: what to ask, whether it may be skipped, and
// whether it still needs asking at all.
type SetupStep struct {
	Kind     string `json:"kind"`
	Optional bool   `json:"optional"`
	Hint     string `json:"hint,omitempty"`
	Status   string `json:"status"`
	// Ready says this machine can already answer the step, however this board
	// has answered it — see registryFilled.
	Ready bool `json:"ready"`
	// Requires is what an answer has to satisfy — the closed set above. It is
	// carried in the plan so the question can say so before it is answered,
	// and enforced by CheckSetupAnswer when it is.
	Requires []string `json:"requires,omitempty"`
}

// SetupPlan is the whole answer to "what should this board ask for".
type SetupPlan struct {
	BoardID string      `json:"boardId"`
	Steps   []SetupStep `json:"steps"`
	// Declared says the board named these steps itself. When it did not, they
	// were worked out from the automation it carries — which is a guess, and
	// the difference is worth keeping visible.
	Declared bool `json:"declared"`
	// Automated says the board brings columns or routes of its own. A board
	// that brings none is not one the wizard should open itself for; it can
	// still be walked through from the menu.
	Automated bool `json:"automated"`
	// AgentColumn is the column a card is dragged into to be worked on — the
	// one thing every board has and every board names differently, and the last
	// thing the wizard has to say.
	AgentColumn string `json:"agentColumn,omitempty"`
	// TestColumn is the column that tests, as this board calls it. The QA step
	// names an agent for it, so the question can say which column it is about
	// and the answer knows where to write the crew.
	TestColumn string `json:"testColumn,omitempty"`
	// WorkAgents is who already works this board's cards — the crew of its
	// agent stages, when they agree on one. The step that asks reads it back so
	// a wizard walked a second time opens on the answer it was given, rather
	// than showing nobody chosen over a column that has somebody.
	WorkAgents []string `json:"workAgents,omitempty"`
	// Offered says the wizard has already opened itself for this board once.
	// Closing it half-way answers nothing, but it is still an answer to "have
	// you seen this?", and asking again on every launch is how a dialog becomes
	// something people close on reflex.
	Offered bool `json:"offered"`
}

// SetupStepState is what a person did with a step, remembered per board.
type SetupStepState struct {
	BoardID string
	Step    string
	Status  string
	At      time.Time
}

// SetupPlanFor resolves the plan for a board. It reads the board (for what it
// asks and what it runs), the registries (for what is already answered) and the
// store (for what was skipped).
func (m *Manager) SetupPlanFor(boardID string) SetupPlan {
	plan := SetupPlan{BoardID: boardID}

	// A template is not a board being run, it is a board being written: what a
	// copy of it will need depends on the copy, and the wizard would be asking
	// about a board that does not exist yet. Nothing to set up, so nothing is
	// asked and nothing opens by itself.
	if m.isBoardTemplate(boardID) {
		return plan
	}

	declared, columns, flows := m.boardSetupSources(boardID)
	plan.Automated = len(columns) > 0 || len(flows) > 0

	steps := setupSteps(declared, columns, flows)
	plan.Declared = len(declared.Steps) > 0

	plan.AgentColumn = columnOfAction(columns, FlowActionAgent)
	plan.TestColumn = columnOfAction(columns, FlowActionTest)
	plan.WorkAgents = crewOfAction(columns, FlowActionAgent)
	states := m.setupStates(boardID)
	plan.Offered = states[setupWizardStep] != ""
	for _, step := range steps {
		def, ok := SetupStepDefinition(step.Kind)
		if !ok {
			// A board asking for something this build cannot do is not an
			// error: the app is older (or newer) than the board, and the rest
			// of the plan is still worth walking.
			m.log.Warn("acp: the board asks for a setup step that does not exist", "board", boardID, "step", step.Kind)
			continue
		}
		optional := def.Optional && !step.Required
		plan.Steps = append(plan.Steps, SetupStep{
			Kind:     def.Kind,
			Optional: optional,
			Hint:     currentHint(step.Hint),
			Status:   m.setupStatus(def, states),
			Ready:    def.Registry != "" && m.registryFilled(def.Registry, columns, flows),
			Requires: setupRequirements(def.Kind, columns, flows),
		})
	}
	return plan
}

// retiredHints are sentences the templates shipped and no longer say. A board
// made from a template carries its own copy of them, so a wording fixed in the
// template would go on being wrong on every board already made — and this is
// the app's own sentence, not a person's, exactly as the name of a field this
// app creates is. Matched whole, so a hint somebody edited is theirs and stays.
//
// Deletable once boards made before the wording changed are gone; each entry
// says what it was fixing.
var retiredHints = map[string]string{
	// Said what the machinery does («в отдельном worktree»), and how a
	// repository is worked in is now the board's own answer rather than a fact
	// about the step. What the step needs to know is what to point at.
	"Репозиторий с кодом: агент работает в отдельном worktree и оставляет ветку.": "Папка с файлами по проекту или git-репозиторий",
}

func currentHint(hint string) string {
	hint = strings.TrimSpace(hint)
	if current, ok := retiredHints[hint]; ok {
		return current
	}
	return hint
}

// boardSetupSources reads the three properties a template writes: what it asks
// to be asked, and the automation the question would otherwise be inferred from.
func (m *Manager) boardSetupSources(boardID string) (BoardSetup, []ColumnSpec, []FlowEntry) {
	// What this board runs is what this board says it runs — its own registry
	// entries, or the automation it still carries in its properties. The
	// machine-wide entries (the ones migrated from the old config keys, which
	// name no board at all) are deliberately not read here: they describe a
	// board that deploys and tests, and reading them made every board ask for a
	// folder under git, including one whose whole job is a shopping list.
	columns, flows := m.boardOwnAutomation(boardID)

	var declared BoardSetup
	props := m.boardProperties(boardID)
	if raw, ok := boardProp(props, BoardPropSetup); ok {
		if err := reinterpret(raw, &declared); err != nil {
			m.log.Warn("acp: the board's setup steps are unreadable", "board", boardID, "err", err)
			declared = BoardSetup{}
		}
	}
	if len(columns) == 0 && len(flows) == 0 {
		// Nothing has been taken into the registry yet — read what the board
		// itself carries, which is what the first card move would adopt.
		boardColumns, boardFlows, err := parseBoardAutomation(props)
		if err != nil {
			m.log.Warn("acp: the board's own settings are unreadable", "board", boardID, "err", err)
		} else {
			columns, flows = boardColumns, boardFlows
		}
	}
	if len(columns) == 0 && len(flows) == 0 {
		// A board that brings nothing of its own is run by whatever the machine
		// is configured with, so that is what it has to be set up for.
		columns, flows = m.BoardColumns(boardID), m.BoardFlows(boardID)
	}
	return declared, columns, flows
}

// boardOwnAutomation is the registry filtered to entries tagged with this board
// — what was taken from the board itself, and nothing that merely applies to
// every board.
func (m *Manager) boardOwnAutomation(boardID string) ([]ColumnSpec, []FlowEntry) {
	if boardID == "" {
		return nil, nil
	}
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	var columns []ColumnSpec
	for _, c := range m.cfg.Columns {
		if c.BoardID == boardID {
			columns = append(columns, c)
		}
	}
	var flows []FlowEntry
	for _, f := range m.cfg.Flows {
		if f.BoardID == boardID {
			flows = append(flows, f)
		}
	}
	return columns, flows
}

// setupRequirements is what an answer to this step must satisfy, read off the
// board's automation. Only git is asked for so far, and only by the two things
// that cannot work without it: publishing a branch, and any transition that
// waits for one.
func setupRequirements(kind string, columns []ColumnSpec, flows []FlowEntry) []string {
	if kind != SetupStepWorkdir {
		return nil
	}
	for _, c := range columns {
		if c.Action == FlowActionDeploy || c.Action == FlowActionTest {
			return []string{SetupRequiresGit}
		}
	}
	for _, f := range flows {
		for _, n := range f.Nodes {
			if n.Action == FlowActionDeploy || n.Action == FlowActionTest {
				return []string{SetupRequiresGit}
			}
		}
		for _, e := range f.Edges {
			// A trigger the watcher polls a folder for — a merged branch, a
			// pull request, a check — has nothing to watch without git.
			if t, ok := Trigger(e.On); ok && t.Source != SourceOutcome {
				return []string{SetupRequiresGit}
			}
		}
	}
	return nil
}

// CheckSetupAnswer says whether an answer fits the step it is answering, so the
// question can be refused where it is asked rather than three steps later. It
// is the general form on purpose: a step gains a requirement here and the page
// needs no change at all.
func (m *Manager) CheckSetupAnswer(boardID, step, value string) error {
	if _, ok := SetupStepDefinition(step); !ok {
		return fmt.Errorf("неизвестный шаг настройки %q", step)
	}
	for _, s := range m.SetupPlanFor(boardID).Steps {
		if s.Kind != step {
			continue
		}
		for _, req := range s.Requires {
			if req == SetupRequiresGit && !IsGitWorkdir(m.rootCtx, value) {
				return fmt.Errorf("в папке %s нет git, а этой доске нужен репозиторий: она публикует ветку или ждёт её — выполните `git init` или выберите другую папку", value)
			}
		}
	}
	return nil
}

// columnOfAction is the column that does something, as this board calls it —
// the column an agent works in, the column that tests.
func columnOfAction(columns []ColumnSpec, action string) string {
	for _, c := range columns {
		if c.Action == action {
			return c.Column
		}
	}
	return ""
}

// crewOfAction is the crew every stage of this kind is worked by, and nothing
// when they disagree — two columns crewed differently is an arrangement richer
// than the one question the wizard asks, and showing one of the two as "the"
// answer would be offering to overwrite the other on the way past.
func crewOfAction(columns []ColumnSpec, action string) []string {
	var crew []string
	first := true
	for _, c := range columns {
		if c.Action != action {
			continue
		}
		if first {
			crew, first = c.Agents, false
			continue
		}
		if !sameCrew(crew, c.Agents) {
			return nil
		}
	}
	return crew
}

// sameCrew compares two crews as the lists they are: order is not part of the
// answer, but who is on them is.
func sameCrew(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for _, name := range a {
		found := false
		for _, other := range b {
			if strings.EqualFold(name, other) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// BoardAgentNames is every agent this board names anywhere in its automation —
// the crew of a column or of a stage of a route, whatever that stage does. It
// is what "the agents of this board" means to a person: the registry is the
// machine's, and a board's own answer is who it puts to work on it.
func (m *Manager) BoardAgentNames(boardID string) []string {
	// The same reader the plan uses, and for the same reason: a board whose
	// automation has not been taken into the registry yet still carries it in
	// its own properties, and it names its agents there just as truthfully.
	// Nothing here writes, so a card's assignee list costs no seeding.
	_, columns, flows := m.boardSetupSources(boardID)
	var names []string
	known := func(name string) bool {
		for _, have := range names {
			if strings.EqualFold(have, name) {
				return true
			}
		}
		return false
	}
	add := func(crew []string) {
		for _, name := range crew {
			if name = strings.TrimSpace(name); name != "" && !known(name) {
				names = append(names, name)
			}
		}
	}
	for _, c := range columns {
		add(c.Agents)
	}
	for _, f := range flows {
		for _, n := range f.Nodes {
			add(n.Crew())
		}
	}
	return names
}

// SetTestAgent answers the QA step: this agent tests this board, and it tests
// with these servers.
//
// Both writes belong to that one answer. A test session refuses to start
// without a browser MCP server on the agent it resolved (startSession), and
// which agent it resolves is the column's business — so the server goes on the
// agent, and the agent goes on the test column as its crew. Putting the server
// on whichever agent the registry happened to list first is what this replaces:
// on a board with two agents the browser landed on one and the QA column ran
// the other, and the session died saying it had nothing to test with.
//
// The rest of the agent's entry is kept: the wizard knows about a browser and
// nothing else, and rebuilding the entry from that dropped the model, the
// environment and the proxy of an agent already set up.
func (m *Manager) SetTestAgent(boardID, agentName string, servers MCPServerSet) error {
	return m.setStageCrew(boardID, []string{agentName}, FlowActionTest, servers)
}

// SetWorkAgents answers the agent step the same way, for the stages that work a
// card rather than test it: these agents are the crew of this board's agent
// columns.
//
// A crew, not one name, because that is what a stage holds and what a person
// answering «кто работает карточки этой доски» may mean — two agents sharing
// the column is an ordinary arrangement, and the engine already picks the free
// one. An empty list is an answer too: it takes the crew off, and a board that
// names nobody is back to offering every agent on the machine, which is what a
// board that has never been asked does.
func (m *Manager) SetWorkAgents(boardID string, names []string) error {
	return m.setStageCrew(boardID, names, FlowActionAgent, nil)
}

// setStageCrew is the half those two share: the crew written onto every stage
// of this board that does `action` — a column of its own, or a node of a route
// that does it over a column that does something else.
func (m *Manager) setStageCrew(boardID string, names []string, action string, servers MCPServerSet) error {
	// Every name is checked against the registry before anything is written: a
	// name comes from the page, and a typo would otherwise leave the column
	// crewed with somebody no session can resolve.
	crew := make([]string, 0, len(names))
	var entry AgentEntry
	for _, name := range names {
		found, ok := m.agentNamed(strings.TrimSpace(name))
		if !ok {
			return fmt.Errorf("агент %q не найден в реестре", strings.TrimSpace(name))
		}
		entry = found
		crew = append(crew, found.Name)
	}

	// Read the board first: the wizard runs before any card has been moved, so
	// the column may still be a property of the board rather than an entry of
	// the registry. Seeding is idempotent, and SaveColumn does it anyway.
	m.SeedBoard(boardID)
	columns, flows := m.boardOwnAutomation(boardID)

	// The browser goes on the stage that tests, not on the agent that works it.
	// It used to go on the agent, and that made setting up QA on one board an
	// edit to an agent every other board also runs: «клаус» given a browser
	// here drove one everywhere. A stage is the narrower owner and the honest
	// one — testing is what needs a browser, not the tester.
	var placed bool
	for _, spec := range columns {
		if spec.Action != action {
			continue
		}
		spec.Agents = crewOrNone(crew)
		if len(servers) > 0 {
			spec.MCPServers = servers
		}
		if _, err := m.SaveColumn(spec); err != nil {
			return err
		}
		placed = true
	}
	for _, flow := range flows {
		var touched bool
		for i, node := range flow.Nodes {
			// A stage that does this on one route alone, over a column that
			// does something else: the column above would never have found it.
			if node.Action != action {
				continue
			}
			flow.Nodes[i].AgentNames = crewOrNone(crew)

			// The stage's older single-agent field, which Crew() still prefers
			// when AgentNames is empty: left standing it would answer for a
			// crew somebody has just taken off.
			flow.Nodes[i].AgentName = ""
			if len(servers) > 0 {
				flow.Nodes[i].MCPServers = servers
			}
			touched, placed = true, true
		}
		if touched {
			if _, err := m.UpdateFlow(flow); err != nil {
				return err
			}
		}
	}

	// A board with no such stage yet — the wizard was walked from the menu
	// before the column existed. The answer still has to land somewhere, and
	// the agent is where the browser used to live. A crew has nowhere else to
	// go and is simply not written: there is no stage for it to be the crew of.
	if !placed && len(servers) > 0 && entry.Name != "" {
		entry.MCPServers = servers
		if _, err := m.UpdateAgent(entry); err != nil {
			return err
		}
	}
	return nil
}

// crewOrNone keeps an empty crew empty rather than an empty list: nil is what
// "nobody is named here" is stored as everywhere else, and a `[]` in the
// board's JSON would read as an arrangement somebody made.
func crewOrNone(crew []string) []string {
	if len(crew) == 0 {
		return nil
	}
	return crew
}

// agentNamed finds a registry entry by name, the way every other lookup does:
// case-insensitively, because the name is what a person typed.
func (m *Manager) agentNamed(name string) (AgentEntry, bool) {
	for _, a := range m.Agents() {
		if strings.EqualFold(a.Name, name) {
			return a, true
		}
	}
	return AgentEntry{}, false
}

// setupSteps is what this board asks to be asked: what the stages it has now
// need, with what the board said about them laid over it.
//
// A declaration used to *replace* the inference, and a declaration is written
// once — by the template, before the board existed. So a board of household
// chores that grew a deploy stage a month later was never asked for a Dokku
// host and was never offered «Куда деплоить…» in its menu either, since that
// item is this plan: the stage stood there when a card reached it, with no door
// anywhere to fix it. It ran stale the other way too — «Разработка» with its
// deploy column deleted went on asking for a host for ever.
//
// So the stages decide *which* questions there are, being the board as it is
// now, and the declaration decides what those questions say: a hint of the
// board's own, a step it insists on, and the one kind nothing can be inferred
// from — a source feeds a board rather than working on it, so no arrangement of
// columns implies one.
//
// None of this makes a question an obligation. Every inferred step keeps the
// closed set's own answer about being optional (SetupStepDefs), because a stage
// nobody has configured is not a broken board: it runs nothing by itself and a
// person works the card there by hand, which is a perfectly good way to use a
// column.
func setupSteps(declared BoardSetup, columns []ColumnSpec, flows []FlowEntry) []BoardSetupStep {
	// A board with no stages at all has nothing to infer from, and inference
	// answers that case by offering everything — a guess for a board that has
	// said nothing, and exactly the wrong thing to lay over a board that has.
	// So a declaration is the whole plan while there is nothing to read.
	if len(declared.Steps) > 0 && len(columns) == 0 && len(flows) == 0 {
		return append([]BoardSetupStep{{Kind: SetupStepName}}, declared.Steps...)
	}

	said := make(map[string]BoardSetupStep, len(declared.Steps))
	for _, step := range declared.Steps {
		said[strings.ToLower(strings.TrimSpace(step.Kind))] = step
	}
	out := make([]BoardSetupStep, 0, len(SetupStepDefs))
	add := func(step BoardSetupStep) {
		if own, ok := said[strings.ToLower(step.Kind)]; ok {
			step.Hint, step.Required = own.Hint, own.Required
		}
		out = append(out, step)
	}
	for _, step := range impliedSetup(columns, flows) {
		if step.Kind == SetupStepDone {
			continue // last, after anything only the board can ask for
		}
		add(step)
	}
	for _, def := range SetupStepDefs {
		if _, wanted := said[def.Kind]; wanted && !inferredSetupKinds[def.Kind] {
			add(BoardSetupStep{Kind: def.Kind})
		}
	}
	return append(out, BoardSetupStep{Kind: SetupStepDone})
}

// inferredSetupKinds are the steps impliedSetup can work out from the board's
// stages. Anything else a board declares is kept because nothing else could
// have produced it.
var inferredSetupKinds = map[string]bool{
	SetupStepName:    true,
	SetupStepWorkdir: true,
	SetupStepAgent:   true,
	SetupStepDeploy:  true,
	SetupStepBrowser: true,
	SetupStepDone:    true,
}

// impliedSetup is what the board's own stages need. A board with no automation
// at all rules nothing out, so it is offered every step — it has said nothing
// about the machine either.
func impliedSetup(columns []ColumnSpec, flows []FlowEntry) []BoardSetupStep {
	actions := map[string]bool{}
	for _, c := range columns {
		actions[c.Action] = true
	}
	for _, f := range flows {
		for _, n := range f.Nodes {
			actions[n.Action] = true
		}
	}
	// Every board is asked its name, whatever it runs: it is the one question
	// that is not about the machine, and a board with no automation at all
	// still has to be told apart from the others in the sidebar.
	steps := []BoardSetupStep{{Kind: SetupStepName}, {Kind: SetupStepWorkdir}, {Kind: SetupStepAgent}}
	blank := len(columns) == 0 && len(flows) == 0
	if blank || actions[FlowActionDeploy] {
		steps = append(steps, BoardSetupStep{Kind: SetupStepDeploy})
	}
	if blank || actions[FlowActionTest] {
		steps = append(steps, BoardSetupStep{Kind: SetupStepBrowser})
	}
	return append(steps, BoardSetupStep{Kind: SetupStepDone})
}

// setupStatus answers a step from the machine first and the record second: a
// registry that already has an entry is an answered question however it came to
// be answered, and only a step nobody can answer for you is read off the record.
func (m *Manager) setupStatus(def SetupStepDef, states map[string]string) string {
	if status, ok := states[def.Kind]; ok {
		return status
	}
	if def.Kind == SetupStepDone {
		return SetupDone
	}
	return SetupPending
}

// registryFilled says the machine can already answer this step — there is a
// folder, an agent, somewhere to deploy to, a browser. It is deliberately not
// the same as the step being *answered*: setting up one board must not mark the
// next one set up, or every board after the first is created in silence, which
// is what this used to do. The wizard shows it as "already registered" and lets
// the step be passed with one click; the status stays this board's own answer.
func (m *Manager) registryFilled(registry string, columns []ColumnSpec, flows []FlowEntry) bool {
	// A registry this package does not own answers for itself. Sources are the
	// first of them: they run with the agent integration switched off, so this
	// package cannot import them, and asking through a function keeps the
	// dependency pointing the way it already does.
	if probe := m.registryProbe(registry); probe != nil {
		return probe()
	}
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	switch registry {
	case "projects":
		return len(m.cfg.Workdirs) > 0
	case "agents":
		return len(m.cfg.Agents) > 0
	case "deploys":
		return len(m.cfg.Deploys) > 0
	case "agentMCP":
		// Not a registry of its own: the browser is a server, and a server now
		// has two owners. The board's own test stage carrying one answers the
		// question first, because that is the answer this step writes and the
		// narrower of the two; an agent carrying one answers it as before.
		for _, servers := range stageServers(columns, flows, FlowActionTest) {
			if len(servers) > 0 {
				return true
			}
		}
		for _, a := range m.cfg.Agents {
			if len(a.MCPServers) > 0 {
				return true
			}
		}
	}
	return false
}

// stageServers is the MCP sets of every stage of one action on a board — the
// columns that do it, and the route nodes that do it whatever their column
// says. Used both to answer "is there a browser here" and to put one there.
func stageServers(columns []ColumnSpec, flows []FlowEntry, action string) []MCPServerSet {
	var out []MCPServerSet
	for _, c := range columns {
		if c.Action == action {
			out = append(out, c.MCPServers)
		}
	}
	for _, f := range flows {
		for _, n := range f.Nodes {
			if n.Action == action {
				out = append(out, n.MCPServers)
			}
		}
	}
	return out
}

// SetRegistryProbe supplies the answer to "does this registry have anything in
// it" for a registry another package owns. Optional: without one, a step naming
// such a registry is simply never already-answered.
func (m *Manager) SetRegistryProbe(registry string, filled func() bool) {
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	if m.registryProbes == nil {
		m.registryProbes = map[string]func() bool{}
	}
	m.registryProbes[registry] = filled
}

func (m *Manager) registryProbe(registry string) func() bool {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	return m.registryProbes[registry]
}

func (m *Manager) setupStates(boardID string) map[string]string {
	out := map[string]string{}
	if m.store == nil {
		return out
	}
	states, err := m.store.SetupSteps(boardID)
	if err != nil {
		m.log.Warn("acp: cannot read what was already set up", "board", boardID, "err", err)
		return out
	}
	for _, st := range states {
		out[st.Step] = st.Status
	}
	return out
}

// MarkSetupOffered remembers that the wizard opened itself for this board, so
// it does not do so again — on the next board, on the next launch, or after the
// page's storage is cleared.
func (m *Manager) MarkSetupOffered(boardID string) error {
	if m.store == nil {
		return nil
	}
	return m.store.SaveSetupStep(SetupStepState{BoardID: boardID, Step: setupWizardStep, Status: "offered"})
}

// RecordSetupStep remembers what was done with a step. Skipping is the one
// answer nothing else can be read off: a registry says whether it was filled,
// but only a person can say they meant to leave it empty.
func (m *Manager) RecordSetupStep(boardID, step, status string) error {
	if _, ok := SetupStepDefinition(step); !ok {
		return fmt.Errorf("неизвестный шаг настройки %q", step)
	}
	switch status {
	case SetupPending, SetupDone, SetupSkipped:
	default:
		return fmt.Errorf("неизвестное состояние шага %q", status)
	}
	if m.store == nil {
		return nil
	}
	return m.store.SaveSetupStep(SetupStepState{BoardID: boardID, Step: step, Status: status})
}

// isBoardTemplate reports whether the board is a template. A build with no
// board reader wired answers "no": that is what every board was before this was
// asked, and a false "yes" would silence the wizard everywhere.
func (m *Manager) isBoardTemplate(boardID string) bool {
	if boardID == "" || m.meta == nil {
		return false
	}
	parent := m.rootCtx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	isTemplate, err := m.meta.IsBoardTemplate(ctx, boardID)
	if err != nil {
		m.log.Warn("acp: cannot tell whether the board is a template", "board", boardID, "err", err)
		return false
	}
	return isTemplate
}

// boardProperties reads a board's own settings, or nothing if there is no board
// reader wired (a test, or a build without one).
func (m *Manager) boardProperties(boardID string) map[string]any {
	if boardID == "" || m.meta == nil {
		return nil
	}
	// A nil parent context is a panic rather than a timeout, and the UI may ask
	// before the trigger loop has started.
	parent := m.rootCtx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	props, err := m.meta.BoardProperties(ctx, boardID)
	if err != nil {
		m.log.Warn("acp: cannot read the board's own settings", "board", boardID, "err", err)
		return nil
	}
	return props
}
