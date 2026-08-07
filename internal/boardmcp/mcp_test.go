// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package boardmcp

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// fakeBoard is one agent's board: already bound to a grant, like the real one.
type fakeBoard struct {
	cards []Card
}

func (b *fakeBoard) Columns(context.Context) ([]Column, error) {
	return []Column{{Name: "К агенту", Action: "session"}, {Name: "Идеи"}}, nil
}

func (b *fakeBoard) CreateCards(_ context.Context, cards []Card) ([]CardResult, error) {
	out := make([]CardResult, 0, len(cards))
	for i, c := range cards {
		if c.Column == "Такой нет" {
			out = append(out, CardResult{Title: c.Title, Error: "нет такой колонки"})
			continue
		}
		b.cards = append(b.cards, c)
		out = append(out, CardResult{ID: fmt.Sprintf("card-%d", i), Title: c.Title})
	}
	return out, nil
}

func text(t *testing.T, res *mcp.CallToolResult) string {
	t.Helper()
	var b strings.Builder
	for _, c := range res.Content {
		if tc, ok := c.(*mcp.TextContent); ok {
			b.WriteString(tc.Text)
		}
	}
	return b.String()
}

// A plan is a list of cards, and one bad column in it must not cost the others:
// every card is attempted and every outcome is named.
func TestABadCardDoesNotTakeTheGoodOnesWithIt(t *testing.T) {
	board := &fakeBoard{}
	results, err := board.CreateCards(t.Context(), []Card{
		{Title: "Первая"},
		{Title: "Вторая", Column: "Такой нет"},
		{Title: "Третья"},
	})
	if err != nil {
		t.Fatal(err)
	}

	res, _, _ := created(results, nil)
	out := text(t, res)
	if res.IsError {
		t.Errorf("two cards out of three landed, which is not a failed call:\n%s", out)
	}
	for _, want := range []string{"Первая", "Вторая", "нет такой колонки", "Третья"} {
		if !strings.Contains(out, want) {
			t.Errorf("the agent is not told about %q:\n%s", want, out)
		}
	}
}

// Nothing landing at all is a failed tool call: the agent has to see that its
// plan is not on the board rather than read a list and move on.
func TestNothingLandingIsAFailure(t *testing.T) {
	res, _, _ := created([]CardResult{{Title: "Первая", Error: "нет доступа к доске"}}, nil)
	if !res.IsError {
		t.Error("a card that was refused was reported as done")
	}
	if !strings.Contains(text(t, res), "нет доступа") {
		t.Errorf("the reason is missing: %s", text(t, res))
	}
}

// The handler is the door, and it is shut for a caller the app cannot resolve
// to a board — before any tool exists to be called.
func TestTheHandlerRefusesACallerItCannotPlace(t *testing.T) {
	board := &fakeBoard{}
	srv := httptest.NewServer(NewHandler(func(r *http.Request) (Board, error) {
		if r.Header.Get("Authorization") != "Bearer grant-1" {
			return nil, fmt.Errorf("нет доступа к доске")
		}
		return board, nil
	}))
	defer srv.Close()

	resp, err := http.Post(srv.URL, "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("a caller with no grant was answered %s", resp.Status)
	}
	if len(board.cards) != 0 {
		t.Error("the board was touched by a caller with no grant")
	}
}
