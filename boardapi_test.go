// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

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

// toolsManager is a manager with nothing running: enough to mint grants and
// take the writes they authorize.
func toolsManager(t *testing.T) (*acp.Manager, *recordingWriter) {
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
	return mgr, writer
}

// The whole path an agent's tools take: the MCP server's own client, the front
// door's handler, the grant, and a card on the board at the other end.
func TestBoardToolsRoundTrip(t *testing.T) {
	mgr, writer := toolsManager(t)
	routes := newBoardToolRoutes()
	routes.SetManager(mgr)
	srv := httptest.NewServer(routes.Handler())
	defer srv.Close()

	token := mgr.GrantBoardTools("board-1")
	cl, err := boardmcp.NewClient(srv.URL, token)
	if err != nil {
		t.Fatal(err)
	}

	// What the agent is told about where a card may go.
	columns, err := cl.Columns(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if len(columns) != 1 || columns[0].Name != "К агенту" || columns[0].Action != "session" {
		t.Fatalf("columns %+v, want the board's own", columns)
	}

	results, err := cl.Create(t.Context(), []boardmcp.Card{
		{Title: "Первая", Description: "Что сделать", Column: "К агенту", Options: []string{"xciii"}},
		{Title: "  ", Description: "без заголовка"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 2 {
		t.Fatalf("results %+v, want one per card", results)
	}
	if results[0].ID == "" || results[0].Error != "" {
		t.Errorf("the good card did not land: %+v", results[0])
	}
	// The bad one is reported, not thrown: the agent has to know which to redo.
	if results[1].Error == "" {
		t.Errorf("a card with no title was accepted: %+v", results[1])
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

// The token is the whole of the caller's identity, so a call without one is a
// call from nobody.
func TestBoardToolsRefuseACallWithoutAGrant(t *testing.T) {
	mgr, writer := toolsManager(t)
	routes := newBoardToolRoutes()
	routes.SetManager(mgr)
	srv := httptest.NewServer(routes.Handler())
	defer srv.Close()

	body := strings.NewReader(`{"cards":[{"title":"Втихаря"}]}`)
	resp, err := http.Post(srv.URL+"/acp/board/cards", "application/json", body)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("a call with no grant was answered %s", resp.Status)
	}
	if len(writer.cards) != 0 {
		t.Error("a card was written for a caller with no grant")
	}

	// And an unknown grant is the same answer.
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/acp/board/columns", nil)
	req.Header.Set("Authorization", "Bearer made-up")
	columns, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer columns.Body.Close()
	if columns.StatusCode != http.StatusForbidden {
		t.Errorf("an unknown grant listed the board's columns (%s)", columns.Status)
	}
	_, _ = io.Copy(io.Discard, columns.Body)
}

// Before the ACP integration is up there is no board to write to, and a tool
// call must say so rather than panic on a manager that is not there.
func TestBoardToolsAnswerBeforeTheManagerExists(t *testing.T) {
	srv := httptest.NewServer(newBoardToolRoutes().Handler())
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/acp/board/columns")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("answered %s, want an honest refusal", resp.Status)
	}
	var ignored any
	_ = json.NewDecoder(resp.Body).Decode(&ignored)
}
