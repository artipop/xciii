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

// A board imported from another machine names agents and deploy targets that
// were registered there. Reading it here cannot use those columns — and must
// not take them off the board, which is what "reading a board cannot shrink
// it" means. Before this, opening an imported board once emptied its
// its columns and there was nothing left to register the agent for.
func TestReadingABoardNeverTakesAutomationOffIt(t *testing.T) {
	m, meta, _ := storeManager(t)
	mine := ColumnSpec{Property: "Статус", Column: "Готово", Action: FlowActionNone}
	theirs := ColumnSpec{Property: "Статус", Column: "В работе", Action: FlowActionAgent, Agents: []string{"Клод"}}
	meta.props = map[string]any{
		BoardPropColumns: []ColumnSpec{mine, theirs},
		BoardPropFlows: []FlowEntry{{
			Name:  "Фича",
			Nodes: []FlowNode{{ID: "agent", Column: "В работе", Action: FlowActionAgent, AgentNames: []string{"Клод"}}},
		}},
	}

	m.SeedBoard("board1")

	columns, flows, err := parseBoardAutomation(meta.written["board1"])
	if err != nil {
		t.Fatal(err)
	}
	if len(columns) != 2 {
		t.Fatalf("the board kept %d of its 2 columns: %+v", len(columns), columns)
	}
	if len(flows) != 1 {
		t.Fatalf("the board kept %d of its 1 routes: %+v", len(flows), flows)
	}

	// The usable half did reach the registry; the other half did not, because
	// there is no agent here to run it.
	if len(m.cfg.Columns) != 1 || m.cfg.Columns[0].Column != "Готово" {
		t.Fatalf("the registry took %+v", m.cfg.Columns)
	}

	// Registering the agent and asking again — which is what the setup wizard
	// does — makes the column live without a restart, and still leaves the
	// board with both.
	if _, err := m.AddAgent(AgentEntry{Name: "Клод", Kind: "claude"}); err != nil {
		t.Fatal(err)
	}
	m.SeedBoard("board1")
	if len(m.cfg.Columns) != 2 {
		t.Fatalf("the registry took %+v after the agent was registered", m.cfg.Columns)
	}
	columns, _, err = parseBoardAutomation(meta.written["board1"])
	if err != nil {
		t.Fatal(err)
	}
	if len(columns) != 2 {
		t.Fatalf("the board ended up with %d columns: %+v", len(columns), columns)
	}
}

// What a board's agents are told first is about that board, not about this
// machine, so it lives on the board and travels with it — and stops being
// written to the machine's own file once the board has taken it.
func TestTheBoardsInstructionsAreSavedOnTheBoard(t *testing.T) {
	m, meta, cfgPath := storeManager(t)

	brief := BoardBrief{Board: "Отвечай по-русски.", Agents: map[string]string{"клаус": "Пиши тесты."}}
	if err := m.SetBoardBrief("board1", brief); err != nil {
		t.Fatal(err)
	}
	if got := meta.written["board1"][BoardPropPrompt]; got != "Отвечай по-русски." {
		t.Fatalf("the board was told %q", got)
	}
	if got := storedConfig(t, cfgPath).BoardPrompts["board1"]; got != "" {
		t.Errorf("the machine's file still carries the board's instructions: %q", got)
	}

	// What the board says to one agent travels the same way, and is not the
	// agent's own prompt: that one is the registry's and holds everywhere.
	written, _ := meta.written["board1"][BoardPropAgentPrompts].(map[string]string)
	if written["клаус"] != "Пиши тесты." {
		t.Fatalf("the board was told %v about its crew", meta.written["board1"][BoardPropAgentPrompts])
	}
	if got := storedConfig(t, cfgPath).BoardAgentPrompts["board1"]; len(got) != 0 {
		t.Errorf("the machine's file still carries them: %v", got)
	}

	// A board that unsaid it says so on the board, or the next launch would
	// hand the old text straight back.
	if err := m.SetBoardBrief("board1", BoardBrief{}); err != nil {
		t.Fatal(err)
	}
	if got := meta.written["board1"][BoardPropPrompt]; got != "" {
		t.Errorf("the board still holds %q after it was cleared", got)
	}
	if got, _ := meta.written["board1"][BoardPropAgentPrompts].(map[string]string); len(got) != 0 {
		t.Errorf("the board still holds %v after it was cleared", got)
	}
}

