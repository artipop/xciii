package boardadapter

import (
	"testing"

	"github.com/mattermost/focalboard/server/model"

	"github.com/artipop/xciii/internal/acp"
)

func TestFindSelectOption(t *testing.T) {
	schema, err := model.ParsePropertySchema(testBoard())
	if err != nil {
		t.Fatal(err)
	}

	// Names come from the config, ids from the board — and matching is
	// case-insensitive, like the trigger columns.
	propID, optionID, ok := findSelectOption(schema, "status", "TO AGENT")
	if !ok || propID != "prop-status" || optionID != "opt-agent" {
		t.Fatalf("got %q/%q, ok=%v", propID, optionID, ok)
	}

	if _, _, ok := findSelectOption(schema, "Status", "Tested"); ok {
		t.Fatal("a column the board does not have must not resolve")
	}
	if _, _, ok := findSelectOption(schema, "repo_path", "To Agent"); ok {
		t.Fatal("only select properties may be matched")
	}
}

// A card asked for by an agent names option values and nothing else: which
// property holds "To Agent" is the board's business, exactly as it is when a
// card is read back by the names of the options selected on it.
func TestFindOptionByName(t *testing.T) {
	schema, err := model.ParsePropertySchema(testBoard())
	if err != nil {
		t.Fatal(err)
	}

	propID, optionID, ok := findOptionByName(schema, "to agent")
	if !ok || propID != "prop-status" || optionID != "opt-agent" {
		t.Fatalf("got %q/%q, ok=%v", propID, optionID, ok)
	}

	if _, _, ok := findOptionByName(schema, "  "); ok {
		t.Error("an empty name must not resolve to whatever comes first")
	}
	if _, _, ok := findOptionByName(schema, "/tmp/project"); ok {
		t.Error("only select options may be matched, not the value of a text property")
	}
}

// A change to a card is written in names and stored in ids, and a name the board
// does not have is refused rather than dropped: the card was asked to change one
// way, and half of that change is not it. (CreateCard takes the opposite bargain
// for a reason of its own — a plan of five cards must not be lost to one guess.)
func TestCardPatchFor(t *testing.T) {
	schema, err := model.ParsePropertySchema(testBoard())
	if err != nil {
		t.Fatal(err)
	}

	patch, err := cardPatchFor(schema, acp.CardEdit{Title: " Готово ", Property: "Status", Column: "to agent"})
	if err != nil {
		t.Fatal(err)
	}
	if patch.Title == nil || *patch.Title != "Готово" {
		t.Errorf("title patched as %v", patch.Title)
	}
	if patch.UpdatedProperties["prop-status"] != "opt-agent" {
		t.Errorf("column patched as %+v", patch.UpdatedProperties)
	}

	// An option name that happens to be a column must not move a card the
	// caller only asked to tag.
	patch, err = cardPatchFor(schema, acp.CardEdit{Property: "Status", Column: "Backlog", Options: []string{"To Agent"}})
	if err != nil {
		t.Fatal(err)
	}
	if patch.UpdatedProperties["prop-status"] != "opt-backlog" {
		t.Errorf("the column was overridden by a value: %+v", patch.UpdatedProperties)
	}

	if _, err := cardPatchFor(schema, acp.CardEdit{Options: []string{"Такого нет"}}); err == nil {
		t.Error("a value the board does not have was accepted")
	}
	if _, err := cardPatchFor(schema, acp.CardEdit{Property: "Status", Column: "Tested"}); err == nil {
		t.Error("a column the board does not have was accepted")
	}
	// A patch that says nothing would clear nothing and mean nothing.
	if _, err := cardPatchFor(schema, acp.CardEdit{Title: "  "}); err == nil {
		t.Error("an empty change was accepted")
	}
}

func TestAppendContentOrder(t *testing.T) {
	// A card with nothing in it.
	if got := appendContentOrder(map[string]any{}, "block-1"); len(got) != 1 || got[0] != "block-1" {
		t.Fatalf("empty card: %+v", got)
	}

	// Nesting (side-by-side rows) must survive: flattening it would silently
	// rearrange the user's content.
	fields := map[string]any{"contentOrder": []any{"text-1", []any{"img-1", "img-2"}}}
	got := appendContentOrder(fields, "shot-1")
	if len(got) != 3 || got[0] != "text-1" || got[2] != "shot-1" {
		t.Fatalf("appended order: %+v", got)
	}
	row, ok := got[1].([]any)
	if !ok || len(row) != 2 {
		t.Fatalf("nested row was flattened: %+v", got[1])
	}
	// The card's own field is left alone until the patch lands.
	if len(fields["contentOrder"].([]any)) != 2 {
		t.Fatalf("the original order was mutated: %+v", fields["contentOrder"])
	}
}
