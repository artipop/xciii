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

// A template is a board being written, not one being run: whatever a copy of it
// will need is the copy's business, and a wizard on top of one asks about a
// board that does not exist yet. This came up as the setup screen opening on
// «Create new template», where there is nothing to set up at all.
func TestATemplateIsAskedForNothing(t *testing.T) {
	asks := boardProps(t, map[string]any{
		BoardPropSetup: BoardSetup{Steps: []BoardSetupStep{
			{Kind: SetupStepProject},
			{Kind: SetupStepAgent},
		}},
	})
	m := setupManager(t, asks)

	// The same board, asking for the same two things, is asked them as a board
	// and not as a template.
	if len(m.SetupPlanFor("board1").Steps) != 2 {
		t.Fatalf("the board itself was asked for %v", kinds(m.SetupPlanFor("board1")))
	}

	m.SetBoardMeta(&fakeBoardMeta{props: asks, template: true})
	plan := m.SetupPlanFor("board1")
	if len(plan.Steps) != 0 {
		t.Errorf("a template was asked for %v", kinds(plan))
	}
	if plan.Automated {
		t.Error("a template counts as automated, so the wizard would open itself on it")
	}
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

// A source feeds a board rather than works on it, so nothing about a board's
// columns implies one: it is asked for only where the board asks for it. And
// because the registry belongs to another package, whether the machine can
// already answer arrives as a probe rather than from the config.
func TestASourceIsAskedForOnlyByABoardThatWantsOne(t *testing.T) {
	m := setupManager(t, boardProps(t, map[string]any{
		BoardPropSetup: BoardSetup{Steps: []BoardSetupStep{
			{Kind: SetupStepAgent},
			{Kind: SetupStepSource},
			{Kind: SetupStepDone},
		}},
	}))

	byKind := func() map[string]SetupStep {
		out := map[string]SetupStep{}
		for _, s := range m.SetupPlanFor("board1").Steps {
			out[s.Kind] = s
		}
		return out
	}

	step, asked := byKind()[SetupStepSource]
	if !asked {
		t.Fatal("the board asked for a source and was not offered one")
	}
	if !step.Optional {
		t.Error("a source is optional: a board works without one")
	}
	if step.Ready {
		t.Error("nothing is registered, and the plan says otherwise")
	}

	m.SetRegistryProbe("sources", func() bool { return true })
	if !byKind()[SetupStepSource].Ready {
		t.Error("the machine can answer it now, and the plan does not say so")
	}

	// A board that says nothing is asked what its automation implies, and no
	// automation implies a source.
	quiet := setupManager(t, nil)
	quiet.cfg.Columns = []ColumnSpec{{BoardID: "board1", Property: "Status", Column: "In Progress", Action: FlowActionAgent}}
	for _, s := range quiet.SetupPlanFor("board1").Steps {
		if s.Kind == SetupStepSource {
			t.Fatal("a source was inferred from columns, and nothing about them implies one")
		}
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

// A machine that can already answer a step says so — but the step is still this
// board's to answer. Setting up one board used to mark every board that came
// after it as set up, which meant a second board was created in silence: no
// wizard, no reminder, nothing asked.
func TestAFilledRegistryOffersAnAnswerRatherThanBeingOne(t *testing.T) {
	m := setupManager(t, nil)
	m.cfg.Projects = []ProjectEntry{{Name: "notes", Path: "/tmp/notes"}}
	m.cfg.Agents = []AgentEntry{{Name: "claude", Kind: "claude"}}

	byKind := func(boardID string) map[string]SetupStep {
		out := map[string]SetupStep{}
		for _, s := range m.SetupPlanFor(boardID).Steps {
			out[s.Kind] = s
		}
		return out
	}

	first := byKind("board1")
	for _, kind := range []string{SetupStepProject, SetupStepAgent} {
		if first[kind].Status != SetupPending {
			t.Errorf("%s: %q — a board nobody set up counts as set up", kind, first[kind].Status)
		}
		if !first[kind].Ready {
			t.Errorf("%s: the machine can answer it, and the plan does not say so", kind)
		}
	}
	if first[SetupStepDeploy].Ready {
		t.Error("deploy: nothing is registered, and the plan says otherwise")
	}

	// The browser is not a registry of its own: an agent carrying an MCP server
	// is what makes that question answerable.
	if first[SetupStepBrowser].Ready {
		t.Error("browser: no agent carries a server yet")
	}
	m.cfg.Agents[0].MCPServers = MCPServerSet{"playwright": {Command: "npx"}}
	if !byKind("board1")[SetupStepBrowser].Ready {
		t.Error("browser: an agent carries a server and the plan does not say so")
	}

	// Answering it for one board leaves the next one asking.
	for _, kind := range []string{SetupStepProject, SetupStepAgent} {
		if err := m.RecordSetupStep("board1", kind, SetupDone); err != nil {
			t.Fatal(err)
		}
	}
	if got := byKind("board1")[SetupStepProject].Status; got != SetupDone {
		t.Errorf("board1 project after answering: %q", got)
	}
	if got := byKind("board2")[SetupStepProject].Status; got != SetupPending {
		t.Errorf("board2 project: %q — one board's answer stood in for another's", got)
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

// Git is asked for by what a board does, not by which template it came from: a
// board that publishes a branch or waits for one needs a project under git, and
// a board of personal tasks must take any folder — telling somebody to `git
// init` their shopping list is telling them to learn git for a shopping list.
func TestGitIsAskedForByWhatTheBoardDoes(t *testing.T) {
	chores := setupManager(t, boardProps(t, BoardAutomation{
		Columns: []ColumnSpec{{
			PropertyID: "p", OptionID: "o1", Property: "Статус",
			Column: "Агент готовит", Action: FlowActionAgent,
		}},
		Flows: []FlowEntry{{
			Name: "Дело", Property: "Статус",
			Nodes: []FlowNode{
				{ID: "agent", Column: "Агент готовит", OptionID: "o1"},
				{ID: "done", Column: "Готово", OptionID: "o2", Action: FlowActionNone},
			},
			Edges: []FlowEdge{{From: "agent", To: "done", On: TriggerSuccess}},
		}},
	}))
	if got := requirementsOf(chores.SetupPlanFor("board1"), SetupStepProject); len(got) != 0 {
		t.Errorf("a board that only runs an agent asks for %v", got)
	}

	// The same board with a stage that publishes.
	deploying := setupManager(t, boardProps(t, BoardAutomation{
		Columns: []ColumnSpec{
			{PropertyID: "p", OptionID: "o1", Property: "Status", Column: "In Progress", Action: FlowActionAgent},
			{PropertyID: "p", OptionID: "o2", Property: "Status", Column: "Deploy", Action: FlowActionDeploy},
		},
	}))
	if got := requirementsOf(deploying.SetupPlanFor("board1"), SetupStepProject); !containsString(got, SetupRequiresGit) {
		t.Errorf("a board that publishes asks for %v", got)
	}

	// And so does one that only waits for a branch: the watcher has nothing to
	// poll without git, so the transition would never fire.
	waiting := setupManager(t, boardProps(t, BoardAutomation{
		Columns: []ColumnSpec{{PropertyID: "p", OptionID: "o1", Property: "Status", Column: "In Progress", Action: FlowActionAgent}},
		Flows: []FlowEntry{{
			Name: "Review only", Property: "Status",
			Nodes: []FlowNode{
				{ID: "agent", Column: "In Progress", OptionID: "o1"},
				{ID: "done", Column: "Done", OptionID: "o2", Action: FlowActionNone},
			},
			Edges: []FlowEdge{{From: "agent", To: "done", On: TriggerBranchMerged}},
		}},
	}))
	if got := requirementsOf(waiting.SetupPlanFor("board1"), SetupStepProject); !containsString(got, SetupRequiresGit) {
		t.Errorf("a board that waits for a branch asks for %v", got)
	}
}

func requirementsOf(plan SetupPlan, kind string) []string {
	for _, s := range plan.Steps {
		if s.Kind == kind {
			return s.Requires
		}
	}
	return nil
}

// The requirement is enforced where the question is asked, not three steps
// later on a card nobody is watching.
func TestAnAnswerIsCheckedAgainstWhatItsStepRequires(t *testing.T) {
	plain := t.TempDir()

	chores := setupManager(t, boardProps(t, BoardAutomation{
		Columns: []ColumnSpec{{PropertyID: "p", OptionID: "o1", Property: "Статус", Column: "Агент готовит", Action: FlowActionAgent}},
	}))
	if err := chores.CheckSetupAnswer("board1", SetupStepProject, plain); err != nil {
		t.Errorf("an ordinary folder was refused: %v", err)
	}

	deploying := setupManager(t, boardProps(t, BoardAutomation{
		Columns: []ColumnSpec{
			{PropertyID: "p", OptionID: "o1", Property: "Status", Column: "In Progress", Action: FlowActionAgent},
			{PropertyID: "p", OptionID: "o2", Property: "Status", Column: "Deploy", Action: FlowActionDeploy},
		},
	}))
	if err := deploying.CheckSetupAnswer("board1", SetupStepProject, plain); err == nil {
		t.Error("a board that publishes accepted a folder with no git in it")
	}
	if err := deploying.CheckSetupAnswer("board1", SetupStepProject, initTestProject(t)); err != nil {
		t.Errorf("a git project was refused: %v", err)
	}

	// A step nothing requires of takes anything, and an unknown step is
	// refused: the binding behind this is callable by anything on the page.
	if err := deploying.CheckSetupAnswer("board1", SetupStepAgent, "claude"); err != nil {
		t.Errorf("the agent step required something: %v", err)
	}
	if err := deploying.CheckSetupAnswer("board1", "telepathy", ""); err == nil {
		t.Error("an unknown step was checked as if it existed")
	}
}

// The bug this fixes: on a machine configured before boards were told apart,
// the registry carries a deploy column and a test column that name no board at
// all, and every board inherited them — so opening a board of household chores
// demanded a git project for a folder of notes. A board is set up for what it
// runs, not for what the machine happens to have lying about.
func TestABoardIsNotAskedForWhatOnlyTheMachineHas(t *testing.T) {
	chores := setupManager(t, boardProps(t, BoardAutomation{
		Columns: []ColumnSpec{{
			PropertyID: "p", OptionID: "o1", Property: "Статус",
			Column: "Агент разбирается", Action: FlowActionAgent,
		}},
	}))
	// The legacy entries: no board id, so every board sees them at run time.
	chores.cfg.Columns = []ColumnSpec{
		{Property: "Status", Column: "In Progress", Action: FlowActionAgent},
		{Property: "Status", Column: "Deploy", Action: FlowActionDeploy},
		{Property: "Status", Column: "To Test", Action: FlowActionTest},
	}

	plan := chores.SetupPlanFor("board1")
	if got := requirementsOf(plan, SetupStepProject); len(got) != 0 {
		t.Errorf("the board was asked for %v because the machine has a deploy column", got)
	}
	for _, s := range plan.Steps {
		if s.Kind == SetupStepDeploy || s.Kind == SetupStepBrowser {
			t.Errorf("the board is asked about %q, which nothing on it does", s.Kind)
		}
	}
	if err := chores.CheckSetupAnswer("board1", SetupStepProject, t.TempDir()); err != nil {
		t.Errorf("an ordinary folder was refused: %v", err)
	}

	// And the same registry is still what a board bringing nothing of its own
	// has to be set up for.
	plain := setupManager(t, nil)
	plain.cfg.Columns = chores.cfg.Columns
	if got := requirementsOf(plain.SetupPlanFor("board2"), SetupStepProject); !containsString(got, SetupRequiresGit) {
		t.Errorf("a board run by the machine's own columns asks for %v", got)
	}
}

// Having been offered the wizard has to outlive the run it happened in. It used
// to live in the page's localStorage, which is keyed by origin — and the desktop
// app publishes itself on a fresh port, and therefore a fresh origin, every
// launch, so "do not show me this again" lasted exactly one launch.
func TestTheOfferIsRememberedAcrossRestarts(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenStore(filepath.Join(dir, "acp.db"))
	if err != nil {
		t.Fatal(err)
	}

	manager := func(store *Store) *Manager {
		m := NewManager(DefaultConfig(dir), "", store, newFakeWriter(), &fakeEmitter{}, nil)
		m.cfg.Columns = nil
		m.cfg.Flows = nil
		m.rootCtx = context.Background()
		m.SetBoardMeta(&fakeBoardMeta{})
		return m
	}

	m := manager(store)
	if m.SetupPlanFor("board1").Offered {
		t.Fatal("a board nobody has seen the wizard for says it has")
	}
	if err := m.MarkSetupOffered("board1"); err != nil {
		t.Fatal(err)
	}
	if !m.SetupPlanFor("board1").Offered {
		t.Fatal("the offer was not remembered at all")
	}
	if m.SetupPlanFor("board2").Offered {
		t.Error("one board's offer stood in for another's")
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	// The next launch: a new store on the same file, and nothing else carried
	// over — no page, no memory.
	reopened, err := OpenStore(filepath.Join(dir, "acp.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	if !manager(reopened).SetupPlanFor("board1").Offered {
		t.Fatal("the offer did not survive the restart")
	}
}
