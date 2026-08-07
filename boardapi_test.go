// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/artipop/xciii/internal/acp"
	"github.com/artipop/xciii/internal/boardmcp"
)

// recordingWriter is the board as far as these tests are concerned.
type recordingWriter struct {
	cards []acp.NewCard
}

func (w *recordingWriter) AddComment(context.Context, string, string) error { return nil }
func (w *recordingWriter) MoveCard(context.Context, string, string) error   { return nil }
func (w *recordingWriter) MoveCardByOptionName(context.Context, string, string, string) error {
	return nil
}
func (w *recordingWriter) AttachFile(context.Context, string, string, string, []byte) error {
	return nil
}

func (w *recordingWriter) CreateCard(_ context.Context, card acp.NewCard) (string, error) {
	w.cards = append(w.cards, card)
	return "card-" + card.Title, nil
}

// toolsBoard stands up the whole app end: a manager with nothing running, the
// routes in front of it, and an address an agent's MCP client can reach.
func toolsBoard(t *testing.T) (*acp.Manager, *recordingWriter, string) {
	t.Helper()
	store, err := acp.OpenStore(filepath.Join(t.TempDir(), "acp.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	writer := &recordingWriter{}
	cfg := acp.DefaultConfig(t.TempDir())
	cfg.TriggerProperty = "Статус"
	cfg.Columns = []acp.ColumnSpec{{BoardID: "board-1", Property: "Статус", Column: "К агенту", Action: "session"}}
	mgr := acp.NewManager(cfg, "", store, writer, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))

	routes := newBoardToolRoutes()
	routes.SetManager(mgr)
	srv := httptest.NewServer(routes.Handler())
	t.Cleanup(srv.Close)
	return mgr, writer, srv.URL + boardmcp.Path
}

// grantTransport sends the grant with every request, which is what the CLI is
// configured to do and what a stateless server requires.
type grantTransport struct{ token string }

func (g grantTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	if g.token != "" {
		r.Header.Set("Authorization", "Bearer "+g.token)
	}
	return http.DefaultTransport.RoundTrip(r)
}

func connect(t *testing.T, endpoint, token string) *mcp.ClientSession {
	t.Helper()
	client := mcp.NewClient(&mcp.Implementation{Name: "test-agent", Version: "0.0.1"}, nil)
	session, err := client.Connect(t.Context(), &mcp.StreamableClientTransport{
		Endpoint:   endpoint,
		HTTPClient: &http.Client{Transport: grantTransport{token: token}},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func toolText(t *testing.T, res *mcp.CallToolResult) string {
	t.Helper()
	var b strings.Builder
	for _, c := range res.Content {
		if tc, ok := c.(*mcp.TextContent); ok {
			b.WriteString(tc.Text)
		}
	}
	return b.String()
}

// The whole path an agent's tools take: its own MCP client, the front door, the
// grant, and a card on the board at the other end.
func TestBoardToolsRoundTrip(t *testing.T) {
	mgr, writer, endpoint := toolsBoard(t)
	session := connect(t, endpoint, mgr.GrantBoardTools("board-1"))

	tools, err := session.ListTools(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	offered := map[string]bool{}
	for _, tool := range tools.Tools {
		offered[tool.Name] = true
	}
	for _, want := range []string{"list_columns", "create_card", "create_cards"} {
		if !offered[want] {
			t.Errorf("the agent is not offered %s", want)
		}
	}

	// Where a card may go, and what putting one there sets off.
	columns, err := session.CallTool(t.Context(), &mcp.CallToolParams{Name: "list_columns"})
	if err != nil {
		t.Fatal(err)
	}
	if text := toolText(t, columns); !strings.Contains(text, "К агенту") || !strings.Contains(text, "session") {
		t.Errorf("columns read back as %q", text)
	}

	res, err := session.CallTool(t.Context(), &mcp.CallToolParams{
		Name: "create_cards",
		Arguments: map[string]any{"cards": []any{
			map[string]any{
				"title":       "Первая",
				"description": "Что сделать",
				"column":      "К агенту",
				"options":     []any{"xciii"},
			},
			map[string]any{"title": "   "},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	text := toolText(t, res)
	if res.IsError {
		t.Errorf("one card of two landed, which is not a failed call: %s", text)
	}
	// The bad one is named rather than swallowed: the agent has to know which
	// card to redo.
	if !strings.Contains(text, "Первая") || !strings.Contains(text, "не заведена") {
		t.Errorf("the agent is not told what happened: %s", text)
	}

	if len(writer.cards) != 1 {
		t.Fatalf("cards written: %d, want 1", len(writer.cards))
	}
	got := writer.cards[0]
	if got.BoardID != "board-1" || got.Property != "Статус" || got.Column != "К агенту" {
		t.Errorf("card landed as %+v", got)
	}
	if got.Body != "Что сделать" || strings.Join(got.Options, ",") != "xciii" {
		t.Errorf("card lost what the agent asked for: %+v", got)
	}
}

// The grant is the whole of the caller's identity, so a call without one never
// reaches the tools — not even to list them.
func TestBoardToolsRefuseACallWithoutAGrant(t *testing.T) {
	mgr, writer, endpoint := toolsBoard(t)

	for _, token := range []string{"", "made-up"} {
		client := mcp.NewClient(&mcp.Implementation{Name: "test-agent", Version: "0.0.1"}, nil)
		session, err := client.Connect(t.Context(), &mcp.StreamableClientTransport{
			Endpoint:   endpoint,
			HTTPClient: &http.Client{Transport: grantTransport{token: token}},
		}, nil)
		if err == nil {
			_ = session.Close()
			t.Errorf("a client with token %q got in", token)
		}
	}
	if len(writer.cards) != 0 {
		t.Error("a card was written for a caller with no grant")
	}

	// And a grant that has been revoked is no better than a made-up one: an
	// agent run that ended must not be able to write afterwards.
	token := mgr.GrantBoardTools("board-1")
	mgr.RevokeBoardTools(token)
	client := mcp.NewClient(&mcp.Implementation{Name: "test-agent", Version: "0.0.1"}, nil)
	if session, err := client.Connect(t.Context(), &mcp.StreamableClientTransport{
		Endpoint:   endpoint,
		HTTPClient: &http.Client{Transport: grantTransport{token: token}},
	}, nil); err == nil {
		_ = session.Close()
		t.Error("a revoked grant still opened the tools")
	}
}

// Before the ACP integration is up there is no board to write to, and a call
// must be refused rather than panic on a manager that is not there.
func TestBoardToolsAnswerBeforeTheManagerExists(t *testing.T) {
	srv := httptest.NewServer(newBoardToolRoutes().Handler())
	defer srv.Close()

	resp, err := http.Post(srv.URL+boardmcp.Path, "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("answered %s, want an honest refusal", resp.Status)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
}
