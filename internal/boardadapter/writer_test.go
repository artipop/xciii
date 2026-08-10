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
		"Заметка": "что-то", // no such property
		"Status":  "Tested", // no such option
	})
	if len(got) != 0 {
		t.Fatalf("nothing should have resolved: %+v", got)
	}
	if cardProperties(schema, nil) != nil {
		t.Fatal("no properties at all must stay nil, not an empty map")
	}
}

// Which property is "the columns" is the board's answer, not a constant: the
// boards this app ships call it «Статус» and the upstream ones "Status", so a
// source that assumed either name filed nothing on half the boards there are.
func TestTheColumnPropertyIsWhatTheBoardGroupsBy(t *testing.T) {
	board := testBoard()
	board.CardProperties = append(board.CardProperties, map[string]any{
		"id": "prop-stage", "name": "Этап", "type": "select",
		"options": []any{map[string]any{"id": "opt-inbox", "value": "Входящие"}},
	})
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		t.Fatal(err)
	}

	view := &model.Block{Type: model.TypeView, Fields: map[string]any{"groupById": "prop-stage"}}
	if name, ok := columnPropertyName(board, schema, []*model.Block{view}); !ok || name != "Этап" {
		t.Fatalf("got %q, ok=%v", name, ok)
	}

	// A board whose views group by nothing falls back to its first select
	// property, in the board's own order — which is what a new kanban view
	// would have grouped by anyway.
	if name, ok := columnPropertyName(board, schema, nil); !ok || name != "Status" {
		t.Fatalf("fallback: got %q, ok=%v", name, ok)
	}

	// Grouping by a text property is not grouping by a column.
	byText := &model.Block{Type: model.TypeView, Fields: map[string]any{"groupById": "prop-project"}}
	if name, ok := columnPropertyName(board, schema, []*model.Block{byText}); !ok || name != "Status" {
		t.Fatalf("a text property is not a column: got %q, ok=%v", name, ok)
	}
}

// A patch replaces a whole card property, so the definition it is given has to
// be the board's own — the parsed schema drops everything we do not read, and
// patching with it would delete those fields.
func TestFindCardProperty(t *testing.T) {
	board := testBoard()

	prop, ok := findCardProperty(board.CardProperties, "status")
	if !ok || prop["id"] != "prop-status" {
		t.Fatalf("got %+v, ok=%v", prop, ok)
	}
	if _, ok := findCardProperty(board.CardProperties, "repo_path"); ok {
		t.Fatal("only a select property can hold columns")
	}
	if _, ok := findCardProperty(board.CardProperties, "Этап"); ok {
		t.Fatal("a property the board does not have must not resolve")
	}
}

// The inbox column has to exist — a card stands in a column, and the automation
// fires on a change of one — but it is not where anybody reads what arrived, so
// it is taken off the kanban. A group named in neither list is drawn, so hiding
// it means naming it in the hidden one and taking it out of the visible one.
func TestHidingAColumnFromTheKanban(t *testing.T) {
	visible, wasVisible := withoutOption([]any{"opt-inbox", "opt-todo"}, "opt-inbox")
	if !wasVisible || len(visible) != 1 || visible[0] != "opt-todo" {
		t.Fatalf("visible: %+v, was there: %v", visible, wasVisible)
	}

	hidden, wasHidden := withOption([]any{}, "opt-inbox")
	if wasHidden || len(hidden) != 1 || hidden[0] != "opt-inbox" {
		t.Fatalf("hidden: %+v, was there: %v", hidden, wasHidden)
	}

	// Already hidden: the lists come back untouched, which is what keeps the
	// check from writing to every board on every delivery.
	if _, wasVisible := withoutOption([]any{"opt-todo"}, "opt-inbox"); wasVisible {
		t.Fatal("a column that is not visible was not taken out of anything")
	}
	if again, wasHidden := withOption(hidden, "opt-inbox"); !wasHidden || len(again) != 1 {
		t.Fatalf("hiding twice: %+v, was there: %v", again, wasHidden)
	}

	// A view that has never been touched has no lists at all.
	if list, found := withoutOption(nil, "opt-inbox"); found || len(list) != 0 {
		t.Fatalf("empty view: %+v, found %v", list, found)
	}
}

// The link a source brought is filed by what the property *is*, not by what it
// is called: the app used to write a property literally named «Ссылка», so an
// English board — or one whose owner renamed the field — lost every link
// without saying so.
func TestTheLinkPropertyIsFoundByTypeWhateverItIsCalled(t *testing.T) {
	board := testBoard()
	board.CardProperties = append(board.CardProperties, map[string]any{
		"id": "prop-link", "name": "Source link", "type": "url",
	})
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		t.Fatal(err)
	}

	if id, ok := propertyOfType(board, schema, "url"); !ok || id != "prop-link" {
		t.Fatalf("got %q, ok=%v", id, ok)
	}

	// A board that has none says so, which is what makes the caller add one
	// rather than quietly drop what it was given.
	if _, ok := propertyOfType(testBoard(), schema, "url"); ok {
		t.Fatal("a board without a url property must not answer with one")
	}
}

// The inbox view is told from the board's other views by what it shows, not by
// what it is called: a person may rename a view, and matching «Входящие» by
// title meant the next arriving card quietly built a second inbox beside it.
func TestTheInboxViewIsFoundByWhatItFilters(t *testing.T) {
	filtered := &model.Block{Type: model.TypeView, Title: "Что пришло", Fields: map[string]any{
		"filter": map[string]any{"operation": "and", "filters": []any{map[string]any{
			"propertyId": "prop-status",
			"condition":  "includes",
			"values":     []any{"opt-inbox"},
		}}},
	}}
	if !isInboxView(filtered, "prop-status", "opt-inbox") {
		t.Fatal("a renamed inbox must still be the inbox")
	}
	if isInboxView(filtered, "prop-status", "opt-agent") {
		t.Fatal("a view filtered to another column is another view")
	}

	// A view whose filter somebody edited is still found by its title, so the
	// one this app made is never duplicated either way.
	byTitle := &model.Block{Type: model.TypeView, Title: InboxViewTitle, Fields: map[string]any{}}
	if !isInboxView(byTitle, "prop-status", "opt-inbox") {
		t.Fatal("the title is the fallback and has to work")
	}
	plain := &model.Block{Type: model.TypeView, Title: "Доска", Fields: map[string]any{}}
	if isInboxView(plain, "prop-status", "opt-inbox") {
		t.Fatal("an ordinary view is not the inbox")
	}
}
