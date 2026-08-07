// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package boardmcp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The grant travels on every call: it is the only thing that says which board
// this agent is talking about, and the app end refuses a call without it.
func TestEveryCallCarriesTheGrant(t *testing.T) {
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	}))
	defer srv.Close()

	cl, err := NewClient(srv.URL, "grant-1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cl.Columns(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := cl.Create(t.Context(), []Card{{Title: "Задача"}}); err != nil {
		t.Fatal(err)
	}
	for _, auth := range seen {
		if auth != "Bearer grant-1" {
			t.Errorf("call went out as %q", auth)
		}
	}
	if len(seen) != 2 {
		t.Errorf("calls made: %d, want 2", len(seen))
	}
}

// A plan is a list of cards, and one bad column in it must not cost the others:
// every card is attempted and every outcome is named.
func TestABadCardDoesNotTakeTheGoodOnesWithIt(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Cards []Card `json:"cards"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		out := make([]CardResult, 0, len(body.Cards))
		for i, c := range body.Cards {
			if c.Column == "Такой нет" {
				out = append(out, CardResult{Title: c.Title, Error: "нет такой колонки"})
				continue
			}
			out = append(out, CardResult{ID: string(rune('a' + i)), Title: c.Title})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	}))
	defer srv.Close()

	cl, err := NewClient(srv.URL, "grant-1")
	if err != nil {
		t.Fatal(err)
	}
	results, err := cl.Create(t.Context(), []Card{
		{Title: "Первая"},
		{Title: "Вторая", Column: "Такой нет"},
		{Title: "Третья"},
	})
	if err != nil {
		t.Fatal(err)
	}

	res, _, _ := created(results, nil)
	text := toolText(res)
	if res.IsError {
		t.Errorf("two cards out of three landed, which is not a failed call:\n%s", text)
	}
	for _, want := range []string{"Первая", "Вторая", "нет такой колонки", "Третья"} {
		if !strings.Contains(text, want) {
			t.Errorf("the agent is not told about %q:\n%s", want, text)
		}
	}
}

// Nothing landed at all is a failed tool call: the agent has to see that its
// plan is not on the board rather than read a list and move on.
func TestNothingLandingIsAFailure(t *testing.T) {
	res, _, _ := created([]CardResult{{Title: "Первая", Error: "нет доступа к доске"}}, nil)
	if !res.IsError {
		t.Error("a card that was refused was reported as done")
	}
	if !strings.Contains(toolText(res), "нет доступа") {
		t.Errorf("the reason is missing: %s", toolText(res))
	}
}

// The app end is a loopback address and a grant; without either there is no
// server to run, and saying so beats an agent whose tools quietly do nothing.
func TestTheServerRefusesToStartWithoutItsGrant(t *testing.T) {
	if _, err := NewClient("", "grant"); err == nil {
		t.Error("a server with no address started")
	}
	if _, err := NewClient("http://127.0.0.1:8088", ""); err == nil {
		t.Error("a server with no grant started")
	}
}

// toolText is what the model actually reads back.
func toolText(res *mcp.CallToolResult) string {
	var b strings.Builder
	for _, c := range res.Content {
		if tc, ok := c.(*mcp.TextContent); ok {
			b.WriteString(tc.Text)
		}
	}
	return b.String()
}
