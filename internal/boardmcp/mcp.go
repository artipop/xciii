// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Package boardmcp is the board as an agent's tools: the way an agent hands
// work back to this application instead of printing it for a person to retype.
//
// A planning conversation ends in tasks. Until it could create them itself, the
// end of planning was a person reading the screen and typing the cards in by
// hand — the only step of the whole loop still done twice.
//
// The server is served by the app, over HTTP, on the front door. The other two
// MCP servers here are subprocesses because they do work of their own — dokku
// talks ssh, webtest drives a browser — and an agent spawning them is the whole
// arrangement. This one *is* the app: the board it writes to lives in this
// process, and the app is already a separate process from the agent, already
// listening on an origin the agent can reach. A subprocess in between would
// have been a proxy of ours to ourselves, with the tool schema written twice.
package boardmcp

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// ServerName is how the tools appear to an agent: mcp__board__create_card etc.
const ServerName = "board"

// Path is where the front door serves this, under the /acp/ subtree that is
// already ours.
const Path = "/acp/board/mcp"

// version tracks the tool surface, not the app.
const version = "0.1.0"

// instructions arrive with the tool list, before any prompt written elsewhere.
const instructions = `Инструменты доски XCIII. Через них можно завести карточки —
это способ отдать результат обсуждения приложению, а не человеку в переписку.

Доска уже выбрана, указать другую нельзя. Колонка решает, что с карточкой
произойдёт дальше: сначала посмотри list_columns, потом клади карточку в ту
колонку, где работа начинается, если только человек не попросил иначе.
Проект, агента и маршрут задавай именами — так, как они называются на доске.`

// Card is one card asked for; the field names are what the model fills in.
type Card struct {
	Title       string   `json:"title" jsonschema:"заголовок карточки — одна строка, что нужно сделать"`
	Description string   `json:"description,omitempty" jsonschema:"описание задачи: контекст, что менять, как проверить"`
	Column      string   `json:"column,omitempty" jsonschema:"колонка доски по имени; см. list_columns"`
	Options     []string `json:"options,omitempty" jsonschema:"остальные поля карточки именами значений: проект, агент, маршрут"`
}

// CardResult is what became of one card.
type CardResult struct {
	ID    string
	Title string
	Error string
}

// Column is one column as the agent is told about it: the name it must use and
// what putting a card there sets off.
type Column struct {
	Name   string
	Action string
	Agents []string
}

// Board is the board these tools act on, already bound to one agent's grant —
// which is why no method takes a board id. Resolving the grant is the handler's
// job, and it happens per request.
type Board interface {
	Columns(ctx context.Context) ([]Column, error)
	// CreateCards attempts every card and reports on each: a plan is a list,
	// and one bad column in it must not cost the other four.
	CreateCards(ctx context.Context, cards []Card) ([]CardResult, error)
}

type createInput struct {
	Card
}

type createManyInput struct {
	Cards []Card `json:"cards" jsonschema:"карточки по порядку; заводятся все, о каждой сообщается отдельно"`
}

type noInput struct{}

// NewServer exposes one board's operations as tools.
func NewServer(board Board) *mcp.Server {
	srv := mcp.NewServer(
		&mcp.Implementation{Name: ServerName, Title: "XCIII board", Version: version},
		&mcp.ServerOptions{Instructions: instructions},
	)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_columns",
		Description: "Колонки доски и что происходит с карточкой, попавшей в каждую из них.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ noInput) (*mcp.CallToolResult, any, error) {
		columns, err := board.Columns(ctx)
		if err != nil {
			return errorResult("%v", err), nil, nil
		}
		if len(columns) == 0 {
			return textResult("У доски нет настроенных колонок: карточка просто ляжет на доску, и её возьмёт человек."), nil, nil
		}
		var b strings.Builder
		for _, col := range columns {
			fmt.Fprintf(&b, "- %s", col.Name)
			if col.Action != "" {
				fmt.Fprintf(&b, " — %s", col.Action)
			}
			if len(col.Agents) > 0 {
				fmt.Fprintf(&b, " (агенты: %s)", strings.Join(col.Agents, ", "))
			}
			b.WriteString("\n")
		}
		return textResult(strings.TrimSpace(b.String())), nil, nil
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "create_card",
		Description: "Завести на доске одну карточку.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in createInput) (*mcp.CallToolResult, any, error) {
		return created(board.CreateCards(ctx, []Card{in.Card}))
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "create_cards",
		Description: "Завести несколько карточек разом — так заканчивается разбор задачи на части.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in createManyInput) (*mcp.CallToolResult, any, error) {
		if len(in.Cards) == 0 {
			return errorResult("не передано ни одной карточки"), nil, nil
		}
		return created(board.CreateCards(ctx, in.Cards))
	})

	return srv
}

// NewHandler serves the tools over MCP's HTTP transport. open resolves the
// request to the board its caller was granted, and its error is the refusal the
// caller gets — nothing here is reachable without a grant.
//
// Stateless on purpose: the tools are one request each, and a session id that
// outlived the check would be a second way in that carries no grant.
func NewHandler(open func(*http.Request) (Board, error)) http.Handler {
	inner := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		board, err := open(r)
		if err != nil {
			return nil
		}
		return NewServer(board)
	}, &mcp.StreamableHTTPOptions{Stateless: true})

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := open(r); err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		inner.ServeHTTP(w, r)
	})
}

// created turns the per-card outcome into what the model reads back. Failures
// are named rather than counted: the agent has to know which card to redo.
func created(results []CardResult, err error) (*mcp.CallToolResult, any, error) {
	if err != nil {
		return errorResult("%v", err), nil, nil
	}
	var b strings.Builder
	failed := 0
	for _, r := range results {
		if r.Error != "" {
			failed++
			fmt.Fprintf(&b, "- %q не заведена: %s\n", r.Title, r.Error)
			continue
		}
		fmt.Fprintf(&b, "- %q заведена (%s)\n", r.Title, r.ID)
	}
	// Nothing landing at all is a failed call: the agent must see that its plan
	// is not on the board rather than read a list and move on.
	if failed > 0 && failed == len(results) {
		return errorResult("%s", strings.TrimSpace(b.String())), nil, nil
	}
	return textResult(strings.TrimSpace(b.String())), nil, nil
}

func textResult(text string) *mcp.CallToolResult {
	if strings.TrimSpace(text) == "" {
		text = "(пустой ответ)"
	}
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}
}

func errorResult(format string, args ...any) *mcp.CallToolResult {
	res := textResult(fmt.Sprintf(format, args...))
	res.IsError = true
	return res
}
