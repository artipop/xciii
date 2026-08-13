package boardadapter

import (
	"testing"
	"time"

	"github.com/artipop/xciii/internal/acp"
	"github.com/artipop/xciii/internal/sources"
)

// Where a card stands on its route is kept on the card, so that exporting the
// board carries it: an archive is the board record and its blocks, and nothing
// this integration keeps beside them travels at all.
func TestACardsPlaceOnItsRouteIsKeptOnTheCard(t *testing.T) {
	a := newTestApp(t)
	_, card := boardWithACard(t, a)
	writer := NewWriter(a)

	// A card that has never been on a route says so, rather than erroring.
	if _, ok, err := writer.CardFlow(t.Context(), card.ID); ok || err != nil {
		t.Fatalf("a card off every route reads as %v, %v", ok, err)
	}

	want := acp.FlowState{
		Flow:        "Фича",
		NodeID:      "review",
		Branch:      "feature/x",
		WorkdirPath: "/tmp/project",
		EnteredAt:   time.Now().Truncate(time.Second),
		Visited:     []string{"agent"},
	}
	if err := writer.SetCardFlow(t.Context(), card.ID, want); err != nil {
		t.Fatal(err)
	}

	got, ok, err := writer.CardFlow(t.Context(), card.ID)
	if err != nil || !ok {
		t.Fatalf("reading it back: %v, %v", ok, err)
	}
	if got.Flow != want.Flow || got.NodeID != want.NodeID || got.Branch != want.Branch {
		t.Errorf("the card stands at %+v", got)
	}
	if got.WorkdirPath != want.WorkdirPath || !got.EnteredAt.Equal(want.EnteredAt) {
		t.Errorf("the card stands at %+v", got)
	}
	if len(got.Visited) != 1 || got.Visited[0] != "agent" {
		t.Errorf("the stages it has been through came back as %v", got.Visited)
	}
	// The card names its own board, whatever was written into the field — after
	// an import the board id in the archive is not the board id here.
	if got.CardID != card.ID || got.BoardID != card.BoardID {
		t.Errorf("the card placed itself on %q/%q", got.CardID, got.BoardID)
	}

	// Writing our own key must leave what a person filled in alone: a field
	// patch merges, and the properties are how the card knows its column.
	block, err := a.GetBlockByID(card.ID)
	if err != nil {
		t.Fatal(err)
	}
	props, _ := block.Fields["properties"].(map[string]any)
	if props["prop-status"] == nil {
		t.Errorf("the card lost its properties: %+v", block.Fields)
	}

	// And a card dragged off its route leaves nothing behind.
	if err := writer.ClearCardFlow(t.Context(), card.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := writer.CardFlow(t.Context(), card.ID); ok || err != nil {
		t.Fatalf("after being taken off the route the card reads as %v, %v", ok, err)
	}
}

// The watcher asks the board which of its cards are parked, which is how a
// machine that has never seen this board learns what branches to poll.
func TestParkedCardsAreListedForTheWholeBoard(t *testing.T) {
	a := newTestApp(t)
	board, card := boardWithACard(t, a)
	writer := NewWriter(a)

	if states, err := writer.BoardCardFlows(t.Context(), board.ID); err != nil || len(states) != 0 {
		t.Fatalf("a board with nothing parked answered %+v, %v", states, err)
	}

	if err := writer.SetCardFlow(t.Context(), card.ID, acp.FlowState{Flow: "Фича", NodeID: "review", Branch: "feature/x"}); err != nil {
		t.Fatal(err)
	}
	states, err := writer.BoardCardFlows(t.Context(), board.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(states) != 1 || states[0].CardID != card.ID || states[0].Branch != "feature/x" {
		t.Fatalf("the board answered %+v", states)
	}
}

// Carrying a card to another board keeps its place on its route with it. The
// card keeps its id through the move, and the position is one of its own
// fields — which is the whole reason for keeping it there rather than in a
// table that would have had to be told about the move.
func TestThePlaceOnTheRouteTravelsWithACarriedCard(t *testing.T) {
	a := newTestApp(t)
	_, card := boardWithACard(t, a)
	other, _ := boardWithACard(t, a)
	writer := NewWriter(a)

	if err := writer.SetCardFlow(t.Context(), card.ID, acp.FlowState{Flow: "Фича", NodeID: "review", Branch: "feature/x"}); err != nil {
		t.Fatal(err)
	}
	if err := writer.MoveCardToBoard(t.Context(), card.ID, other.ID, ""); err != nil {
		t.Fatal(err)
	}

	got, ok, err := writer.CardFlow(t.Context(), card.ID)
	if err != nil || !ok {
		t.Fatalf("after the move the card reads as %v, %v", ok, err)
	}
	if got.NodeID != "review" || got.Branch != "feature/x" {
		t.Errorf("the card arrived standing at %+v", got)
	}
	if got.BoardID != other.ID {
		t.Errorf("the card still says it is on board %q", got.BoardID)
	}
}

// A card made from a source's item carries which item it was, so the board
// itself answers "have we brought this one already" — the question this
// machine's own table cannot answer about a board that came from elsewhere,
// because an import gives every card a new id.
func TestACardRemembersWhichItemItWasMadeFrom(t *testing.T) {
	a := newTestApp(t)
	board, _ := boardWithACard(t, a)
	writer := NewSourceWriter(a)

	cardID, err := writer.CreateCard(t.Context(), board.ID, CardSpec{
		Title:  "Доставка приедет завтра",
		Source: "телефон",
		Item:   sources.ItemRef{ExternalID: "0|1234|com.example", Version: "v1"},
	})
	if err != nil {
		t.Fatal(err)
	}

	got, version, ok, err := writer.CardBySourceItem(t.Context(), board.ID, "телефон", "0|1234|com.example")
	if err != nil || !ok {
		t.Fatalf("the board did not recognise the item: %v, %v", ok, err)
	}
	if got != cardID || version != "v1" {
		t.Errorf("the board answered card %q at version %q", got, version)
	}

	// Another source using the same id space is another item: the answer is
	// "did this source bring this id", not "has anybody".
	if _, _, ok, _ := writer.CardBySourceItem(t.Context(), board.ID, "почта", "0|1234|com.example"); ok {
		t.Error("an item of one source was recognised as another source's")
	}
	// And an id nobody brought is simply unknown, not an error.
	if _, _, ok, err := writer.CardBySourceItem(t.Context(), board.ID, "телефон", "нет такого"); ok || err != nil {
		t.Errorf("an unknown item answered %v, %v", ok, err)
	}
}
