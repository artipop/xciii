package acp

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// A board arrives knowing how the work on it is organised. What it cannot know
// is the machine: which agent runs, in which project, where it publishes, what
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
	SetupStepProject = "project" // a folder on this machine an agent works in
	SetupStepAgent   = "agent"   // the agent that picks a card up
	SetupStepDeploy  = "deploy"  // a Dokku host to publish a branch to
	SetupStepBrowser = "browser" // the MCP server a test session drives
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
// a branch or waits for one needs a project under git, and a board that does
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
// project, and neither publishing nor testing means anything without an agent.
var SetupStepDefs = []SetupStepDef{
	{Kind: SetupStepProject, Registry: "projects"},
	{Kind: SetupStepAgent, Registry: "agents"},
	{Kind: SetupStepDeploy, Registry: "deploys", Optional: true},
	{Kind: SetupStepBrowser, Registry: "agentMCP", Optional: true},
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

	declared, columns, flows := m.boardSetupSources(boardID)
	plan.Automated = len(columns) > 0 || len(flows) > 0

	steps := declared.Steps
	if len(steps) > 0 {
		plan.Declared = true
	} else {
		steps = impliedSetup(columns, flows)
	}

	plan.AgentColumn = agentColumnOf(columns)
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
			Hint:     strings.TrimSpace(step.Hint),
			Status:   m.setupStatus(def, states),
			Ready:    def.Registry != "" && m.registryFilled(def.Registry),
			Requires: setupRequirements(def.Kind, columns, flows),
		})
	}
	return plan
}

// boardSetupSources reads the three properties a template writes: what it asks
// to be asked, and the automation the question would otherwise be inferred from.
func (m *Manager) boardSetupSources(boardID string) (BoardSetup, []ColumnSpec, []FlowEntry) {
	// What this board runs is what this board says it runs — its own registry
	// entries, or the automation it still carries in its properties. The
	// machine-wide entries (the ones migrated from the old config keys, which
	// name no board at all) are deliberately not read here: they describe a
	// board that deploys and tests, and reading them made every board ask for a
	// project under git, including one whose whole job is a shopping list.
	columns, flows := m.boardOwnAutomation(boardID)

	var declared BoardSetup
	props := m.boardProperties(boardID)
	if raw, ok := props[BoardPropSetup]; ok {
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
	if kind != SetupStepProject {
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
			// A trigger the watcher polls a project for — a merged branch, a
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
			if req == SetupRequiresGit && !IsGitProject(m.rootCtx, value) {
				return fmt.Errorf("в каталоге %s нет git-репозитория, а этой доске он нужен: она публикует ветку или ждёт её — выполните `git init` или выберите другой каталог", value)
			}
		}
	}
	return nil
}

// agentColumnOf is the column an agent works in, as this board calls it.
func agentColumnOf(columns []ColumnSpec) string {
	for _, c := range columns {
		if c.Action == FlowActionAgent {
			return c.Column
		}
	}
	return ""
}

// impliedSetup is the fallback for a board that says nothing: ask for what its
// automation needs. A board with no automation at all rules nothing out, so it
// is offered every step — it has said nothing about the machine either.
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
	steps := []BoardSetupStep{{Kind: SetupStepProject}, {Kind: SetupStepAgent}}
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
// project, an agent, somewhere to deploy to, a browser. It is deliberately not
// the same as the step being *answered*: setting up one board must not mark the
// next one set up, or every board after the first is created in silence, which
// is what this used to do. The wizard shows it as "already registered" and lets
// the step be passed with one click; the status stays this board's own answer.
func (m *Manager) registryFilled(registry string) bool {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	switch registry {
	case "projects":
		return len(m.cfg.Projects) > 0
	case "agents":
		return len(m.cfg.Agents) > 0
	case "deploys":
		return len(m.cfg.Deploys) > 0
	case "agentMCP":
		// Not a registry of its own: the browser is a server on an agent, and
		// any agent carrying one is the question answered.
		for _, a := range m.cfg.Agents {
			if len(a.MCPServers) > 0 {
				return true
			}
		}
	}
	return false
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
