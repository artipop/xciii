package main

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/artipop/xciii/internal/sources/inbox"
)

// The tool an agent source files through, against the real ingest route and the
// real pipeline behind it. This is the whole reason an agent is allowed to
// bring cards in at all: it does not write to the board, it posts here, and
// everything that makes the inbox trustworthy — the rules, «Входящие», the
// (source, external id, version) key — is still in the way.

// inboxTool wires the MCP server to a front door serving the real ingest route,
// and returns a client session on it.
func inboxTool(t *testing.T) (*mcp.ClientSession, *recordingBoard) {
	t.Helper()
	routes, board := ingestRoutes(t)
	door := httptest.NewServer(routes)
	t.Cleanup(door.Close)

	server := inbox.NewServer(inbox.Config{
		BaseURL: door.URL,
		Source:  "телефон",
		Token:   testToken,
	}, door.Client())

	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	ctx := context.Background()
	if _, err := server.Connect(ctx, serverTransport, nil); err != nil {
		t.Fatal(err)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session, board
}

func fileItem(t *testing.T, session *mcp.ClientSession, args map[string]any) string {
	t.Helper()
	res, err := session.CallTool(context.Background(), &mcp.CallToolParams{
		Name: "file_item", Arguments: args,
	})
	if err != nil {
		t.Fatal(err)
	}
	text := ""
	for _, block := range res.Content {
		if content, ok := block.(*mcp.TextContent); ok {
			text = content.Text
		}
	}
	if res.IsError {
		return "ошибка: " + text
	}
	return text
}

// What an agent finds becomes a card by the same road a phone's notification
// does — and the answer it gets back is in the words it will repeat at the end
// of its turn.
func TestAnAgentFilesWhatItFoundThroughTheIngestRoute(t *testing.T) {
	session, board := inboxTool(t)

	got := fileItem(t, session, map[string]any{
		"id":      "kaiten-41",
		"version": "2026-08-09T10:00:00Z",
		"title":   "Починить логин",
		"url":     "https://kaiten.example/card/41",
		"body":    "падает на пустом пароле",
	})

	if !strings.Contains(got, "a card was created") {
		t.Fatalf("answer: %q", got)
	}
	if len(board.created) != 1 || board.created[0].Title != "Починить логин" {
		t.Fatalf("created: %+v", board.created)
	}
}

// The reason the agent is told to file everything it sees rather than to work
// out what is new: doing it twice is a no-op, and it is told so in words it can
// act on.
func TestFilingTheSameThingTwiceIsANoOp(t *testing.T) {
	session, board := inboxTool(t)
	item := map[string]any{"id": "kaiten-41", "version": "v1", "title": "Починить логин"}

	fileItem(t, session, item)
	got := fileItem(t, session, item)

	if len(board.created) != 1 {
		t.Fatalf("created: %+v", board.created)
	}
	if !strings.Contains(got, "already brought in") {
		t.Fatalf("answer: %q", got)
	}
}

// An item with nothing in it is refused as a tool error rather than as a
// protocol one: the model is meant to read it and go on to the next item.
func TestAnEmptyItemIsRefusedInWords(t *testing.T) {
	session, board := inboxTool(t)

	got := fileItem(t, session, map[string]any{"id": "kaiten-41"})

	if !strings.HasPrefix(got, "ошибка:") {
		t.Fatalf("answer: %q", got)
	}
	if len(board.created) != 0 {
		t.Fatalf("nothing should have been written: %+v", board.created)
	}
}

// The token is the whole of the protection on the loopback door, and the agent
// is handed one minted for its own turn. A wrong one must not file anything.
func TestAToolWithTheWrongTokenFilesNothing(t *testing.T) {
	routes, board := ingestRoutes(t)
	door := httptest.NewServer(routes)
	t.Cleanup(door.Close)

	server := inbox.NewServer(inbox.Config{
		BaseURL: door.URL, Source: "телефон", Token: "не тот",
	}, door.Client())
	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	ctx := context.Background()
	if _, err := server.Connect(ctx, serverTransport, nil); err != nil {
		t.Fatal(err)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()

	got := fileItem(t, session, map[string]any{"id": "1", "title": "Починить логин"})

	if !strings.HasPrefix(got, "ошибка:") {
		t.Fatalf("answer: %q", got)
	}
	if len(board.created) != 0 {
		t.Fatalf("nothing should have been written: %+v", board.created)
	}
}
