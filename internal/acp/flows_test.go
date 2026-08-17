package acp

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

// sampleFlow is the route the engine tests walk: agent → review → deploy.
func sampleFlow() FlowEntry {
	return FlowEntry{
		Name:     "feature",
		Property: "Status",
		Nodes: []FlowNode{
			{ID: "work", Column: "To Agent", Action: FlowActionAgent},
			{ID: "review", Column: "Review", Action: FlowActionNone},
			{ID: "blocked", Column: "Blocked", Action: FlowActionNone},
		},
		Edges: []FlowEdge{
			{From: "work", To: "review", On: TriggerSuccess},
			{From: "work", To: "blocked", On: TriggerFailure},
			{From: "review", To: "blocked", On: TriggerPRClosed},
		},
	}
}

func TestValidateFlow(t *testing.T) {
	workdirs := []WorkdirEntry{{Name: "webapp", Path: "/projects/webapp"}}
	agents := []AgentEntry{{Name: "claude-1", Kind: AgentKindClaude}}
	deploys := []DeployEntry{deployEntry("prod")}

	if _, err := validateFlow(sampleFlow(), workdirs, agents, deploys); err != nil {
		t.Fatalf("a well-formed flow was rejected: %v", err)
	}

	cases := map[string]func(*FlowEntry){
		"пустое имя":                  func(f *FlowEntry) { f.Name = "  " },
		"нет стадий":                  func(f *FlowEntry) { f.Nodes = nil },
		"стадия без колонки":          func(f *FlowEntry) { f.Nodes[1].Column = "" },
		"две стадии на одной колонке": func(f *FlowEntry) { f.Nodes[1].Column = "To Agent" },
		"дубль идентификатора":        func(f *FlowEntry) { f.Nodes[1].ID = "work" },
		"неизвестное действие":        func(f *FlowEntry) { f.Nodes[1].Action = "deploy-maybe" },
		"переход в никуда":            func(f *FlowEntry) { f.Edges[0].To = "ghost" },
		"переход ниоткуда":            func(f *FlowEntry) { f.Edges[0].From = "ghost" },
		"неизвестное событие":         func(f *FlowEntry) { f.Edges[0].On = "pr.reviewed" },
		"два перехода по одному событию": func(f *FlowEntry) {
			f.Edges = append(f.Edges, FlowEdge{From: "work", To: "blocked", On: TriggerSuccess})
		},
		"неизвестный проект": func(f *FlowEntry) { f.WorkdirName = "nosuchproject" },
		"неизвестный агент":  func(f *FlowEntry) { f.Nodes[0].AgentName = "nosuchagent" },
		"неизвестная цель":   func(f *FlowEntry) { f.Nodes[0].DeployName = "nosuchtarget" },
		"пустое условие":     func(f *FlowEntry) { f.Edges[0].If = &EdgeCond{} },
		"условие про оба сразу": func(f *FlowEntry) {
			f.Edges[0].If = &EdgeCond{Property: "Приоритет", Value: "Высокий", CommentContains: "готово"}
		},
		"условие без значения": func(f *FlowEntry) { f.Edges[0].If = &EdgeCond{Property: "Приоритет"} },
		"ответ агента на VCS-переходе": func(f *FlowEntry) {
			f.Edges[2].If = &EdgeCond{CommentContains: "готово"} // pr.closed: агент там не говорил
		},
		"card.changed без опции": func(f *FlowEntry) {
			f.Edges = append(f.Edges, FlowEdge{From: "review", To: "blocked", On: TriggerCardChanged})
		},
		"два безусловных перехода по одному событию": func(f *FlowEntry) {
			f.Edges = append(f.Edges, FlowEdge{From: "work", To: "blocked", On: TriggerSuccess})
		},
	}
	for name, break_ := range cases {
		f := sampleFlow()
		break_(&f)
		if _, err := validateFlow(f, workdirs, agents, deploys); err == nil {
			t.Errorf("%s: принято без ошибки", name)
		}
	}

	// References that do exist are accepted, and an empty action defaults to none.
	f := sampleFlow()
	f.WorkdirName = "WEBAPP"
	// A stage that named one agent becomes a stage with a crew of one.
	f.Nodes[0].AgentName = "claude-1"
	// And an empty action is kept as it is: the stage does whatever its column
	// does, which is not the same as doing nothing.
	f.Nodes[1].Action = ""
	got, err := validateFlow(f, workdirs, agents, deploys)
	if err != nil {
		t.Fatal(err)
	}
	if got.Nodes[1].Action != "" {
		t.Fatalf("an empty action must stay empty: %+v", got.Nodes[1])
	}
	if len(got.Nodes[0].AgentNames) != 1 || got.Nodes[0].AgentNames[0] != "claude-1" || got.Nodes[0].AgentName != "" {
		t.Fatalf("the old single agent was not folded into the crew: %+v", got.Nodes[0])
	}

	// Several conditional edges on one event are the point of conditions: the
	// fork. They are told apart by their conditions, and one fallback is fine.
	f = sampleFlow()
	f.Edges = append(f.Edges,
		FlowEdge{From: "work", To: "blocked", On: TriggerSuccess, If: &EdgeCond{Property: "Приоритет", Value: "Низкий"}},
		FlowEdge{From: "work", To: "review", On: TriggerSuccess, If: &EdgeCond{CommentContains: "READY"}},
	)
	if _, err := validateFlow(f, workdirs, agents, deploys); err != nil {
		t.Fatalf("a fork of conditional edges was rejected: %v", err)
	}
}

