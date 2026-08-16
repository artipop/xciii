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
			{Kind: SetupStepWorkdir},
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
			{Kind: SetupStepWorkdir, Hint: "Папка с домашними заметками"},
			{Kind: SetupStepAgent},
			{Kind: SetupStepDone},
		}},
	}))

	plan := m.SetupPlanFor("board1")
	if !plan.Declared {
		t.Error("the plan does not say the board asked for it")
	}
	if want := []string{SetupStepWorkdir, SetupStepAgent, SetupStepDone}; !equal(kinds(plan), want) {
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
			{Kind: SetupStepWorkdir},
			{Kind: "telepathy"},
			{Kind: SetupStepDone},
		}},
	}))

	if want := []string{SetupStepWorkdir, SetupStepDone}; !equal(kinds(m.SetupPlanFor("board1")), want) {
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
	if want := []string{SetupStepWorkdir, SetupStepAgent, SetupStepDone}; !equal(kinds(plan), want) {
		t.Fatalf("steps %v, expected %v", kinds(plan), want)
	}
}

// The board a person keeps working on: a template declared what it needed on
// the day it was made, and a stage added a month later needs something the
// declaration never mentioned. What is asked follows the stages, so the
// question — and the menu item that is the same plan — turns up on its own.
func TestABoardIsAskedForWhatItGrewAfterItWasMade(t *testing.T) {
	m := setupManager(t, boardProps(t, map[string]any{
		BoardPropSetup: BoardSetup{Steps: []BoardSetupStep{
			{Kind: SetupStepWorkdir, Hint: "Папка с домашними заметками"},
			{Kind: SetupStepAgent},
			{Kind: SetupStepDone},
		}},
		BoardPropColumns: []ColumnSpec{
			{PropertyID: "p", OptionID: "o1", Property: "Статус", Column: "Агент готовит", Action: FlowActionAgent},
			{PropertyID: "p", OptionID: "o2", Property: "Статус", Column: "Выложить", Action: FlowActionDeploy},
		},
	}))

	plan := m.SetupPlanFor("board1")
	want := []string{SetupStepWorkdir, SetupStepAgent, SetupStepDeploy, SetupStepDone}
	if !equal(kinds(plan), want) {
		t.Fatalf("steps %v, expected %v", kinds(plan), want)
	}
	// The board still had something to say, and it is still said: what the
	// declaration carries is the wording, not the list.
	if !plan.Declared || plan.Steps[0].Hint != "Папка с домашними заметками" {
		t.Errorf("the board's own sentence was lost: declared=%v %+v", plan.Declared, plan.Steps[0])
	}
	// And a stage nobody has configured is not an emergency: the question the
	// board grew is one it may pass over, exactly as a template's own is.
	for _, step := range plan.Steps {
		if step.Kind == SetupStepDeploy && !step.Optional {
			t.Error("a stage the board grew made its question compulsory")
		}
	}
}

// …and the other way: the stage is gone, so the question goes with it. A
// declaration is written once, and «Разработка» with its deploy column deleted
// went on asking for a Dokku host for ever.
func TestABoardStopsAskingForWhatItNoLongerDoes(t *testing.T) {
	m := setupManager(t, boardProps(t, map[string]any{
		BoardPropSetup: BoardSetup{Steps: []BoardSetupStep{
			{Kind: SetupStepWorkdir},
			{Kind: SetupStepAgent},
			{Kind: SetupStepDeploy},
			{Kind: SetupStepBrowser},
			{Kind: SetupStepDone},
		}},
		BoardPropColumns: []ColumnSpec{
			{PropertyID: "p", OptionID: "o1", Property: "Статус", Column: "В работе", Action: FlowActionAgent},
		},
	}))

	want := []string{SetupStepWorkdir, SetupStepAgent, SetupStepDone}
	if got := kinds(m.SetupPlanFor("board1")); !equal(got, want) {
		t.Fatalf("steps %v, expected %v", got, want)
	}
}

