package boardadapter

import (
	"testing"

	"github.com/mattermost/focalboard/server/model"
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

func TestCardPropertiesAreResolvedByName(t *testing.T) {
	schema, err := model.ParsePropertySchema(testBoard())
	if err != nil {
		t.Fatal(err)
	}

	// A source names the property and, for a select, the option; the board
	// answers with ids. Case does not matter, as it does not for the columns.
	got := cardProperties(schema, map[string]string{
		"status":    "backlog",
		"repo_path": "/tmp/project",
	})
	if got["prop-status"] != "opt-backlog" {
		t.Fatalf("select property: %+v", got)
	}
	if got["prop-project"] != "/tmp/project" {
		t.Fatalf("text property: %+v", got)
	}
}

// A board that lacks the property, or the option, still gets the card: what a
// source brought is worth more than the field it could not fill.
func TestCardPropertiesSkipWhatTheBoardDoesNotHave(t *testing.T) {
	schema, err := model.ParsePropertySchema(testBoard())
	if err != nil {
		t.Fatal(err)
	}

	got := cardProperties(schema, map[string]string{
		"Ссылка": "https://example.com", // no such property
		"Status": "Tested",              // no such option
	})
	if len(got) != 0 {
		t.Fatalf("nothing should have resolved: %+v", got)
	}
	if cardProperties(schema, nil) != nil {
		t.Fatal("no properties at all must stay nil, not an empty map")
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