// The other direction: a board that arrives carrying instructions briefs its
// agents here without anybody retyping them.
func TestTheBoardsInstructionsAreTakenFromTheBoard(t *testing.T) {
	m, meta, _ := storeManager(t)
	meta.props = map[string]any{
		BoardPropPrompt:       "Отвечай по-русски.",
		BoardPropAgentPrompts: map[string]any{"клаус": "Пиши тесты."},
	}

	m.SeedBoard("board1")

	if got := m.BoardPrompt("board1"); got != "Отвечай по-русски." {
		t.Fatalf("the machine took %q from the board", got)
	}
	if got := m.BoardBriefOf("board1").Agents["клаус"]; got != "Пиши тесты." {
		t.Fatalf("what the board says to one agent came out as %q", got)
	}
}

// An install that predates this keeps the instruction in config.json, keyed by
// a board that has neither columns nor routes. It has to move too, or the one
// board whose prompt was the whole reason for the key would lose it.
func TestTheFilesInstructionsMoveOntoTheirBoards(t *testing.T) {
	m, meta, cfgPath := storeManager(t)
	m.cfg.BoardPrompts = map[string]string{"board1": "Отвечай по-русски."}

	m.moveAutomationToBoards()

	if got := meta.written["board1"][BoardPropPrompt]; got != "Отвечай по-русски." {
		t.Fatalf("the board was told %q", got)
	}
	if got := storedConfig(t, cfgPath).BoardPrompts["board1"]; got != "" {
		t.Errorf("the file still carries the instruction: %q", got)
	}
	// The registry itself is unchanged: what a session is told is still there.
	if got := m.BoardPrompt("board1"); got != "Отвечай по-русски." {
		t.Errorf("the move changed what a session is told: %q", got)
	}
}

// fakeCardState is the board seen as a place to keep one key per card.
type fakeCardState struct {
	state map[string]FlowState
	board map[string]string // card id → board id
}

func (f *fakeCardState) CardFlow(_ context.Context, cardID string) (FlowState, bool, error) {
	st, ok := f.state[cardID]
	return st, ok, nil
}

func (f *fakeCardState) SetCardFlow(_ context.Context, cardID string, st FlowState) error {
	if f.state == nil {
		f.state = map[string]FlowState{}
	}
	st.CardID = cardID
	f.state[cardID] = st
	return nil
}

func (f *fakeCardState) ClearCardFlow(_ context.Context, cardID string) error {
	delete(f.state, cardID)
	return nil
}

func (f *fakeCardState) BoardCardFlows(_ context.Context, boardID string) ([]FlowState, error) {
	out := []FlowState{}
	for cardID, st := range f.state {
		if f.board[cardID] == boardID {
			out = append(out, st)
		}
	}
	return out, nil
}

// A board arriving on this machine brings its parked cards with it, and this
// machine has to notice: the VCS watcher reads its own table to learn which
// branches to poll, so a card nobody indexed is a card waiting on a branch
// nobody is watching.
func TestParkedCardsOfANewBoardAreIndexedFromIt(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "acp.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	cfg := DefaultConfig(t.TempDir())
	m := NewManager(cfg, filepath.Join(t.TempDir(), "config.json"), store, newFakeWriter(), &fakeEmitter{}, nil)
	m.rootCtx = context.Background()
	m.SetBoardMeta(&fakeBoardMeta{props: map[string]any{BoardPropPrompt: "Отвечай по-русски."}})
	m.SetBoardCardState(&fakeCardState{
		state: map[string]FlowState{"cardOne": {CardID: "cardOne", Flow: "Фича", NodeID: "review", Branch: "feat/x", WorkdirPath: "/tmp/p"}},
		board: map[string]string{"cardOne": "board1"},
	})

	m.SeedBoard("board1")

	st, ok, err := store.FlowStateForCard("cardOne")
	if err != nil || !ok {
		t.Fatalf("the card was not indexed: %v, %v", ok, err)
	}
	if st.NodeID != "review" || st.Branch != "feat/x" {
		t.Errorf("indexed as %+v", st)
	}
}