func TestAddUpdateRemoveFlowPersists(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	m := agentManager(t, cfgPath)

	if _, err := m.AddFlow(sampleFlow()); err != nil {
		t.Fatal(err)
	}
	if _, err := m.AddFlow(sampleFlow()); err == nil {
		t.Error("duplicate name accepted")
	}

	updated := sampleFlow()
	updated.Nodes[1].Column = "Ревью"
	if _, err := m.UpdateFlow(updated); err != nil {
		t.Fatal(err)
	}
	if _, err := m.UpdateFlow(FlowEntry{Name: "ghost", Nodes: []FlowNode{{ID: "a", Column: "A"}}}); err == nil {
		t.Error("update of an unknown flow accepted")
	}

	loaded, err := LoadConfig(cfgPath, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Flows) != 1 || loaded.Flows[0].Nodes[1].Column != "Ревью" {
		t.Fatalf("config did not persist the update: %+v", loaded.Flows)
	}

	if err := m.RemoveFlow("", "FEATURE"); err != nil {
		t.Fatal(err)
	}
	if len(m.Flows()) != 0 {
		t.Fatalf("flow not removed: %+v", m.Flows())
	}
}

// Two boards each name their route «Фича» and mean different things by it, so
// the registry is keyed by the board as well as the name — otherwise the second
// board cannot even save its own.
func TestFlowsAreScopedToTheirBoard(t *testing.T) {
	m := agentManager(t, filepath.Join(t.TempDir(), "config.json"))

	first := sampleFlow()
	first.BoardID = "board-1"
	if _, err := m.AddFlow(first); err != nil {
		t.Fatal(err)
	}
	second := sampleFlow()
	second.BoardID = "board-2"
	second.Nodes[1].Column = "Ревью"
	if _, err := m.AddFlow(second); err != nil {
		t.Fatalf("another board cannot have a route of the same name: %v", err)
	}
	if _, err := m.AddFlow(second); err == nil {
		t.Error("the same board took the same name twice")
	}

	// Editing and deleting reach that board's route and leave the other's alone.
	edited := second
	edited.Nodes[0].Column = "В работе 2"
	if _, err := m.UpdateFlow(edited); err != nil {
		t.Fatal(err)
	}
	if err := m.RemoveFlow("board-2", edited.Name); err != nil {
		t.Fatal(err)
	}
	left := m.Flows()
	if len(left) != 1 || left[0].BoardID != "board-1" {
		t.Fatalf("removing one board's route took another's: %+v", left)
	}
}

// A board's automation is read back out of the registry to become a template:
// the option ids survive (a copy keeps its card properties) and the board id
// does not (the copy is a different board).
func TestBoardAutomationIsExportedWithoutTheBoard(t *testing.T) {
	m := agentManager(t, "")
	m.cfg.Columns = []ColumnSpec{
		{BoardID: "board-1", OptionID: "opt-1", Property: "Статус", Column: "В работе", Action: FlowActionAgent},
		{BoardID: "board-2", OptionID: "opt-9", Property: "Статус", Column: "Чужая", Action: FlowActionAgent},
	}
	flow := sampleFlow()
	flow.BoardID = "board-1"
	m.cfg.Flows = []FlowEntry{flow}

	got := m.BoardAutomation("board-1")
	if len(got.Columns) != 1 || got.Columns[0].BoardID != "" || got.Columns[0].OptionID != "opt-1" {
		t.Fatalf("columns exported wrong: %+v", got.Columns)
	}
	if len(got.Flows) != 1 || got.Flows[0].BoardID != "" {
		t.Fatalf("routes exported wrong: %+v", got.Flows)
	}
}

