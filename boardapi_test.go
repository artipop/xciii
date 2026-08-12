package main

import (
	"context"
	"fmt"
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
	cards    []acp.NewCard
	edits    map[string]acp.CardEdit
	comments map[string][]string
}

func (w *recordingWriter) AddComment(_ context.Context, cardID, text string) error {
	if w.comments == nil {
		w.comments = map[string][]string{}
	}
	w.comments[cardID] = append(w.comments[cardID], text)
	return nil
}
func (w *recordingWriter) MoveCard(context.Context, string, string) error { return nil }
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

func (w *recordingWriter) UpdateCard(_ context.Context, cardID string, edit acp.CardEdit) error {
	if w.edits == nil {
		w.edits = map[string]acp.CardEdit{}
	}
	w.edits[cardID] = edit
	return nil
}

// recordingReader is the board read back: two cards on the granted board and one
// on another, which is the case the grant has to refuse.
type recordingReader struct{}

func (r *recordingReader) CardByID(_ context.Context, cardID string) (acp.CardMoved, error) {
	for _, card := range r.cards() {
		if card.CardID == cardID {
			return card, nil
		}
	}
	return acp.CardMoved{}, fmt.Errorf("no card %s", cardID)
}

func (r *recordingReader) CardsForBoard(_ context.Context, boardID string) ([]acp.CardMoved, error) {
	var out []acp.CardMoved
	for _, card := range r.cards() {
		if card.BoardID == boardID {
			out = append(out, card)
		}
	}
	return out, nil
}

func (r *recordingReader) cards() []acp.CardMoved {
	return []acp.CardMoved{
		{
			CardID:      "card-1",
			BoardID:     "board-1",
			Title:       "Починить окно",
			Body:        "Оно открывается пополам.",
			Props:       map[string]string{"статус": "К АГЕНТУ"}, // the board shouts a select value
			OptionNames: []string{"К агенту", "xciii"},
		},
		{CardID: "card-2", BoardID: "board-1", Title: "Вторая",
			Props: map[string]string{"статус": "ИДЕИ"}, OptionNames: []string{"Идеи"}},
		{CardID: "elsewhere", BoardID: "board-2", Title: "Чужая"},
	}
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
	mgr.SetBoardReader(&recordingReader{})

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
	session := connect(t, endpoint, mgr.GrantBoardTools("board-1", ""))

	tools, err := session.ListTools(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	offered := map[string]bool{}
	for _, tool := range tools.Tools {
		offered[tool.Name] = true
	}
	for _, want := range []string{
		"list_columns", "list_flows", "list_cards", "get_card",
		"create_card", "create_cards", "update_card", "move_card", "comment_card",
	} {
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

// Work comes back to the board the same way it went out: the agent finds the
// card, moves it into the next column — which is what sets the automation off —
// and says on the card what it did.
func TestAnAgentCarriesACardOnThroughTheTools(t *testing.T) {
	mgr, writer, endpoint := toolsBoard(t)
	session := connect(t, endpoint, mgr.GrantBoardTools("board-1", "card-1"))

	// The board's own cards, and only the granted board's.
	cards, err := session.CallTool(t.Context(), &mcp.CallToolParams{Name: "list_cards"})
	if err != nil {
		t.Fatal(err)
	}
	list := toolText(t, cards)
	if !strings.Contains(list, "card-1") || !strings.Contains(list, "Починить окно") {
		t.Errorf("the agent cannot find the card it works on: %s", list)
	}
	if strings.Contains(list, "elsewhere") {
		t.Errorf("a card of another board is offered: %s", list)
	}
	// The card the run stands on is pointed out, because it is what a call that
	// names none acts on.
	if !strings.Contains(list, "в работе у тебя") {
		t.Errorf("the agent is not told which card is its own: %s", list)
	}

	// A card named by nothing at all is the run's own card, description and all.
	card, err := session.CallTool(t.Context(), &mcp.CallToolParams{Name: "get_card"})
	if err != nil {
		t.Fatal(err)
	}
	if text := toolText(t, card); !strings.Contains(text, "Оно открывается пополам.") {
		t.Errorf("the run's own card read back as %q", text)
	}

	// Moving it is the handover, and it goes through as a named column.
	moved, err := session.CallTool(t.Context(), &mcp.CallToolParams{
		Name:      "move_card",
		Arguments: map[string]any{"column": "К агенту"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if moved.IsError {
		t.Fatalf("the card was not moved: %s", toolText(t, moved))
	}
	edit, ok := writer.edits["card-1"]
	if !ok {
		t.Fatalf("no write reached the board: %+v", writer.edits)
	}
	if edit.Column != "К агенту" || edit.Property != "Статус" {
		t.Errorf("the move landed as %+v, want the column property from the config", edit)
	}

	// Setting a value the route waits on is the other half of the same thing.
	if _, err := session.CallTool(t.Context(), &mcp.CallToolParams{
		Name:      "update_card",
		Arguments: map[string]any{"cardId": "card-2", "options": []any{"Одобрено"}},
	}); err != nil {
		t.Fatal(err)
	}
	if got := writer.edits["card-2"].Options; strings.Join(got, ",") != "Одобрено" {
		t.Errorf("the value the route waits on landed as %v", got)
	}

	if _, err := session.CallTool(t.Context(), &mcp.CallToolParams{
		Name:      "comment_card",
		Arguments: map[string]any{"text": "Сделал, ветка запушена."},
	}); err != nil {
		t.Fatal(err)
	}
	if got := writer.comments["card-1"]; len(got) != 1 || got[0] != "Сделал, ветка запушена." {
		t.Errorf("what the agent said did not reach the card: %v", got)
	}
}

// The grant is a board, not a doorway: a card id an agent read somewhere else
// opens nothing, or one board's tools would edit every other board's cards.
func TestTheToolsRefuseACardOfAnotherBoard(t *testing.T) {
	mgr, writer, endpoint := toolsBoard(t)
	session := connect(t, endpoint, mgr.GrantBoardTools("board-1", "card-1"))

	for _, call := range []*mcp.CallToolParams{
		{Name: "get_card", Arguments: map[string]any{"cardId": "elsewhere"}},
		{Name: "move_card", Arguments: map[string]any{"cardId": "elsewhere", "column": "К агенту"}},
		{Name: "comment_card", Arguments: map[string]any{"cardId": "elsewhere", "text": "Привет"}},
	} {
		res, err := session.CallTool(t.Context(), call)
		if err != nil {
			t.Fatal(err)
		}
		if !res.IsError {
			t.Errorf("%s reached a card of another board: %s", call.Name, toolText(t, res))
		}
	}
	if len(writer.edits) != 0 || len(writer.comments) != 0 {
		t.Errorf("another board's card was written to: %+v %+v", writer.edits, writer.comments)
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
	token := mgr.GrantBoardTools("board-1", "")
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
