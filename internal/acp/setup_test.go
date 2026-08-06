package acp

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
)

// The plan is what the wizard asks and what the board menu offers, so a wrong
// one is a question nobody can answer or a setting that does nothing. It is
// resolved from three places at once — what the board asks for, what its
// automation implies, what this machine already has — and these fix each.

func setupManager(t *testing.T, props map[string]any) *Manager {
	t.Helper()
	dir := t.TempDir()
	store, err := OpenStore(filepath.Join(dir, "acp.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	m := NewManager(DefaultConfig(dir), "", store, newFakeWriter(), &fakeEmitter{}, nil)
	m.cfg.Columns = nil
	m.cfg.Flows = nil
	m.rootCtx = context.Background()
	m.SetBoardMeta(&fakeBoardMeta{props: props})
	return m
}

// boardProps encodes what a template writes into the board, the way the board
// store hands it back: JSON decoded into `any`.
func boardProps(t *testing.T, value any) map[string]any {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var props map[string]any
	if err := json.Unmarshal(encoded, &props); err != nil {
		t.Fatal(err)
	}
	return props
}

func kinds(plan SetupPlan) []string {
	out := make([]string, 0, len(plan.Steps))
	for _, s := range plan.Steps {
		out = append(out, s.Kind)
	}
	return out
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// A board that says what it needs is asked for exactly that, in its own order.
func TestABoardAsksForTheStepsItNames(t *testing.T) {
	m := setupManager(t, boardProps(t, map[string]any{
		BoardPropSetup: BoardSetup{Steps: []BoardSetupStep{
			{Kind: SetupStepProject, Hint: "Папка с домашними заметками"},
			{Kind: SetupStepAgent},
			{Kind: SetupStepDone},
		}},
	}))

	plan := m.SetupPlanFor("board1")
	if !plan.Declared {
		t.Error("the plan does not say the board asked for it")
	}
	if want := []string{SetupStepProject, SetupStepAgent, SetupStepDone}; !equal(kinds(plan), want) {
		t.Fatalf("steps %v, expected %v", kinds(plan), want)
	}
	if plan.Steps[0].Hint == "" {
		t.Error("the board's own sentence was dropped")
	}
}

// A step this build has never heard of is skipped rather than fatal: the board
// may have been made by a newer app, and the rest of the plan still stands.
func TestAStepThisBuildCannotDoIsLeftOut(t *testing.T) {
	m := setupManager(t, boardProps(t, map[string]any{
		BoardPropSetup: BoardSetup{Steps: []BoardSetupStep{
			{Kind: SetupStepProject},
			{Kind: "telepathy"},
			{Kind: SetupStepDone},
		}},
	}))

	if want := []string{SetupStepProject, SetupStepDone}; !equal(kinds(m.SetupPlanFor("board1")), want) {
		t.Fatalf("steps %v, expected %v", kinds(m.SetupPlanFor("board1")), want)
	}
}

// A board that says nothing is read for what its automation needs: this one
// runs an agent and nothing else, so there is nowhere to deploy to and nothing
// to test with — and asking for either would be asking the unanswerable.
func TestABoardThatSaysNothingIsAskedWhatItsAutomationNeeds(t *testing.T) {
	m := setupManager(t, boardProps(t, BoardAutomation{
		Columns: []ColumnSpec{{
			PropertyID: "p", OptionID: "opt-work", Property: "Статус",
			Column: "Агент готовит", Action: FlowActionAgent,
		}},
		Flows: []FlowEntry{{
			Name: "Дело с подготовкой", Property: "Статус",
			Nodes: []FlowNode{
				{ID: "agent", Column: "Агент готовит", OptionID: "opt-work"},
				{ID: "done", Column: "Готово", OptionID: "opt-done", Action: FlowActionNone},
			},
			Edges: []FlowEdge{{From: "agent", To: "done", On: TriggerSuccess}},
		}},
	}))

	plan := m.SetupPlanFor("board1")
	if plan.Declared {
		t.Error("the plan claims the board asked for these steps")
	}
	if !plan.Automated {
		t.Error("a board carrying columns and routes is not marked as automated")
	}
	if want := []string{SetupStepProject, SetupStepAgent, SetupStepDone}; !equal(kinds(plan), want) {
		t.Fatalf("steps %v, expected %v", kinds(plan), want)
	}
}

// The same reading of a board that does deploy and test: it is asked for both.
func TestABoardThatDeploysAndTestsIsAskedForBoth(t *testing.T) {
	m := setupManager(t, boardProps(t, BoardAutomation{
		Columns: []ColumnSpec{
			{PropertyID: "p", OptionID: "o1", Property: "Status", Column: "In Progress", Action: FlowActionAgent},
			{PropertyID: "p", OptionID: "o2", Property: "Status", Column: "Deploy", Action: FlowActionDeploy},
			{PropertyID: "p", OptionID: "o3", Property: "Status", Column: "To Test", Action: FlowActionTest},
		},
	}))

	want := []string{SetupStepProject, SetupStepAgent, SetupStepDeploy, SetupStepBrowser, SetupStepDone}
	if got := kinds(m.SetupPlanFor("board1")); !equal(got, want) {
		t.Fatalf("steps %v, expected %v", got, want)
	}
}

// A board with no automation of its own rules nothing out — it has said nothing
// about this machine either — so every step is offered, and the plan says the
// wizard should not open itself for it.
func TestABoardWithNoAutomationIsOfferedEverythingAndOpensNothing(t *testing.T) {
	m := setupManager(t, nil)

	plan := m.SetupPlanFor("board1")
	if plan.Automated {
		t.Error("a board with no columns and no routes is marked as automated")
	}
	want := []string{SetupStepProject, SetupStepAgent, SetupStepDeploy, SetupStepBrowser, SetupStepDone}
	if got := kinds(plan); !equal(got, want) {
		t.Fatalf("steps %v, expected %v", got, want)
	}
}

// A question this machine has already answered is not asked again, however it
// came to be answered — the registry is the answer, not the record of asking.
func TestAFilledRegistryAnswersItsStep(t *testing.T) {
	m := setupManager(t, nil)
	m.cfg.Projects = []ProjectEntry{{Name: "notes", Path: "/tmp/notes"}}
	m.cfg.Agents = []AgentEntry{{Name: "claude", Kind: "claude"}}

	byKind := map[string]SetupStep{}
	for _, s := range m.SetupPlanFor("board1").Steps {
		byKind[s.Kind] = s
	}
	if byKind[SetupStepProject].Status != SetupDone {
		t.Errorf("project: %q", byKind[SetupStepProject].Status)
	}
	if byKind[SetupStepAgent].Status != SetupDone {
		t.Errorf("agent: %q", byKind[SetupStepAgent].Status)
	}
	if byKind[SetupStepDeploy].Status != SetupPending {
		t.Errorf("deploy: %q", byKind[SetupStepDeploy].Status)
	}

	// The browser is not a registry of its own: an agent carrying an MCP
	// server is that question answered.
	if byKind[SetupStepBrowser].Status != SetupPending {
		t.Errorf("browser before: %q", byKind[SetupStepBrowser].Status)
	}
	m.cfg.Agents[0].MCPServers = MCPServerSet{"playwright": {Command: "npx"}}
	for _, s := range m.SetupPlanFor("board1").Steps {
		if s.Kind == SetupStepBrowser && s.Status != SetupDone {
			t.Errorf("browser after: %q", s.Status)
		}
	}
}

// Skipping is the one answer nothing else can be read for, so it is the one
// that has to survive a restart — and it is remembered per board.
func TestASkippedStepIsRememberedForThatBoard(t *testing.T) {
	m := setupManager(t, nil)

	if err := m.RecordSetupStep("board1", SetupStepDeploy, SetupSkipped); err != nil {
		t.Fatal(err)
	}
	for _, s := range m.SetupPlanFor("board1").Steps {
		if s.Kind == SetupStepDeploy && s.Status != SetupSkipped {
			t.Errorf("board1 deploy: %q", s.Status)
		}
	}
	for _, s := range m.SetupPlanFor("board2").Steps {
		if s.Kind == SetupStepDeploy && s.Status != SetupPending {
			t.Errorf("board2 deploy: %q — another board's answer leaked", s.Status)
		}
	}

	// And what does not exist cannot be recorded: the wizard is the only
	// caller, but it reaches this through a binding anything can call.
	if err := m.RecordSetupStep("board1", "telepathy", SetupSkipped); err == nil {
		t.Error("an unknown step was recorded")
	}
	if err := m.RecordSetupStep("board1", SetupStepDeploy, "postponed"); err == nil {
		t.Error("an unknown status was recorded")
	}
}

// The board may insist on a step the app calls optional: a route that deploys
// is not set up until there is somewhere to deploy to.
func TestABoardCanMakeAnOptionalStepRequired(t *testing.T) {
	m := setupManager(t, boardProps(t, map[string]any{
		BoardPropSetup: BoardSetup{Steps: []BoardSetupStep{
			{Kind: SetupStepDeploy, Required: true},
			{Kind: SetupStepBrowser},
		}},
	}))

	for _, s := range m.SetupPlanFor("board1").Steps {
		switch s.Kind {
		case SetupStepDeploy:
			if s.Optional {
				t.Error("the board asked for deploy outright and got an optional step")
			}
		case SetupStepBrowser:
			if !s.Optional {
				t.Error("the browser step stopped being skippable")
			}
		}
	}
}