func TestResolveFlow(t *testing.T) {
	m := agentManager(t, "")
	m.cfg.Workdirs = []WorkdirEntry{{Name: "webapp", Path: "/projects/webapp"}}
	feature := sampleFlow()
	hotfix := sampleFlow()
	hotfix.Name = "hotfix"
	hotfix.WorkdirName = "webapp"
	m.cfg.Flows = []FlowEntry{feature, hotfix}

	// 1. A card option naming a flow wins.
	if f := m.resolveFlow(CardMoved{OptionNames: []string{"webapp", "feature"}}, "/projects/webapp"); f == nil || f.Name != "feature" {
		t.Fatalf("option match: %+v", f)
	}
	// 2. Otherwise the flow tied to the card's folder.
	if f := m.resolveFlow(CardMoved{OptionNames: []string{"webapp"}}, "/projects/webapp"); f == nil || f.Name != "hotfix" {
		t.Fatalf("project match: %+v", f)
	}
	// 3. Ambiguity means no route rather than a guess — the legacy columns then
	//    keep working for that card.
	if f := m.resolveFlow(CardMoved{}, "/projects/other"); f != nil {
		t.Fatalf("two unrelated flows should not resolve: %+v", f)
	}
	// 4. A single registered flow is the answer by default.
	m.cfg.Flows = []FlowEntry{feature}
	if f := m.resolveFlow(CardMoved{}, "/projects/other"); f == nil || f.Name != "feature" {
		t.Fatalf("single flow: %+v", f)
	}
	m.cfg.Flows = nil
	if f := m.resolveFlow(CardMoved{}, "/projects/other"); f != nil {
		t.Fatalf("empty registry: %+v", f)
	}
}

func TestFlowGraphLookups(t *testing.T) {
	f := sampleFlow()

	if n, ok := f.NodeByColumn("to agent"); !ok || n.ID != "work" {
		t.Fatalf("column lookup is case-sensitive: %+v", n)
	}
	if n, _, ok := f.Next("work", TriggerSuccess, nil, ""); !ok || n.ID != "review" {
		t.Fatalf("success edge: %+v", n)
	}
	if _, _, ok := f.Next("review", TriggerSuccess, nil, ""); ok {
		t.Fatal("a node without an edge must not resolve one")
	}
	// Only the VCS triggers make a node worth polling for.
	if waits := f.WaitsFor("review"); len(waits) != 1 || waits[0] != TriggerPRClosed {
		t.Fatalf("waits: %v", waits)
	}
	if waits := f.WaitsFor("work"); len(waits) != 0 {
		t.Fatalf("outcome edges are not polled for: %v", waits)
	}
	if f.PropertyOr("Status2") != "Status" {
		t.Fatal("the flow's own property should win")
	}
	f.Property = ""
	if f.PropertyOr("Status2") != "Status2" {
		t.Fatal("fallback property not used")
	}
}

func TestTriggerMetadata(t *testing.T) {
	if !IsVCSTrigger(TriggerPRMerged) || !IsGitHubTrigger(TriggerPRMerged) {
		t.Fatal("pr.merged comes from GitHub")
	}
	if !IsVCSTrigger(TriggerBranchMerged) || IsGitHubTrigger(TriggerBranchMerged) {
		t.Fatal("branch.merged comes from local git")
	}
	if IsVCSTrigger(TriggerSuccess) || IsGitHubTrigger(TriggerSuccess) {
		t.Fatal("success is produced by the stage itself")
	}
	if _, ok := Trigger("pr.rebased"); ok {
		t.Fatal("the trigger set must be closed")
	}
	if TriggerLabel(TriggerSuccess) == TriggerSuccess {
		t.Fatal("a known trigger should have a human label")
	}
}

