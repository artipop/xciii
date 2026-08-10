// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package sources

import (
	"context"
	"strings"
	"testing"
)

// The board is the question the share dialog asks, so the item carries the
// answer — every other source has its board decided for it by the registry.
func TestASharedLinkGoesToTheBoardItNames(t *testing.T) {
	m, board, _ := testManager(t, ShareSource("board1"))

	res, err := m.Deliver(context.Background(), ShareSourceName,
		[]Item{ShareItem("board2", "Статья", "https://example.com/a", "почитать")})
	if err != nil {
		t.Fatal(err)
	}
	if res.Created != 1 {
		t.Fatalf("result: %+v", res)
	}
	if len(board.boardIDs()) != 1 || board.boardIDs()[0] != "board2" {
		t.Fatalf("the card went to the wrong board: %+v", board.boardIDs())
	}
	// A shared link is nobody's task yet: it lands in the inbox, like anything
	// else that matched no rule.
	if len(board.moveLines()) != 1 || board.moveLines()[0] != "card1:Статус:Входящие" {
		t.Fatalf("moves: %+v", board.moveLines())
	}
	if board.cards()[0].Source != ShareSourceName {
		t.Fatalf("a shared card is authored by the share sheet: %+v", board.cards()[0])
	}
	// What was typed in the dialog is the card's text, and the link travels
	// beside it as the card's own — which property holds it is the board's
	// business, not this side's.
	card := board.cards()[0]
	if !strings.Contains(card.Body, "почитать") || !strings.Contains(card.Body, "https://example.com/a") {
		t.Fatalf("body: %q", card.Body)
	}
	if card.URL != "https://example.com/a" {
		t.Fatalf("card: %+v", card)
	}
}

// The registry deciding the board is what keeps a plugin — code somebody else
// wrote — from writing wherever it likes, so an item that names a board it may
// not name is refused rather than quietly written to the source's own board.
func TestOnlyASourceThatMayPickABoardMayNameOne(t *testing.T) {
	m, board, _ := testManager(t, phoneSource())

	res, err := m.Deliver(context.Background(), "телефон", []Item{{
		ExternalID: "n1", Title: "Доставка", BoardID: "board2",
		Props: map[string]string{"app": "delivery"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if res.Failed != 1 || res.Created != 0 {
		t.Fatalf("result: %+v", res)
	}
	if len(board.cards()) != 0 {
		t.Fatalf("nothing should have been written: %+v", board.cards())
	}
}

// Sharing the same page to the same board again is the same thing, and the
// card for it is already in the inbox. The delivery says so — a second card
// saying what the first one says is what makes an inbox worth ignoring.
func TestTheSameLinkSharedTwiceIsOneCard(t *testing.T) {
	m, board, _ := testManager(t, ShareSource("board1"))

	for i := 0; i < 2; i++ {
		if _, err := m.Deliver(context.Background(), ShareSourceName,
			[]Item{ShareItem("board1", "Статья", "https://example.com/a", "")}); err != nil {
			t.Fatal(err)
		}
	}
	if len(board.cards()) != 1 {
		t.Fatalf("cards: %+v", board.cards())
	}

	// The same link on another board is another thing, and a person who did it
	// meant it: that is what picking a board is for.
	res, err := m.Deliver(context.Background(), ShareSourceName,
		[]Item{ShareItem("board2", "Статья", "https://example.com/a", "")})
	if err != nil {
		t.Fatal(err)
	}
	if res.Created != 1 || len(board.cards()) != 2 {
		t.Fatalf("result: %+v, cards: %+v", res, board.cards())
	}
}

// The share sheet has no setup step: the first thing shared registers the
// source. What it must not do is overwrite an entry the person has since made
// their own — rules and all.
func TestTheShareSourceIsMadeOnceAndThenLeftAlone(t *testing.T) {
	m, _, _ := testManager(t, SourceEntry{})
	m.cfg.Sources = nil

	if _, err := m.EnsureSource(ShareSource("board1")); err != nil {
		t.Fatal(err)
	}
	mine, err := m.EnsureSource(ShareSource("board1"))
	if err != nil {
		t.Fatal(err)
	}
	mine.Inbox = "Прочитать"
	if _, err := m.UpdateSource(mine); err != nil {
		t.Fatal(err)
	}

	again, err := m.EnsureSource(ShareSource("board9"))
	if err != nil {
		t.Fatal(err)
	}
	if again.Inbox != "Прочитать" {
		t.Fatalf("the person's own entry was overwritten: %+v", again)
	}
	if len(m.Sources()) != 1 {
		t.Fatalf("there should be exactly one share source: %+v", m.Sources())
	}
}

// A share with no link at all — a selection of text — still has to become a
// card, and identify itself by what it says.
func TestASharedSelectionWithNoLinkStillBecomesACard(t *testing.T) {
	m, board, _ := testManager(t, ShareSource("board1"))

	it := ShareItem("board1", "", "", "кусок текста")
	if it.ExternalID == "" {
		t.Fatal("an item with no link still needs an id of its own")
	}
	if _, err := m.Deliver(context.Background(), ShareSourceName, []Item{it}); err != nil {
		t.Fatal(err)
	}
	if len(board.cards()) != 1 {
		t.Fatalf("cards: %+v", board.cards())
	}
}

// A share with no title is a link and nothing else, and the link is what the
// card is called: «Без названия» would say less than the address does.
func TestASharedLinkWithNoTitleIsCalledByItsLink(t *testing.T) {
	if got := ShareItem("board1", "", "https://example.com/a", "").Title; got != "https://example.com/a" {
		t.Fatalf("title: %q", got)
	}
}
