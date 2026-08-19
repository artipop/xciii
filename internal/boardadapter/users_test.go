package boardadapter

import (
	"strings"
	"testing"
	"time"

	"github.com/artipop/xciii/server/mlog"
	"github.com/artipop/xciii/server/model"

	"github.com/artipop/xciii/internal/acp"
)

func personSchema() model.PropSchema {
	return model.PropSchema{
		"prop-assignee":  {ID: "prop-assignee", Name: "Assignee", Type: "person"},
		"prop-reviewers": {ID: "prop-reviewers", Name: "Reviewers", Type: "multiPerson"},
		"prop-project":   {ID: "prop-project", Name: "repo_path", Type: "text"},
	}
}

func TestPersonPropertiesResolveToUsernames(t *testing.T) {
	props := map[string]any{
		"prop-assignee":  "uid-claude",
		"prop-reviewers": []any{"uid-codex", "uid-ghost"},
		"prop-project":   "/tmp/project",
	}
	lookups := 0
	resolver := newUserResolver(func(userID string) string {
		lookups++
		return map[string]string{"uid-claude": "claude", "uid-codex": "codex"}[userID]
	})

	names, ids := personNames(props, personSchema(), resolver)
	// The ids go out even for a user the resolver cannot read: they are what the
	// card stores and what an agent is matched by.
	if len(ids) != 3 {
		t.Errorf("person ids = %v, want one per value including the unknown one", ids)
	}
	if len(names) != 2 {
		t.Fatalf("person names = %v, want claude and codex", names)
	}
	joined := strings.Join(names, ",")
	if !strings.Contains(joined, "claude") || !strings.Contains(joined, "codex") {
		t.Errorf("person names = %v", names)
	}
	// An unknown id contributes no name — it must not be mistaken for one.
	if strings.Contains(joined, "uid-ghost") {
		t.Errorf("unknown user leaked into person names: %v", names)
	}

	// The same values are resolved once, whoever asks: BlockChanged runs on the
	// notify worker and this is a DB read per person value.
	block := &model.Block{ID: "card1", Fields: map[string]any{"properties": props}}
	parsed := namedProperties(block, personSchema(), resolver)
	if parsed["assignee"] != "claude" {
		t.Errorf("assignee prop = %q, want claude", parsed["assignee"])
	}
	if parsed["repo_path"] != "/tmp/project" {
		t.Errorf("unrelated props broken: %v", parsed)
	}
	if lookups != 3 {
		t.Errorf("lookups = %d, want 3 (one per distinct user id)", lookups)
	}
}

func TestNamedPropertiesSurvivesUnresolvableUsers(t *testing.T) {
	// No app (nil lookup) is the case in a browser/plugin build and in tests:
	// person values stay raw ids, and the rest of the map must still arrive.
	props := map[string]any{"prop-assignee": "uid-claude", "prop-project": "/tmp/project"}
	block := &model.Block{ID: "card1", Fields: map[string]any{"properties": props}}
	resolver := newUserResolver(nil)

	parsed := namedProperties(block, personSchema(), resolver)
	if parsed["repo_path"] != "/tmp/project" {
		t.Fatalf("props lost when a user cannot be resolved: %v", parsed)
	}
	if parsed["assignee"] != "uid-claude" {
		t.Errorf("assignee prop = %q, want the raw id", parsed["assignee"])
	}
	if names, _ := personNames(props, personSchema(), resolver); len(names) != 0 {
		t.Errorf("person names = %v, want none", names)
	}
}

// A source's account is named after the source, because the board shows the
// username wherever it names an author — the inbox's own group headings among
// them — and a prefixed one would read as machinery rather than as «почта».
func TestASourceAccountIsNamedAfterTheSource(t *testing.T) {
	cases := map[string]string{
		"почта":          "почта",
		"  Телефон  ":    "телефон",
		"home assistant": "home-assistant",
		"gmail_work":     "gmail-work",
		// Anything a username may not hold is dropped rather than encoded: what
		// is left still names the source, and what was there is not a name.
		"почта (личная)": "почта-личная",
		"":               "",
	}
	for source, want := range cases {
		if got := sourceUsername(source); got != want {
			t.Errorf("sourceUsername(%q) = %q, want %q", source, got, want)
		}
	}
}