// Setting a board's instructions can be the first thing that ever happens to a
// board — the automation editor need not have been opened. Every edit writes
// the whole of that board's automation back, so an edit made before the board
// was read once emptied a freshly made board's columns and routes.
func TestAnEditBeforeTheBoardWasEverReadKeepsItsAutomation(t *testing.T) {
	m, meta, _ := storeManager(t)
	meta.props = map[string]any{
		BoardPropColumns: []ColumnSpec{{Property: "Статус", Column: "В работе", Action: FlowActionAgent, Agents: []string{"Клод"}}},
		BoardPropFlows:   []FlowEntry{{Name: "Фича", Nodes: []FlowNode{{ID: "agent", Column: "В работе"}}}},
	}

	if err := m.SetBoardBrief("board1", BoardBrief{Board: "Отвечай по-русски."}); err != nil {
		t.Fatal(err)
	}

	columns, flows, err := parseBoardAutomation(meta.written["board1"])
	if err != nil {
		t.Fatal(err)
	}
	if len(columns) != 1 || len(flows) != 1 {
		t.Fatalf("the board was left with %d columns and %d routes", len(columns), len(flows))
	}
	if meta.written["board1"][BoardPropPrompt] != "Отвечай по-русски." {
		t.Errorf("the instruction did not land: %v", meta.written["board1"][BoardPropPrompt])
	}
}

// Every board made before the rename carries the keys under their old names.
// Reading has to find them, and the first write has to replace them — a board
// left with both would have two answers and no rule about which wins.
func TestABoardCarryingTheOldKeyNamesIsReadAndMigrated(t *testing.T) {
	m, meta, _ := storeManager(t)
	meta.props = map[string]any{
		"acpColumns": []ColumnSpec{{Property: "Статус", Column: "В работе", Action: FlowActionNone}},
		"acpFlows":   []FlowEntry{{Name: "Фича", Nodes: []FlowNode{{ID: "agent", Column: "В работе"}}}},
		"acpPrompt":  "Отвечай по-русски.",
		"acpSetup":   BoardSetup{Steps: []BoardSetupStep{{Kind: SetupStepWorkdir}}},
	}

	m.SeedBoard("board1")

	// Read: the registry took what the board carried under the old names.
	if len(m.cfg.Columns) != 1 || m.cfg.Columns[0].Column != "В работе" {
		t.Fatalf("the registry took %+v", m.cfg.Columns)
	}
	if len(m.cfg.Flows) != 1 {
		t.Fatalf("the registry took %+v", m.cfg.Flows)
	}
	if got := m.BoardPrompt("board1"); got != "Отвечай по-русски." {
		t.Errorf("the instruction came back as %q", got)
	}

	// Written back: new names hold it, old names are gone from the board.
	written := meta.written["board1"]
	columns, flows, err := parseBoardAutomation(written)
	if err != nil {
		t.Fatal(err)
	}
	if len(columns) != 1 || len(flows) != 1 {
		t.Fatalf("the board kept %d columns and %d routes", len(columns), len(flows))
	}
	if written[BoardPropPrompt] != "Отвечай по-русски." {
		t.Errorf("the board holds the instruction as %v", written[BoardPropPrompt])
	}
	// The questions a template declared are read here and written only by the
	// template editor, so a rename that deleted the old name without writing
	// the new one took them off the board for good.
	if _, ok := written[BoardPropSetup]; !ok {
		t.Errorf("the board lost the questions it declared: %v", written)
	}
	for _, legacy := range legacyNamesOf(BoardPropColumns, BoardPropFlows, BoardPropPrompt, BoardPropSetup) {
		if _, still := written[legacy]; still {
			t.Errorf("the board still carries %q after being written", legacy)
		}
	}
}