// A source is nobody's consequence — no arrangement of columns implies that
// cards should arrive by themselves — so a board that asks for one keeps it
// however much automation it has.
func TestADeclaredSourceSurvivesTheStagesBeingRead(t *testing.T) {
	m := setupManager(t, boardProps(t, map[string]any{
		BoardPropSetup: BoardSetup{Steps: []BoardSetupStep{
			{Kind: SetupStepAgent},
			{Kind: SetupStepSource},
			{Kind: SetupStepDone},
		}},
		BoardPropColumns: []ColumnSpec{
			{PropertyID: "p", OptionID: "o1", Property: "Статус", Column: "В работе", Action: FlowActionAgent},
		},
	}))

	want := []string{SetupStepWorkdir, SetupStepAgent, SetupStepSource, SetupStepDone}
	if got := kinds(m.SetupPlanFor("board1")); !equal(got, want) {
		t.Fatalf("steps %v, expected %v", got, want)
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

	want := []string{SetupStepWorkdir, SetupStepAgent, SetupStepDeploy, SetupStepBrowser, SetupStepDone}
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
	want := []string{SetupStepWorkdir, SetupStepAgent, SetupStepDeploy, SetupStepBrowser, SetupStepDone}
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
	m.cfg.Workdirs = []WorkdirEntry{{Name: "notes", Path: "/tmp/notes"}}
	m.cfg.Agents = []AgentEntry{{Name: "claude", Kind: "claude"}}

	byKind := func(boardID string) map[string]SetupStep {
		out := map[string]SetupStep{}
		for _, s := range m.SetupPlanFor(boardID).Steps {
			out[s.Kind] = s
		}
		return out
	}

	first := byKind("board1")
	for _, kind := range []string{SetupStepWorkdir, SetupStepAgent} {
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
	for _, kind := range []string{SetupStepWorkdir, SetupStepAgent} {
		if err := m.RecordSetupStep("board1", kind, SetupDone); err != nil {
			t.Fatal(err)
		}
	}
	if got := byKind("board1")[SetupStepWorkdir].Status; got != SetupDone {
		t.Errorf("board1 project after answering: %q", got)
	}
	if got := byKind("board2")[SetupStepWorkdir].Status; got != SetupPending {
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
// board that publishes a branch or waits for one needs a folder under git, and
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
	if got := requirementsOf(chores.SetupPlanFor("board1"), SetupStepWorkdir); len(got) != 0 {
		t.Errorf("a board that only runs an agent asks for %v", got)
	}

	// The same board with a stage that publishes.
	deploying := setupManager(t, boardProps(t, BoardAutomation{
		Columns: []ColumnSpec{
			{PropertyID: "p", OptionID: "o1", Property: "Status", Column: "In Progress", Action: FlowActionAgent},
			{PropertyID: "p", OptionID: "o2", Property: "Status", Column: "Deploy", Action: FlowActionDeploy},
		},
	}))
	if got := requirementsOf(deploying.SetupPlanFor("board1"), SetupStepWorkdir); !containsString(got, SetupRequiresGit) {
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
	if got := requirementsOf(waiting.SetupPlanFor("board1"), SetupStepWorkdir); !containsString(got, SetupRequiresGit) {
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
	if err := chores.CheckSetupAnswer("board1", SetupStepWorkdir, plain); err != nil {
		t.Errorf("an ordinary folder was refused: %v", err)
	}

	deploying := setupManager(t, boardProps(t, BoardAutomation{
		Columns: []ColumnSpec{
			{PropertyID: "p", OptionID: "o1", Property: "Status", Column: "In Progress", Action: FlowActionAgent},
			{PropertyID: "p", OptionID: "o2", Property: "Status", Column: "Deploy", Action: FlowActionDeploy},
		},
	}))
	if err := deploying.CheckSetupAnswer("board1", SetupStepWorkdir, plain); err == nil {
		t.Error("a board that publishes accepted a folder with no git in it")
	}
	if err := deploying.CheckSetupAnswer("board1", SetupStepWorkdir, initTestWorkdir(t)); err != nil {
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
// demanded a git folder for a folder of notes. A board is set up for what it
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
	if got := requirementsOf(plan, SetupStepWorkdir); len(got) != 0 {
		t.Errorf("the board was asked for %v because the machine has a deploy column", got)
	}
	for _, s := range plan.Steps {
		if s.Kind == SetupStepDeploy || s.Kind == SetupStepBrowser {
			t.Errorf("the board is asked about %q, which nothing on it does", s.Kind)
		}
	}
	if err := chores.CheckSetupAnswer("board1", SetupStepWorkdir, t.TempDir()); err != nil {
		t.Errorf("an ordinary folder was refused: %v", err)
	}

	// And the same registry is still what a board bringing nothing of its own
	// has to be set up for.
	plain := setupManager(t, nil)
	plain.cfg.Columns = chores.cfg.Columns
	if got := requirementsOf(plain.SetupPlanFor("board2"), SetupStepWorkdir); !containsString(got, SetupRequiresGit) {
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

// The QA step names an agent, and the browser has to reach the agent that
// actually works the test column: the crew is resolved per column, so a server
// left on whichever agent was registered first is a session that dies saying it
// has nothing to test with.
func TestTheQAAnswerPutsTheBrowserOnTheStageThatTests(t *testing.T) {
	m := setupManager(t, boardProps(t, BoardAutomation{
		Columns: []ColumnSpec{
			{PropertyID: "p", OptionID: "o1", Property: "Статус", Column: "В работе", Action: FlowActionAgent},
			{PropertyID: "p", OptionID: "o3", Property: "Статус", Column: "QA", Action: FlowActionTest},
		},
	}))
	m.cfg.Agents = []AgentEntry{{Name: "клаус", Kind: "claude"}, {Name: "тестер", Kind: "claude"}}

	servers := MCPServerSet{"playwright": {Command: "npx", Args: []string{"-y", "@playwright/mcp@latest"}}}
	if err := m.SetTestAgent("board1", "тестер", servers); err != nil {
		t.Fatal(err)
	}

	// The browser belongs to the testing, not to the tester: setting up QA on
	// one board must not hand a browser to an agent every other board runs.
	for _, a := range m.Agents() {
		if len(a.MCPServers) > 0 {
			t.Errorf("agent %q was edited by one board's QA answer: %+v", a.Name, a.MCPServers)
		}
	}

	for _, c := range m.BoardColumns("board1") {
		switch c.Action {
		case FlowActionTest:
			if _, ok := c.MCPServers["playwright"]; !ok {
				t.Errorf("the stage that tests was not given the browser: %+v", c.MCPServers)
			}
			if len(c.Agents) != 1 || c.Agents[0] != "тестер" {
				t.Errorf("the test column's crew is %v, so the browser and the worker can part ways", c.Agents)
			}
		case FlowActionAgent:
			if len(c.Agents) > 0 {
				t.Errorf("answering the QA question crewed the column that works the card: %v", c.Agents)
			}
			if len(c.MCPServers) > 0 {
				t.Errorf("the browser landed on a column that does not test: %+v", c.MCPServers)
			}
		}
	}

	// And the plan reads itself back as answered, from the stage rather than
	// from any agent.
	for _, step := range m.SetupPlanFor("board1").Steps {
		if step.Kind == SetupStepBrowser && !step.Ready {
			t.Error("a board whose test stage carries a browser is still asked to find one")
		}
	}
}

// The agent step's answer, on a machine with more than one agent. It is the
// same shape as the QA one and it exists for the same reason: with no crew on
// the column and no agent named on the card, the engine has a registry of
// several and no rule to pick from it, so every card stalled on the column that
// works it. Only the stages that work a card are crewed — the one that tests
// answers its own question, on the step after this.
func TestTheAgentAnswerCrewsTheStagesThatWorkTheCard(t *testing.T) {
	m := setupManager(t, boardProps(t, BoardAutomation{
		Columns: []ColumnSpec{
			{PropertyID: "p", OptionID: "o1", Property: "Статус", Column: "В работе", Action: FlowActionAgent},
			{PropertyID: "p", OptionID: "o3", Property: "Статус", Column: "QA", Action: FlowActionTest},
		},
	}))
	m.cfg.Agents = []AgentEntry{{Name: "клаус", Kind: "claude"}, {Name: "тестер", Kind: "claude"}}

	// Before the answer: two agents, nobody assigned, and the card cannot be
	// given to either.
	if _, _, err := m.resolveSessionAgent(CardMoved{Props: map[string]string{}}, nil); err == nil {
		t.Fatal("two registered agents and no crew should be a question, not a choice made silently")
	}

	if err := m.SetWorkAgents("board1", []string{"клаус"}); err != nil {
		t.Fatal(err)
	}

	var crew []string
	for _, c := range m.BoardColumns("board1") {
		switch c.Action {
		case FlowActionAgent:
			crew = c.Agents
			if len(c.Agents) != 1 || c.Agents[0] != "клаус" {
				t.Errorf("the column that works a card is crewed %v", c.Agents)
			}
		case FlowActionTest:
			if len(c.Agents) > 0 {
				t.Errorf("answering who works the cards also crewed the column that tests: %v", c.Agents)
			}
		}
	}

	// And that is the whole of what the answer is for: the same card, on the
	// same registry, now resolves.
	got, _, err := m.resolveSessionAgent(CardMoved{Props: map[string]string{}}, crew)
	if err != nil || got.Name != "клаус" {
		t.Fatalf("the crew the wizard wrote did not answer the question: got=%+v err=%v", got, err)
	}

	// The agent is left as it was: who works this board is the board's fact,
	// and the registry is every board's.
	for _, a := range m.Agents() {
		if len(a.MCPServers) > 0 {
			t.Errorf("agent %q was edited by one board's answer: %+v", a.Name, a.MCPServers)
		}
	}
}

// Nobody chosen is an answer as much as somebody is: it takes the crew off, and
// a board that names nobody is back to what a board nobody has crewed does —
// every agent on the machine is a candidate. Without this the chips could be
// unticked and nothing would happen.
func TestTheAgentAnswerCanTakeTheCrewOff(t *testing.T) {
	m := setupManager(t, boardProps(t, BoardAutomation{
		Columns: []ColumnSpec{{PropertyID: "p", OptionID: "o1", Property: "Статус", Column: "В работе", Action: FlowActionAgent}},
		Flows: []FlowEntry{{
			Name: "Фича", Property: "Статус",
			Nodes: []FlowNode{{ID: "work", Column: "В работе", OptionID: "o1", Action: FlowActionAgent, AgentName: "клаус"}},
		}},
	}))
	m.cfg.Agents = []AgentEntry{{Name: "клаус", Kind: "claude"}, {Name: "тестер", Kind: "claude"}}

	if err := m.SetWorkAgents("board1", []string{"клаус", "тестер"}); err != nil {
		t.Fatal(err)
	}
	if got := m.SetupPlanFor("board1").WorkAgents; len(got) != 2 {
		t.Fatalf("a crew of two was not read back: %v", got)
	}

	if err := m.SetWorkAgents("board1", nil); err != nil {
		t.Fatal(err)
	}
	for _, c := range m.BoardColumns("board1") {
		if c.Action == FlowActionAgent && len(c.Agents) != 0 {
			t.Errorf("the column kept a crew after it was taken off: %v", c.Agents)
		}
	}

	// The stage's older single-agent field goes too, or Crew() would answer
	// with the name the person has just removed.
	for _, f := range m.BoardFlows("board1") {
		for _, n := range f.Nodes {
			if len(n.Crew()) != 0 {
				t.Errorf("the stage kept a crew after it was taken off: %v", n.Crew())
			}
		}
	}
	if got := m.BoardAgentNames("board1"); len(got) != 0 {
		t.Errorf("a board with no crew anywhere still names agents: %v", got)
	}
}

// What "the agents of this board" means to the card's assignee list: everybody
// the board names anywhere in its automation, whatever that stage does. The
// registry is the machine's, so this is the board's only answer about who works
// on it.
func TestABoardNamesTheAgentsItPutsToWork(t *testing.T) {
	m := setupManager(t, boardProps(t, BoardAutomation{
		Columns: []ColumnSpec{
			{PropertyID: "p", OptionID: "o1", Property: "Статус", Column: "В работе", Action: FlowActionAgent, Agents: []string{"клаус"}},
			{PropertyID: "p", OptionID: "o3", Property: "Статус", Column: "QA", Action: FlowActionTest, Agents: []string{"тестер"}},
		},
		Flows: []FlowEntry{{
			Name: "Фича", Property: "Статус",
			Nodes: []FlowNode{{ID: "review", Column: "Ревью", OptionID: "o2", Action: FlowActionAgent, AgentNames: []string{"ревьюер", "клаус"}}},
		}},
	}))

	got := m.BoardAgentNames("board1")
	want := map[string]bool{"клаус": true, "тестер": true, "ревьюер": true}
	if len(got) != len(want) {
		t.Fatalf("the board names %v", got)
	}
	for _, name := range got {
		if !want[name] {
			t.Errorf("%q is not one of this board's agents", name)
		}
	}
}

// A stage that tests on one route alone, over a column that does something
// else: the answer follows the stage there too, since that column would never
// have been found by its action.
func TestTheQAAnswerFollowsATestStageOfARoute(t *testing.T) {
	m := setupManager(t, boardProps(t, BoardAutomation{
		Columns: []ColumnSpec{{PropertyID: "p", OptionID: "o1", Property: "Статус", Column: "Проверка", Action: FlowActionNone}},
		Flows: []FlowEntry{{
			Name: "Фича", Property: "Статус",
			Nodes: []FlowNode{{ID: "check", Column: "Проверка", OptionID: "o1", Action: FlowActionTest}},
		}},
	}))
	m.cfg.Agents = []AgentEntry{{Name: "тестер", Kind: "claude"}}

	if err := m.SetTestAgent("board1", "тестер", MCPServerSet{"playwright": {Command: "npx"}}); err != nil {
		t.Fatal(err)
	}
	flows := m.BoardFlows("board1")
	if len(flows) != 1 || len(flows[0].Nodes) != 1 {
		t.Fatalf("flows: %+v", flows)
	}
	node := flows[0].Nodes[0]
	if _, ok := node.MCPServers["playwright"]; !ok {
		t.Errorf("the stage that tests was not given the browser: %+v", node.MCPServers)
	}
	if len(node.Crew()) != 1 || node.Crew()[0] != "тестер" {
		t.Errorf("the stage's crew is %v", node.Crew())
	}
	if len(m.Agents()[0].MCPServers) > 0 {
		t.Error("the agent was edited even though the stage could hold the answer")
	}
}

// A board with nothing that tests yet — the wizard walked from the menu before
// the column exists — has nowhere board-shaped to put the answer, so it goes on
// the agent as it always did. And the wizard knows about a browser and nothing
// else about that agent: rebuilding the entry from what it knows is how an
// agent already set up loses its model, its environment and its own prompt.
func TestTheQAAnswerKeepsTheRestOfTheAgent(t *testing.T) {
	m := setupManager(t, boardProps(t, BoardAutomation{
		Columns: []ColumnSpec{{PropertyID: "p", OptionID: "o1", Property: "Статус", Column: "В работе", Action: FlowActionAgent}},
	}))
	m.cfg.Agents = []AgentEntry{{
		Name: "тестер", Kind: "claude", Model: "opus",
		Env: map[string]string{"CLAUDE_CONFIG_DIR": "/tmp/qa"},
	}}

	if err := m.SetTestAgent("board1", "ТЕСТЕР", MCPServerSet{"playwright": {Command: "npx"}}); err != nil {
		t.Fatal(err)
	}
	saved := m.Agents()[0]
	if _, ok := saved.MCPServers["playwright"]; !ok {
		t.Error("with no stage to put it on, the browser should still land somewhere")
	}
	if saved.Model != "opus" || saved.Env["CLAUDE_CONFIG_DIR"] != "/tmp/qa" {
		t.Errorf("the agent was rebuilt from the QA answer alone: %+v", saved)
	}
}

// An answer for an agent that is not there is refused rather than filed against
// nobody: the name comes from the page, and a typo would otherwise silently
// leave the column crewed with an agent no session can resolve.
func TestTheQAAnswerRefusesAnAgentNobodyRegistered(t *testing.T) {
	m := setupManager(t, nil)
	if err := m.SetTestAgent("board1", "призрак", nil); err == nil {
		t.Fatal("an unregistered agent was accepted as the one that tests")
	}
}

// The question is about a column, so the plan says which one — the same way it
// already names the column a card is dragged into to be worked on.
func TestThePlanNamesTheColumnThatTests(t *testing.T) {
	m := setupManager(t, boardProps(t, BoardAutomation{
		Columns: []ColumnSpec{
			{PropertyID: "p", OptionID: "o1", Property: "Статус", Column: "В работе", Action: FlowActionAgent},
			{PropertyID: "p", OptionID: "o3", Property: "Статус", Column: "QA", Action: FlowActionTest},
		},
	}))

	plan := m.SetupPlanFor("board1")
	if plan.AgentColumn != "В работе" {
		t.Errorf("the column an agent works in is %q", plan.AgentColumn)
	}
	if plan.TestColumn != "QA" {
		t.Errorf("the column that tests is %q", plan.TestColumn)
	}
}

// A hint is the app's own sentence, shipped in a template, and a board made
// from that template carries its own copy — so fixing the wording in the
// template alone would leave every board already made saying the old thing.
func TestARetiredHintIsReplacedOnBoardsThatCarryIt(t *testing.T) {
	const retired = "Репозиторий с кодом: агент работает в отдельном worktree и оставляет ветку."

	if got := currentHint(retired); got == retired || got == "" {
		t.Errorf("the retired hint came back as %q", got)
	}
	// A sentence somebody wrote is theirs, whatever it says.
	if got := currentHint("папка с моими заметками"); got != "папка с моими заметками" {
		t.Errorf("a board's own hint was rewritten to %q", got)
	}
}