// A stage that names its crew puts the worker into the card's person property
// — found by its *type*, because «Кто занимается» and "Assignee" are each
// right for half the boards there are. The write must leave every other
// property exactly as it was: the assignment is the machine keeping one field
// truthful, not an edit of the card.
func TestAssignCardAgentWritesThePersonAndKeepsTheRest(t *testing.T) {
	a := newTestApp(t)
	board, err := a.CreateBoard(&model.Board{
		TeamID: model.GlobalTeamID,
		Type:   model.BoardTypeOpen,
		Title:  "Доска",
		CardProperties: []map[string]any{
			{"id": "prop-status", "name": "Статус", "type": "select",
				"options": []any{map[string]any{"id": "opt-agent", "value": "К агенту", "color": ""}}},
			{"id": "prop-person", "name": "Кто занимается", "type": "person", "options": []any{}},
		},
	}, model.SingleUser, true)
	if err != nil {
		t.Fatal(err)
	}
	card, err := a.CreateCard(&model.Card{
		Title:      "Починить окно",
		Properties: map[string]any{"prop-status": "opt-agent"},
	}, board.ID, model.SingleUser, true)
	if err != nil {
		t.Fatal(err)
	}
	// The block history is keyed by (id, insert_at) in milliseconds; only a
	// test patches a card in the same millisecond it was made.
	time.Sleep(2 * time.Millisecond)

	logger, err := mlog.NewLogger()
	if err != nil {
		t.Fatal(err)
	}
	backend := NewEventsBackend(logger)
	backend.SetApp(a)

	if err := backend.AssignCardAgent(t.Context(), card.ID, acp.AgentUser{Name: "клаус", Username: "клаус"}); err != nil {
		t.Fatal(err)
	}

	block, err := a.GetBlockByID(card.ID)
	if err != nil {
		t.Fatal(err)
	}
	props, _ := block.Fields["properties"].(map[string]any)
	user, err := a.GetUserByUsername("клаус")
	if err != nil || user == nil {
		t.Fatalf("the agent's account should exist by now: %v", err)
	}
	if props["prop-person"] != user.ID {
		t.Errorf("assignee = %v, want the agent's user id %s", props["prop-person"], user.ID)
	}
	if props["prop-status"] != "opt-agent" {
		t.Errorf("the write erased the card's other properties: %v", props)
	}
}

// The board's own patch replaces the properties field whole, so every write
// from this side that named one property silently erased the rest — a route
// moving the card wiped its project and its assignee. The writer now merges.
func TestMoveCardKeepsTheOtherProperties(t *testing.T) {
	a := newTestApp(t)
	board, _ := boardWithACard(t, a)
	writer := NewWriter(a)

	card, err := a.CreateCard(&model.Card{
		Title:      "Карточка с двумя свойствами",
		Properties: map[string]any{"prop-status": "opt-ideas", "prop-project": "opt-xciii"},
	}, board.ID, model.SingleUser, true)
	if err != nil {
		t.Fatal(err)
	}
	// The block history is keyed by (id, insert_at) in milliseconds; only a
	// test patches a card in the same millisecond it was made.
	time.Sleep(2 * time.Millisecond)

	if err := writer.MoveCardByOptionName(t.Context(), card.ID, "Статус", "К агенту"); err != nil {
		t.Fatal(err)
	}

	block, err := a.GetBlockByID(card.ID)
	if err != nil {
		t.Fatal(err)
	}
	props, _ := block.Fields["properties"].(map[string]any)
	if props["prop-status"] != "opt-agent" {
		t.Errorf("the move did not land: %v", props)
	}
	if props["prop-project"] != "opt-xciii" {
		t.Errorf("the move erased the card's project: %v", props)
	}
}
