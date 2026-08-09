package acp

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// storeManager is a manager with a real config file and a board store that
// records what it was told to keep.
func storeManager(t *testing.T) (*Manager, *fakeBoardMeta, string) {
	t.Helper()
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	m := agentManager(t, cfgPath)
	m.cfg.Columns, m.cfg.Flows = nil, nil
	m.rootCtx = context.Background()
	meta := &fakeBoardMeta{}
	m.SetBoardMeta(meta)
	return m, meta, cfgPath
}

// storedConfig is what the machine's own file ended up holding.
func storedConfig(t *testing.T, path string) Config {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read the config: %v", err)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("parse the config: %v", err)
	}
	return cfg
}

// A board's automation belongs to the board, so editing it writes to the board
// and leaves nothing about that board in the machine's own file — which is what
// makes it travel with the board and disappear with it.
func TestABoardsAutomationIsSavedOnTheBoard(t *testing.T) {
	m, meta, cfgPath := storeManager(t)

	if _, err := m.SaveColumn(ColumnSpec{BoardID: "board1", Property: "Статус", Column: "В работе", Action: FlowActionAgent}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.AddFlow(FlowEntry{
		BoardID: "board1",
		Name:    "Фича",
		Nodes:   []FlowNode{{ID: "agent", Column: "В работе"}},
	}); err != nil {
		t.Fatal(err)
	}

	board := meta.written["board1"]
	if board == nil {
		t.Fatal("the board was never told about its own automation")
	}
	columns, flows, err := parseBoardAutomation(board)
	if err != nil {
		t.Fatal(err)
	}
	if len(columns) != 1 || columns[0].Column != "В работе" {
		t.Errorf("the board holds columns %+v", columns)
	}
	if len(flows) != 1 || flows[0].Name != "Фича" {
		t.Errorf("the board holds routes %+v", flows)
	}

	stored := storedConfig(t, cfgPath)
	if len(stored.Columns) != 0 || len(stored.Flows) != 0 {
		t.Errorf("the machine's file still carries the board's automation: %+v %+v", stored.Columns, stored.Flows)
	}
}

// Deleting the last route of a board has to reach the board too: a board that
// kept what was deleted would hand it straight back on the next launch.
func TestDeletingARouteReachesTheBoard(t *testing.T) {
	m, meta, _ := storeManager(t)

	if _, err := m.AddFlow(FlowEntry{BoardID: "board1", Name: "Фича", Nodes: []FlowNode{{ID: "a", Column: "В работе"}}}); err != nil {
		t.Fatal(err)
	}
	if err := m.RemoveFlow("board1", "Фича"); err != nil {
		t.Fatal(err)
	}

	_, flows, err := parseBoardAutomation(meta.written["board1"])
	if err != nil {
		t.Fatal(err)
	}
	if len(flows) != 0 {
		t.Errorf("the board still holds %d routes after the only one was deleted", len(flows))
	}
}

// An install that predates this keeps its automation in config.json. It moves
// onto the boards at startup, once, and the file stops carrying it.
func TestTheFilesAutomationMovesOntoItsBoards(t *testing.T) {
	m, meta, cfgPath := storeManager(t)
	m.cfg.Columns = []ColumnSpec{
		{BoardID: "board1", Property: "Статус", Column: "В работе", Action: FlowActionAgent},
		{Property: "Статус", Column: "In Progress", Action: FlowActionAgent}, // no board: the machine's own
	}
	m.cfg.Flows = []FlowEntry{{BoardID: "board2", Name: "Хотфикс", Nodes: []FlowNode{{ID: "a", Column: "В работе"}}}}

	m.moveAutomationToBoards()

	if meta.written["board1"] == nil || meta.written["board2"] == nil {
		t.Fatalf("boards written: %v", meta.written)
	}
	stored := storedConfig(t, cfgPath)
	if len(stored.Columns) != 1 || stored.Columns[0].Column != "In Progress" {
		t.Errorf("the file should keep only what belongs to no board, kept %+v", stored.Columns)
	}
	if len(stored.Flows) != 0 {
		t.Errorf("the file still carries routes: %+v", stored.Flows)
	}

	// The registry itself is unchanged: what runs is still everything.
	if len(m.cfg.Columns) != 2 || len(m.cfg.Flows) != 1 {
		t.Errorf("the move changed what the engine reads: %+v %+v", m.cfg.Columns, m.cfg.Flows)
	}
}

// A board that cannot be written to must not lose what somebody drew: the file
// keeps it until a write gets through.
func TestAutomationStaysInTheFileWhileTheBoardRefusesIt(t *testing.T) {
	m, meta, cfgPath := storeManager(t)
	meta.fail = errors.New("board store is not ready")

	if _, err := m.SaveColumn(ColumnSpec{BoardID: "board1", Property: "Статус", Column: "В работе", Action: FlowActionAgent}); err != nil {
		t.Fatal(err)
	}

	stored := storedConfig(t, cfgPath)
	if len(stored.Columns) != 1 {
		t.Fatalf("the column was dropped from the file with no board to hold it: %+v", stored.Columns)
	}

	// And it moves the moment the board can take it.
	meta.fail = nil
	if _, err := m.SaveColumn(ColumnSpec{BoardID: "board1", Property: "Статус", Column: "В работе", Action: FlowActionDeploy}); err != nil {
		t.Fatal(err)
	}
	if len(storedConfig(t, cfgPath).Columns) != 0 {
		t.Error("the file still carries the column after the board took it")
	}
}
