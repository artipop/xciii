package acp

import "testing"

// Renaming a column, or the property it lives on, must cost a card nothing.
// This was the last load-bearing place a name decided something (contradiction
// 1 of docs/model-graph.md): the check was the property's name against the
// option's name, so a board where somebody renamed «Статус» — or a board in
// English — matched nothing, and every conversation on it read as belonging to a
// column the card had already left.
func TestACardStandsOnItsStageWhateverTheColumnIsCalledNow(t *testing.T) {
	node := FlowNode{ID: "n1", Column: "В работе", OptionID: "opt-work"}

	renamed := CardMoved{SelectedOptions: []Column{{
		// What the board says today: the same option, under new names.
		PropertyID: "p1", PropertyName: "Этап", OptionID: "opt-work", Name: "Делается",
	}}}
	if !columnMatchesCard(renamed, node, "Статус") {
		t.Error("a renamed column lost the card that was standing on it")
	}

	elsewhere := CardMoved{SelectedOptions: []Column{{
		PropertyID: "p1", PropertyName: "Статус", OptionID: "opt-review", Name: "Ревью",
	}}}
	if columnMatchesCard(elsewhere, node, "Статус") {
		t.Error("a card in another column still reads as standing here")
	}
}

// A card that says nothing about the column property is not evidence that it
// left: a test fake carries no options, and a real card may carry only labels.
// The route's own record stands in those cases.
func TestACardThatSaysNothingIsLeftWhereTheRouteThinksItIs(t *testing.T) {
	node := FlowNode{ID: "n1", Column: "В работе", OptionID: "opt-work"}

	if !columnMatchesCard(CardMoved{}, node, "Статус") {
		t.Error("a card carrying no options was treated as having moved")
	}
	labelled := CardMoved{SelectedOptions: []Column{{
		PropertyID: "p9", PropertyName: "Приоритет", OptionID: "opt-high", Name: "Высокий",
	}}}
	if !columnMatchesCard(labelled, node, "Статус") {
		t.Error("a card carrying an unrelated label was treated as having moved")
	}
}

// A stage that predates option ids still finds its column by name, and a stage
// that has one finds it however the column has been renamed since.
func TestAStageFindsItsColumnByIdAndFallsBackToTheName(t *testing.T) {
	m := &Manager{}
	m.cfg.Columns = []ColumnSpec{
		{Property: "Статус", Column: "В работе", OptionID: "opt-work", Action: FlowActionAgent},
		{Property: "Статус", Column: "Ревью", Action: FlowActionAgent},
	}

	// Renamed on the board; the stage still carries the id it was bound to.
	byID := FlowNode{ID: "n1", Column: "как-то иначе", OptionID: "opt-work"}
	if spec, ok := m.columnOf(byID, "Этап"); !ok || spec.Column != "В работе" {
		t.Errorf("the stage lost its column: %+v %v", spec, ok)
	}

	// A route written before stages recorded an option: names are all there is.
	byName := FlowNode{ID: "n2", Column: "Ревью"}
	if spec, ok := m.columnOf(byName, "Статус"); !ok || spec.Column != "Ревью" {
		t.Errorf("a stage with no option id lost its column: %+v %v", spec, ok)
	}

	if _, ok := m.columnOf(FlowNode{ID: "n3", Column: "Нет такой"}, "Статус"); ok {
		t.Error("a stage standing on no configured column found one anyway")
	}
}
