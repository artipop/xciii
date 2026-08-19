package acp

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
)

// A board set up before references were ids carries names: a crew of agent
// names, a deploy target by name, a route with no id of its own. Reading it once
// has to leave it working and leave the names behind — this is what runs against
// somebody's real boards the first time they open the app after the change, so
// it is checked end to end rather than a fold at a time.
func TestABoardWrittenWithNamesIsMigratedOnFirstRead(t *testing.T) {
	dir := t.TempDir()
	store, err := newTestStore(t, filepath.Join(dir, "xciii.db"))
	if err != nil {
		t.Fatal(err)
	}

	cfg := DefaultConfig(dir)
	cfg.Agents = []AgentEntry{
		{ID: "ag-klaus", Name: "клаус", Kind: AgentKindClaude},
		{ID: "ag-review", Name: "ревьюер", Kind: AgentKindClaude},
	}
	cfg.Deploys = []DeployEntry{{ID: "dep-prod", Name: "прод"}}
	m := NewManager(cfg, "", store, newFakeWriter(), &fakeEmitter{}, nil)
	m.rootCtx = context.Background()

	// The board as an older version left it: crews and a target by name, a
	// stage that knows only its column's name, a route with no id.
	board := &fakeBoardMeta{
		props: boardProps(t, BoardAutomation{
			Columns: []ColumnSpec{
				{PropertyID: "p", OptionID: "opt-work", Property: "Статус", Column: "В работе",
					Action: FlowActionAgent, Agents: []string{"клаус"}},
				{Property: "Статус", Column: "Ревью", Action: FlowActionAgent, Agents: []string{"ревьюер"}},
				{PropertyID: "p", OptionID: "opt-deploy", Property: "Статус", Column: "Деплой",
					Action: FlowActionDeploy, DeployName: "прод"},
			},
			Flows: []FlowEntry{{
				Name: "Фича", Property: "Статус",
				Nodes: []FlowNode{
					{ID: "work", Column: "В работе", OptionID: "opt-work", AgentName: "клаус"},
					{ID: "review", Column: "Ревью", Action: FlowActionNone},
				},
				Edges: []FlowEdge{{From: "work", To: "review", On: TriggerSuccess}},
			}},
		}),
		// What the board's own column property offers, which is how a column
		// and a stage that know only a name are bound to an option.
		options: []Column{
			{PropertyID: "p", PropertyName: "Статус", OptionID: "opt-work", Name: "В работе"},
			{PropertyID: "p", PropertyName: "Статус", OptionID: "opt-review", Name: "Ревью"},
			{PropertyID: "p", PropertyName: "Статус", OptionID: "opt-deploy", Name: "Деплой"},
		},
	}
	m.SetBoardMeta(board)

	m.SeedBoard("board1")

	// 1. The registry took the board's automation, by id.
	columns := m.BoardColumns("board1")
	if len(columns) != 3 {
		t.Fatalf("columns adopted: %+v", columns)
	}
	byOption := map[string]ColumnSpec{}
	for _, c := range columns {
		byOption[c.OptionID] = c
	}
	work, ok := byOption["opt-work"]
	if !ok || len(work.AgentIDs) != 1 || work.AgentIDs[0] != "ag-klaus" || len(work.Agents) != 0 {
		t.Fatalf("the crew was not folded into ids: %+v", work)
	}
	// The column that knew only its name found its option.
	review, ok := byOption["opt-review"]
	if !ok || len(review.AgentIDs) != 1 || review.AgentIDs[0] != "ag-review" {
		t.Fatalf("a column known by name was not bound: %+v", byOption)
	}
	deploy := byOption["opt-deploy"]
	if deploy.DeployID != "dep-prod" || deploy.DeployName != "" {
		t.Fatalf("the deploy target was not folded: %+v", deploy)
	}

	// 2. The route got an id, and its stages got theirs.
	flows := m.BoardFlows("board1")
	if len(flows) != 1 {
		t.Fatalf("routes adopted: %+v", flows)
	}
	flow := flows[0]
	if flow.ID == "" {
		t.Fatal("the route was adopted without an id, so no card can stand on it")
	}
	if len(flow.Nodes[0].AgentIDs) != 1 || flow.Nodes[0].AgentIDs[0] != "ag-klaus" ||
		flow.Nodes[0].AgentName != "" {
		t.Fatalf("the stage's single agent was not folded: %+v", flow.Nodes[0])
	}
	if flow.Nodes[1].OptionID != "opt-review" {
		t.Fatalf("a stage known by name was not bound to its option: %+v", flow.Nodes[1])
	}

	// 3. And the board itself was rewritten with what the registry now holds:
	// this is the write that lands on somebody's real board.
	written := board.written["board1"]
	if written == nil {
		t.Fatal("the board was not written back")
	}
	raw, err := json.Marshal(written[BoardPropColumns])
	if err != nil {
		t.Fatal(err)
	}
	var back []ColumnSpec
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatal(err)
	}
	for _, c := range back {
		if len(c.Agents) > 0 || c.DeployName != "" {
			t.Errorf("a name was written back onto the board: %+v", c)
		}
		if c.OptionID == "" {
			t.Errorf("a column was written back unbound: %+v", c)
		}
	}
	if written[BoardPropColumnProperty] != "p" {
		t.Errorf("the board was not told which property its columns are on: %v", written[BoardPropColumnProperty])
	}

	// 4. Reading it a second time changes nothing and duplicates nothing —
	// the seed is what every card move goes through.
	m.seededMu.Lock()
	m.seeded = nil
	m.seededMu.Unlock()
	board.props = written
	m.SeedBoard("board1")
	if got := len(m.BoardFlows("board1")); got != 1 {
		t.Fatalf("a second read duplicated the route: %d", got)
	}
	if got := len(m.BoardColumns("board1")); got != 3 {
		t.Fatalf("a second read duplicated the columns: %d", got)
	}
}

