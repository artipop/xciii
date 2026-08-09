package sources

import (
	"strings"
	"testing"
)

func TestARuleWithNoConditionsCatchesEverything(t *testing.T) {
	// This is how a catch-all is written, so it must not be mistaken for a rule
	// that matches nothing.
	if !(Match{}).Match(Item{Title: "что угодно"}) {
		t.Fatal("an empty match must catch everything")
	}
}

func TestEveryConditionOfARuleHasToHold(t *testing.T) {
	m := Match{Title: "доставк", Labels: []string{"покупки"}}

	if !m.Match(Item{Title: "Доставка завтра", Labels: []string{"Покупки"}}) {
		t.Fatal("both conditions hold, in another case")
	}
	if m.Match(Item{Title: "Доставка завтра", Labels: []string{"работа"}}) {
		t.Fatal("a rule with two conditions is an and, not an or")
	}
	if m.Match(Item{Title: "Счёт за свет", Labels: []string{"покупки"}}) {
		t.Fatal("the title did not match")
	}
}

func TestPropertiesAreMatchedByNameWhateverTheCase(t *testing.T) {
	m := Match{Props: map[string]string{"App": "^com\\.example\\."}}
	if !m.Match(Item{Props: map[string]string{"app": "com.example.delivery"}}) {
		t.Fatal("property names are matched case-insensitively, as everywhere else")
	}
	if m.Match(Item{Props: map[string]string{"app": "com.other.chat"}}) {
		t.Fatal("another application must not match")
	}
	if m.Match(Item{}) {
		t.Fatal("an item without the property cannot satisfy a condition on it")
	}
}

// A hand-edited file can carry an expression Validate never saw. The safe
// reading of a condition that cannot be evaluated is that it did not fire —
// treating it as "matches everything" would file the whole stream under it.
func TestABrokenExpressionMatchesNothing(t *testing.T) {
	if (Match{Title: "("}).Match(Item{Title: "("}) {
		t.Fatal("an unparseable expression must not match")
	}
}

func TestTheFirstMatchingRuleWins(t *testing.T) {
	rules := []Rule{
		{Name: "доставка", When: Match{Title: "доставк"}, Then: ActionCard},
		{Name: "всё остальное", Then: ActionDrop},
	}

	got, ok := FirstMatch(rules, Item{Title: "Доставка завтра"})
	if !ok || got.Name != "доставка" {
		t.Fatalf("got %+v, ok=%v", got, ok)
	}
	got, ok = FirstMatch(rules, Item{Title: "Счёт за свет"})
	if !ok || got.Name != "всё остальное" {
		t.Fatalf("the catch-all should have taken it: %+v, ok=%v", got, ok)
	}
	if _, ok := FirstMatch(nil, Item{Title: "x"}); ok {
		t.Fatal("a source with no rules matches nothing")
	}
}

func TestPropertiesAreTemplatesOverTheItem(t *testing.T) {
	it := Item{Title: "Доставка", URL: "https://example.com/1",
		Props: map[string]string{"app": "com.example.delivery"}}

	got := RenderProps(map[string]string{
		"Ссылка":     "{{.URL}}",
		"Приложение": "{{index .Props \"app\"}}",
		"Тип":        "покупка",
	}, it)

	if got["Ссылка"] != "https://example.com/1" {
		t.Fatalf("template: %+v", got)
	}
	if got["Приложение"] != "com.example.delivery" {
		t.Fatalf("property lookup: %+v", got)
	}
	if got["Тип"] != "покупка" {
		t.Fatalf("a constant is left alone: %+v", got)
	}
}

// One bad template must cost its own field and not the card.
func TestABrokenTemplateLosesOnlyItsOwnProperty(t *testing.T) {
	got := RenderProps(map[string]string{
		"Плохое":  "{{.Nope}}",
		"Хорошее": "{{.Title}}",
	}, Item{Title: "Доставка"})

	if _, ok := got["Плохое"]; ok {
		t.Fatalf("a template that cannot run must be left out: %+v", got)
	}
	if got["Хорошее"] != "Доставка" {
		t.Fatalf("the rest must still be rendered: %+v", got)
	}
}

func TestTheCardCarriesTheItemAndTheWayBackToIt(t *testing.T) {
	spec := CardFor(Rule{}, Item{Title: "Доставка", Body: "Заказ №123",
		URL: "https://example.com/1"})

	if spec.Title != "Доставка" {
		t.Fatalf("title: %q", spec.Title)
	}
	// The link is in the body even when no property carries it: a board without
	// that property would otherwise lose the only way back to the original.
	if !strings.Contains(spec.Body, "Заказ №123") || !strings.Contains(spec.Body, "https://example.com/1") {
		t.Fatalf("body: %q", spec.Body)
	}
}

// A card has to be openable, and an empty title on a board is a card nobody can
// find again.
func TestAnItemWithoutATitleStillGetsOne(t *testing.T) {
	if got := CardFor(Rule{}, Item{Body: "текст"}).Title; got != "Без заголовка" {
		t.Fatalf("title: %q", got)
	}
}

func TestRuleValidationRefusesWhatCannotWork(t *testing.T) {
	if _, err := (Rule{Then: "мяу"}).Validate(); err == nil {
		t.Fatal("an unknown action must be refused")
	}
	// A regexp is refused where somebody is typing it, not in the pipeline,
	// where nobody is watching.
	if _, err := (Rule{When: Match{Title: "("}}).Validate(); err == nil {
		t.Fatal("an unparseable expression must be refused")
	}
	got, err := (Rule{}).Validate()
	if err != nil || got.Then != ActionCard {
		t.Fatalf("a rule that says nothing creates a card: %+v, %v", got, err)
	}
}

// Every source names the board it writes to, global ones included. Global says
// where the entry is offered — in every board's dialog rather than one — and
// answers nothing about where its cards go, so a global source without a board
// used to reach CreateCard with an empty id and fail on every item it took.
func TestASourceHasToBelongSomewhere(t *testing.T) {
	if _, err := (SourceEntry{Name: "телефон"}).Validate(); err == nil {
		t.Fatal("a source attached to no board must be refused")
	}
	if _, err := (SourceEntry{Name: "телефон", Global: true}).Validate(); err == nil {
		t.Fatal("global is about where the source is offered, not about where its cards go")
	}
	if _, err := (SourceEntry{Name: "телефон", BoardID: "board1", Global: true}).Validate(); err != nil {
		t.Fatalf("a global source with a board is the whole point of global: %v", err)
	}
	if _, err := (SourceEntry{BoardID: "board1"}).Validate(); err == nil {
		t.Fatal("a source without a name must be refused")
	}
}