// The routes the editor offers a board that has none. They used to be built
// from five column-name keys in the machine's settings — which is how the
// settings of one machine came to name the columns of everybody's board — and
// the names are the templates' own now.
func TestTheOfferedRoutesAreValidAndStandOnTheTemplateColumns(t *testing.T) {
	cfg := DefaultConfig(t.TempDir())
	flows := TemplateFlows(cfg)
	if len(flows) < 2 {
		t.Fatalf("a template with one route offers no choice: %+v", flows)
	}
	for _, f := range flows {
		// Every offered route has to be one the engine would accept from the
		// editor: offering a route that cannot be saved is offering nothing.
		if _, err := validateFlow(f, nil, nil, nil); err != nil {
			t.Fatalf("template flow %q is invalid: %v", f.Name, err)
		}
		if f.Property != cfg.TriggerProperty {
			t.Fatalf("%s: property %q", f.Name, f.Property)
		}
	}

	feature, ok := flowNamed(flows, TemplateFlowFeature)
	if !ok {
		t.Fatalf("no %q route among %+v", TemplateFlowFeature, flows)
	}
	for _, column := range []string{TemplateWorkColumn, TemplateDeployColumn, TemplateTestColumn} {
		if _, ok := feature.NodeByColumn(column); !ok {
			t.Errorf("the feature route has no stage on %q", column)
		}
	}
}

func flowNamed(flows []FlowEntry, name string) (FlowEntry, bool) {
	for _, f := range flows {
		if f.Name == name {
			return f, true
		}
	}
	return FlowEntry{}, false
}

// What used to stand here: a test that LoadConfig seeded the template routes
// into the machine's settings for an install that predated routes, and that an
// emptied list survived a restart. Both went with the seeding
// (docs/store-plan.md, step 3): a board carries its own routes.

func TestFlowEntryJSONRoundTrip(t *testing.T) {
	b, err := json.Marshal(sampleFlow())
	if err != nil {
		t.Fatal(err)
	}
	// The editor round-trips this shape, so the field names matter.
	for _, want := range []string{`"nodes"`, `"edges"`, `"column"`, `"action"`, `"from"`, `"to"`, `"on"`} {
		if !strings.Contains(string(b), want) {
			t.Fatalf("serialized flow lacks %s: %s", want, b)
		}
	}
	var back FlowEntry
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	if len(back.Nodes) != 3 || len(back.Edges) != 3 {
		t.Fatalf("round trip lost data: %+v", back)
	}
}

// The builder puts a stage where the reader wants it, and that has to survive
// the round trip — otherwise the canvas silently rearranges itself on reload.
func TestFlowNodeKeepsWhereItWasPut(t *testing.T) {
	f := sampleFlow()
	f.Nodes[0].X, f.Nodes[0].Y = 420, 80

	encoded, err := json.Marshal(f)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"x":420`) {
		t.Fatalf("the position was not written: %s", encoded)
	}
	var back FlowEntry
	if err := json.Unmarshal(encoded, &back); err != nil {
		t.Fatal(err)
	}
	saved, err := validateFlow(back, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Nodes[0].X != 420 || saved.Nodes[0].Y != 80 {
		t.Fatalf("validation lost the position: %+v", saved.Nodes[0])
	}
	// A stage nobody placed stays unplaced, so it is laid out rather than
	// pinned to the top-left corner.
	if saved.Nodes[1].X != 0 || saved.Nodes[1].Y != 0 {
		t.Fatalf("an unplaced stage gained a position: %+v", saved.Nodes[1])
	}
}

// Where a stage works is the stage's own answer, and the default is what that
// kind of stage has always done — so a route written before the question
// existed keeps working exactly as it did.
func TestAStageSaysWhereItWorks(t *testing.T) {
	cases := []struct {
		node   FlowNode
		action string
		want   string
	}{
		{FlowNode{}, FlowActionAgent, RunInOwner},
		{FlowNode{}, FlowActionDeploy, RunInWorkdir},
		{FlowNode{}, FlowActionTest, RunInWorkdir},
		// QA on the card's own code, before anything is merged.
		{FlowNode{RunIn: RunInOwner}, FlowActionTest, RunInOwner},
		{FlowNode{RunIn: RunInWorkdir}, FlowActionAgent, RunInWorkdir},
		// Nonsense falls back to the default rather than to nothing.
		{FlowNode{RunIn: "somewhere"}, FlowActionAgent, RunInOwner},
	}
	for _, c := range cases {
		if got := c.node.RunsIn(c.action); got != c.want {
			t.Errorf("a %s stage with runIn=%q works in %q, want %q", c.action, c.node.RunIn, got, c.want)
		}
	}
}
