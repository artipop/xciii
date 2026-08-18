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
	if !columnMatchesCard(renamed, node, "Статус", "") {
		t.Error("a renamed column lost the card that was standing on it")
	}

	elsewhere := CardMoved{SelectedOptions: []Column{{
		PropertyID: "p1", PropertyName: "Статус", OptionID: "opt-review", Name: "Ревью",
	}}}
	if columnMatchesCard(elsewhere, node, "Статус", "") {
		t.Error("a card in another column still reads as standing here")
	}
}

// A card that says nothing about the column property is not evidence that it
// left: a test fake carries no options, and a real card may carry only labels.
// The route's own record stands in those cases.
func TestACardThatSaysNothingIsLeftWhereTheRouteThinksItIs(t *testing.T) {
	node := FlowNode{ID: "n1", Column: "В работе", OptionID: "opt-work"}

	if !columnMatchesCard(CardMoved{}, node, "Статус", "") {
		t.Error("a card carrying no options was treated as having moved")
	}
	labelled := CardMoved{SelectedOptions: []Column{{
		PropertyID: "p9", PropertyName: "Приоритет", OptionID: "opt-high", Name: "Высокий",
	}}}
	if !columnMatchesCard(labelled, node, "Статус", "") {
		t.Error("a card carrying an unrelated label was treated as having moved")
	}
}

// Once the board records which field its columns are on, a card that has moved
// is recognised as having moved however the field has been renamed — which is
// the half the option id alone could not answer. That record is
// `xciiiColumnProperty`, beside the ones the board already keeps for the folder
// and the branch.
func TestACardThatMovedIsSeenToHaveMovedWhateverTheFieldIsCalled(t *testing.T) {
	node := FlowNode{ID: "n1", Column: "В работе", OptionID: "opt-work"}
	const columnProperty = "p1"

	// The field renamed, the card moved to another of its options.
	moved := CardMoved{SelectedOptions: []Column{{
		PropertyID: columnProperty, PropertyName: "Этап", OptionID: "opt-review", Name: "Ревью",
	}}}
	if columnMatchesCard(moved, node, "Статус", columnProperty) {
		t.Error("a card that moved still reads as standing on its old stage")
	}

	// Still there, under a renamed field and a renamed option.
	stayed := CardMoved{SelectedOptions: []Column{{
		PropertyID: columnProperty, PropertyName: "Этап", OptionID: "opt-work", Name: "Делается",
	}}}
	if !columnMatchesCard(stayed, node, "Статус", columnProperty) {
		t.Error("a renamed column lost the card standing on it")
	}

	// Carrying labels and saying nothing about its column: the route's record
	// stands, because the card has not said otherwise.
	labelled := CardMoved{SelectedOptions: []Column{{
		PropertyID: "p9", PropertyName: "Приоритет", OptionID: "opt-high", Name: "Высокий",
	}}}
	if !columnMatchesCard(labelled, node, "Статус", columnProperty) {
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

// A board is told which of its fields carries its columns, so that "this card
// has left" can be answered by id rather than by a name somebody may rename.
// The record is taken off the columns themselves, which already carry the
// property they were bound to — so a board that has ever had its automation
// read gets it without anybody being asked.
func TestABoardIsToldWhichFieldItsColumnsAreOn(t *testing.T) {
	m := setupManager(t, boardProps(t, BoardAutomation{
		Columns: []ColumnSpec{
			{PropertyID: "prop-status", OptionID: "opt-work", Property: "Статус",
				Column: "В работе", Action: FlowActionAgent},
			{PropertyID: "prop-status", OptionID: "opt-qa", Property: "Статус",
				Column: "QA", Action: FlowActionTest},
		},
	}))
	meta := m.meta.(*fakeBoardMeta)

	m.SeedBoard("board1")

	if got := meta.written["board1"][BoardPropColumnProperty]; got != "prop-status" {
		t.Errorf("the board was told %v, want the property its columns are on", got)
	}
}

// Columns spread over two different fields describe a board this record cannot
// describe, and a wrong answer here is worse than none: it would decide that
// every card on the other field has left its stage.
func TestABoardWithColumnsOnTwoFieldsIsToldNothing(t *testing.T) {
	if got := columnPropertyOf([]ColumnSpec{
		{PropertyID: "prop-status", Column: "В работе"},
		{PropertyID: "prop-stage", Column: "QA"},
	}); got != "" {
		t.Errorf("two fields produced %q", got)
	}
	// And columns from before option ids say nothing rather than guessing.
	if got := columnPropertyOf([]ColumnSpec{{Column: "В работе"}}); got != "" {
		t.Errorf("a column with no property id produced %q", got)
	}
}