// The other half of the same migration: once the board says ids, renaming the
// things it points at costs nothing.
func TestRenamingAfterTheMigrationKeepsTheBoardWorking(t *testing.T) {
	dir := t.TempDir()
	store, err := newTestStore(t, filepath.Join(dir, "xciii.db"))
	if err != nil {
		t.Fatal(err)
	}
	m := agentManager(t, filepath.Join(dir, "config.json"), AgentEntry{Name: "клаус", Kind: AgentKindClaude})
	_ = store

	agent := m.Agents()[0]
	target, err := m.AddDeploy(deployEntry("прод"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.SaveColumn(ColumnSpec{
		BoardID: "board1", PropertyID: "p", OptionID: "opt-work", Property: "Статус",
		Column: "В работе", Action: FlowActionAgent, AgentIDs: []string{agent.ID},
	}); err != nil {
		t.Fatal(err)
	}

	renamedAgent := agent
	renamedAgent.Name = "клаус второй"
	if _, err := m.UpdateAgent(renamedAgent); err != nil {
		t.Fatalf("an agent could not be renamed after the migration: %v", err)
	}
	renamedTarget := target
	renamedTarget.Name = "боевой"
	if _, err := m.UpdateDeploy(renamedTarget); err != nil {
		t.Fatalf("a deploy target could not be renamed: %v", err)
	}

	spec, ok := m.columnFor("board1", Column{PropertyID: "p", PropertyName: "Этап", OptionID: "opt-work", Name: "Другое имя"})
	if !ok {
		t.Fatal("the column stopped being found after everything around it was renamed")
	}
	crew, err := crewOf(spec.AgentIDs, m.Agents())
	if err != nil || len(crew) != 1 || crew[0].Name != "клаус второй" {
		t.Fatalf("the crew did not survive the rename: %+v %v", crew, err)
	}
}
