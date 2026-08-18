package acp

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// The grant is the whole of the door: the token names the board, so an agent
// that read its own environment still cannot write anywhere else.
func TestBoardToolsWriteOnlyToTheGrantedBoard(t *testing.T) {
	m, writer, _, _ := testManager(t, "idle", func(cfg *Config) {
		cfg.TriggerProperty = "Статус"
	})

	token := m.GrantBoardTools("board-1", "", "")
	if token == "" {
		t.Fatal("no token was minted")
	}

	id, err := m.CreateCardFromTools(t.Context(), token, NewCard{
		Title:   "Починить окно планирования",
		Body:    "Оно открывается пополам.",
		Column:  "К агенту",
		Options: []string{"xciii"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if id == "" {
		t.Error("the card was created without an id to point at")
	}

	if len(writer.created) != 1 {
		t.Fatalf("board writes: %d, want 1", len(writer.created))
	}
	got := writer.created[0]
	if got.BoardID != "board-1" {
		t.Errorf("card landed on board %q, want the granted one", got.BoardID)
	}
	// The column property is the config's, not the agent's: it names columns
	// and nothing else.
	if got.Property != "Статус" {
		t.Errorf("column property %q, want the configured one", got.Property)
	}
	if got.Column != "К агенту" || len(got.Options) != 1 {
		t.Errorf("card lost what was asked for: %+v", got)
	}
}

// A grant that outlived its agent run would be a door left open, so revoking is
// what closing a run means — and a card still needs a title.
func TestBoardToolsRefuseWhatTheyShould(t *testing.T) {
	m, _, _, _ := testManager(t, "idle", nil)

	if _, err := m.CreateCardFromTools(t.Context(), "not-a-token", NewCard{Title: "Задача"}); err == nil {
		t.Error("a made-up token opened the board")
	}

	token := m.GrantBoardTools("board-1", "", "")
	if _, err := m.CreateCardFromTools(t.Context(), token, NewCard{Title: "   "}); err == nil {
		t.Error("a card with no title was accepted")
	}

	m.RevokeBoardTools(token)
	if _, err := m.CreateCardFromTools(t.Context(), token, NewCard{Title: "Задача"}); err == nil {
		t.Error("a revoked grant still opened the board")
	}
	if err := m.CheckBoardTools(token); err == nil {
		t.Error("a revoked grant still checks out")
	}
}

// boardWithCards is a manager whose board can be read: two cards on the granted
// board and one on another, which is the case every card call has to refuse.
func boardWithCards(t *testing.T) (*Manager, *fakeWriter) {
	t.Helper()
	m, writer, _, _ := testManager(t, "idle", func(cfg *Config) {
		cfg.TriggerProperty = "Статус"
		cfg.Columns = append(cfg.Columns,
			ColumnSpec{BoardID: "board-1", PropertyID: "p", OptionID: "opt-toagent", Property: "Статус", Column: "К агенту", Action: "session"},
			ColumnSpec{BoardID: "board-1", PropertyID: "p", OptionID: "opt-review", Property: "Статус", Column: "Ревью"},
		)
	})
	m.SetBoardReader(&fakeReader{cards: []CardMoved{
		{
			CardID:  "card-1",
			BoardID: "board-1",
			Title:   "Починить окно",
			Body:    "Оно открывается пополам.",
			// The board renders a select value upper-cased, which is what Props
			// carries everywhere — see toolCard.
			Props:       map[string]string{"статус": "К АГЕНТУ"},
			OptionNames: []string{"К агенту", "xciii"},
		},
		{
			CardID: "card-2", BoardID: "board-1", Title: "Вторая",
			Props:       map[string]string{"статус": "ИДЕИ"},
			OptionNames: []string{"Идеи"},
		},
		{CardID: "elsewhere", BoardID: "board-2", Title: "Чужая"},
	}})
	return m, writer
}

// An agent that finished its work moves the card on, and moving it is what sets
// the next column off — so the change has to reach the board named the way the
// board names things: a column in the configured property, values by name.
func TestBoardToolsMoveACardOnByName(t *testing.T) {
	m, writer := boardWithCards(t)
	token := m.GrantBoardTools("board-1", "card-1", "")

	// The card a call names nothing for is the run's own, which is the case an
	// agent working on one card always has.
	if err := m.UpdateCardFromTools(t.Context(), token, "", CardEdit{Column: "Ревью"}); err != nil {
		t.Fatal(err)
	}
	edit, ok := writer.cardEdit("card-1")
	if !ok {
		t.Fatalf("the run's own card was not the one changed: %+v", writer.edits)
	}
	if edit.Column != "Ревью" || edit.Property != "Статус" {
		t.Errorf("the move landed as %+v, want the column property from the config", edit)
	}

	// And another card of the same board is fair game when it is named.
	if err := m.UpdateCardFromTools(t.Context(), token, "card-2", CardEdit{Options: []string{"Одобрено"}}); err != nil {
		t.Fatal(err)
	}
	if edit, _ := writer.cardEdit("card-2"); strings.Join(edit.Options, ",") != "Одобрено" {
		t.Errorf("the value the route waits on landed as %+v", edit)
	}

	// A change that says nothing is a mistake worth naming rather than a write.
	if err := m.UpdateCardFromTools(t.Context(), token, "", CardEdit{}); err == nil {
		t.Error("an empty change was accepted")
	}
}

// The grant is a board, not a doorway: a card id read anywhere else opens
// nothing, or one board's tools would reach every other board's cards.
func TestBoardToolsRefuseACardOfAnotherBoard(t *testing.T) {
	m, writer := boardWithCards(t)
	token := m.GrantBoardTools("board-1", "card-1", "")

	if err := m.UpdateCardFromTools(t.Context(), token, "elsewhere", CardEdit{Column: "Ревью"}); err == nil {
		t.Error("a card of another board was moved")
	}
	if err := m.CommentFromTools(t.Context(), token, "elsewhere", "Привет"); err == nil {
		t.Error("a card of another board was written on")
	}
	if _, err := m.BoardToolCardByID(t.Context(), token, "elsewhere"); err == nil {
		t.Error("a card of another board was read")
	}
	if _, ok := writer.cardEdit("elsewhere"); ok {
		t.Error("another board's card was written to")
	}

	// A grant that stands on no card has no default either: a planning terminal
	// must name what it means.
	planning := m.GrantBoardTools("board-1", "", "")
	if err := m.CommentFromTools(t.Context(), planning, "", "Привет"); err == nil {
		t.Error("a comment with no card behind it was accepted")
	}
}

// Listing is how an agent finds a card at all: everything else takes an id, and
// an id is not something a conversation carries. It shows the granted board and
// says which card is the agent's own.
func TestBoardToolsListTheGrantedBoardsCards(t *testing.T) {
	m, _ := boardWithCards(t)
	token := m.GrantBoardTools("board-1", "card-1", "")

	cards, err := m.BoardToolCards(t.Context(), token, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(cards) != 2 {
		t.Fatalf("cards listed: %d, want the granted board's two — %+v", len(cards), cards)
	}
	first := cards[0]
	// The column comes back under the option's own name rather than the shouted
	// one the board renders, because that name is what the agent has to send back.
	if first.ID != "card-1" || first.Column != "К агенту" || !first.Mine {
		t.Errorf("the run's own card reads as %+v", first)
	}
	// The column is said once: it is its own field, not one of the values.
	if strings.Join(first.Options, ",") != "xciii" {
		t.Errorf("values read back as %v", first.Options)
	}

	// A column narrows the listing, which is what "what is waiting for review"
	// is asked with.
	inColumn, err := m.BoardToolCards(t.Context(), token, "идеи")
	if err != nil {
		t.Fatal(err)
	}
	if len(inColumn) != 1 || inColumn[0].ID != "card-2" {
		t.Errorf("the column filter gave %+v", inColumn)
	}

	// One card asked about by itself carries its description; a listing does not.
	if first.Body != "" {
		t.Errorf("a listing carried a body, which costs a query per card: %q", first.Body)
	}
	card, err := m.BoardToolCardByID(t.Context(), token, "card-1")
	if err != nil {
		t.Fatal(err)
	}
	if card.Body != "Оно открывается пополам." {
		t.Errorf("the card read back without its description: %+v", card)
	}
}

// A route is what a column does *afterwards*, and an agent cannot infer it from
// the columns: it has to be told that one column carries the card through four.
func TestBoardToolsDescribeTheBoardsRoutes(t *testing.T) {
	m, _ := boardWithCards(t)
	if _, err := m.AddFlow(FlowEntry{
		Name:    "Обычный",
		BoardID: "board-1",
		Nodes: []FlowNode{
			{ID: "n1", Column: "К агенту", OptionID: "opt-toagent"},
			{ID: "n2", Column: "Ревью", OptionID: "opt-review"},
		},
		Edges: []FlowEdge{{From: "n1", To: "n2", On: TriggerSuccess}, {From: "n2", To: "n1", On: TriggerBranchMerged}},
	}); err != nil {
		t.Fatal(err)
	}

	flows, err := m.BoardToolFlows(m.GrantBoardTools("board-1", "", ""))
	if err != nil {
		t.Fatal(err)
	}
	if len(flows) != 1 || flows[0].Name != "Обычный" || len(flows[0].Stages) != 2 {
		t.Fatalf("routes read back as %+v", flows)
	}
	// A stage that names no action of its own runs its column's, and that is
	// what the agent must be told — not the blank the stage wrote down.
	if flows[0].Stages[0].Action != "session" {
		t.Errorf("the stage does not say what runs there: %+v", flows[0].Stages[0])
	}
	if len(flows[0].Stages[1].Waiting) == 0 {
		t.Errorf("the stage does not say what carries a card off it: %+v", flows[0].Stages[1])
	}
}

// A terminal is the vendor CLI, so the tools reach it as a config file the CLI
// is pointed at — and the file carries the grant, so it goes when the grant does.
func TestBoardToolsConfigIsWrittenForTheCLIAndCleanedUpAfter(t *testing.T) {
	m, _, _, _ := testManager(t, "idle", nil)
	m.SetOrigin("http://127.0.0.1:8088/")

	token, path := m.openBoardTools("board-1", "card-1", "term-1", AgentEntry{Name: "c", Kind: AgentKindClaude}, nil)
	if token == "" || path == "" {
		t.Fatal("claude takes an MCP config and got none")
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		MCPServers map[string]struct {
			Type    string            `json:"type"`
			URL     string            `json:"url"`
			Headers map[string]string `json:"headers"`
		} `json:"mcpServers"`
	}
	if err := json.Unmarshal(raw, &config); err != nil {
		t.Fatalf("the CLI would not read this config: %v\n%s", err, raw)
	}
	server, ok := config.MCPServers["board"]
	if !ok {
		t.Fatalf("no board server in the config: %s", raw)
	}
	// The app serves the tools itself, so the CLI is pointed at the front door
	// rather than at a program to run.
	if server.Type != "http" || server.URL != "http://127.0.0.1:8088/acp/board/mcp" {
		t.Errorf("the CLI was pointed at %s %q", server.Type, server.URL)
	}
	if server.Headers["Authorization"] != "Bearer "+token {
		t.Errorf("the grant does not travel with the call: %q", server.Headers["Authorization"])
	}

	// And the argv the terminal runs is what that CLI takes.
	argv, _, err := terminalCommand(AgentEntry{Name: "c", Kind: AgentKindClaude}, false, path, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(argv, " ") != "claude --mcp-config "+path {
		t.Errorf("argv %v, want the CLI pointed at the config", argv)
	}

	m.closeBoardTools(token, path)
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("the config outlived the terminal, and it holds a grant")
	}
	if err := m.CheckBoardTools(token); err == nil {
		t.Error("the grant outlived the terminal")
	}
}

// An agent whose CLI we cannot tell about MCP simply runs without the tools:
// guessing a flag is how a terminal fails to open at all.
func TestBoardToolsAreSkippedForACLIThatCannotTakeThem(t *testing.T) {
	m, _, _, _ := testManager(t, "idle", nil)
	m.SetOrigin("http://127.0.0.1:8088/")

	for _, agent := range []AgentEntry{
		{Name: "x", Kind: AgentKindCodex},
		{Name: "w", Kind: AgentKindClaude, TerminalCommand: []string{"proxychains4", "claude"}},
	} {
		if token, path := m.openBoardTools("board-1", "card-1", "term-1", agent, nil); token != "" || path != "" {
			t.Errorf("%s was given tools it cannot be told about", agent.Name)
			m.closeBoardTools(token, path)
		}
	}

	// And a terminal with no board behind it has nowhere to write anyway.
	if token, _ := m.openBoardTools("", "", "term-1", AgentEntry{Name: "c", Kind: AgentKindClaude}, nil); token != "" {
		t.Error("a grant was minted for no board")
	}
}

// A stage's own servers reach the CLI the only way a terminal can be told about
// one: the same config file the board's tools travel in. This is what makes a
// column configurable without registering the agent a second time.
func TestStageServersTravelInTheSameConfigAsTheBoardTools(t *testing.T) {
	m, _, _, _ := testManager(t, "idle", nil)
	m.SetOrigin("http://127.0.0.1:8088/")

	servers := MCPServerSet{"playwright": {
		Command: "npx",
		Args:    []string{"-y", "@playwright/mcp@latest"},
		Env:     map[string]string{"BROWSER": "chrome"},
	}}
	token, path := m.openBoardTools("board-1", "card-1", "term-1", AgentEntry{Name: "c", Kind: AgentKindClaude}, servers)
	if token == "" || path == "" {
		t.Fatal("claude takes an MCP config and got none")
	}
	defer m.closeBoardTools(token, path)

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		MCPServers map[string]struct {
			Type    string            `json:"type"`
			Command string            `json:"command"`
			Args    []string          `json:"args"`
			Env     map[string]string `json:"env"`
		} `json:"mcpServers"`
	}
	if err := json.Unmarshal(raw, &config); err != nil {
		t.Fatalf("the CLI would not read this config: %v\n%s", err, raw)
	}
	if _, ok := config.MCPServers["board"]; !ok {
		t.Errorf("the stage's servers displaced the board's own: %s", raw)
	}
	stage, ok := config.MCPServers["playwright"]
	if !ok {
		t.Fatalf("the column's server is not in the config: %s", raw)
	}
	if stage.Command != "npx" || strings.Join(stage.Args, " ") != "-y @playwright/mcp@latest" || stage.Env["BROWSER"] != "chrome" {
		t.Errorf("the server was rewritten on the way: %+v", stage)
	}
	if stage.Type != "" {
		t.Errorf("a stdio server must not be declared as %q", stage.Type)
	}
}

// A conversation on a board nobody named still gets the column's tools: the
// board's own server is what needs a grant, and a browser does not.
func TestStageServersSurviveWithoutAGrant(t *testing.T) {
	m, _, _, _ := testManager(t, "idle", nil)

	servers := MCPServerSet{"playwright": {Command: "npx"}}
	token, path := m.openBoardTools("", "", "term-1", AgentEntry{Name: "c", Kind: AgentKindClaude}, servers)
	if token != "" {
		t.Error("a grant was minted for no board")
	}
	if path == "" {
		t.Fatal("the column's own servers were dropped along with the board's")
	}
	defer m.closeBoardTools(token, path)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "playwright") || strings.Contains(string(raw), "\"board\"") {
		t.Errorf("config: %s", raw)
	}
}

// A board says which field carries its columns, and the grant takes that answer
// rather than the machine's. The config's TriggerProperty is one name for every
// board this install ever opens, and its default is the Russian «Статус» — so a
// board in another language, or one where somebody renamed the field, used to
// hand the agent a property that does not exist there and every write bounced.
func TestTheGrantTakesTheColumnPropertyFromTheBoard(t *testing.T) {
	m, writer, _, _ := testManager(t, "idle", func(cfg *Config) {
		cfg.TriggerProperty = "Статус"
	})
	m.SetBoardMeta(&fakeBoardMeta{props: map[string]any{
		BoardPropColumnProperty: "prop-workflow",
	}})

	if _, err := m.CreateCardFromTools(t.Context(), m.GrantBoardTools("board-1", "", ""),
		NewCard{Title: "Задача", Column: "К агенту"}); err != nil {
		t.Fatal(err)
	}

	if len(writer.created) != 1 {
		t.Fatalf("board writes: %d, want 1", len(writer.created))
	}
	if got := writer.created[0].Property; got != "prop-workflow" {
		t.Errorf("column property %q, want the one the board records", got)
	}
}

// A board made before that record exists says nothing, and the machine's
// configured name is the only answer there is.
func TestTheGrantFallsBackToTheConfiguredColumnProperty(t *testing.T) {
	m, writer, _, _ := testManager(t, "idle", func(cfg *Config) {
		cfg.TriggerProperty = "Статус"
	})
	m.SetBoardMeta(&fakeBoardMeta{props: map[string]any{}})

	if _, err := m.CreateCardFromTools(t.Context(), m.GrantBoardTools("board-1", "", ""),
		NewCard{Title: "Задача", Column: "К агенту"}); err != nil {
		t.Fatal(err)
	}

	if got := writer.created[0].Property; got != "Статус" {
		t.Errorf("column property %q, want the configured fallback", got)
	}
}
