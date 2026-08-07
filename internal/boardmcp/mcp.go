// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Package boardmcp is the board as an agent's tools: the way an agent hands
// work back to this application instead of printing it for a person to retype.
//
// A planning conversation ends in tasks. Until it could create them itself, the
// end of planning was a person reading the screen and typing cards in by hand —
// and that is the only step of the whole loop still done twice.
package boardmcp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// ServerName is how the tools appear to an agent: mcp__board__create_card etc.
const ServerName = "board"

// Environment the MCP process is configured through. The board is deliberately
// not among these: it is what the token stands for, so an agent that reads its
// own environment still cannot name another board.
const (
	EnvOrigin = "XCIII_BOARD_URL"   // front door this app answers on
	EnvToken  = "XCIII_BOARD_TOKEN" // grant for one board, for one agent run
)

// version tracks the tool surface, not the app.
const version = "0.1.0"

// instructions arrive with the tool list, before any prompt written elsewhere.
const instructions = `Инструменты доски XCIII. Через них можно завести карточки —
это способ отдать результат обсуждения приложению, а не человеку в переписку.

Доска уже выбрана, указать другую нельзя. Колонка решает, что с карточкой
произойдёт дальше: сначала посмотри list_columns, потом клади карточку в ту
колонку, где работа начинается, если только человек не попросил иначе.
Проект, агента и маршрут задавай именами — так, как они называются на доске.`

// Card is one card asked for. The field names are what the model fills in, and
// they are also the wire format of the app's own endpoint.
type Card struct {
	Title       string   `json:"title" jsonschema:"заголовок карточки — одна строка, что нужно сделать"`
	Description string   `json:"description,omitempty" jsonschema:"описание задачи: контекст, что менять, как проверить"`
	Column      string   `json:"column,omitempty" jsonschema:"колонка доски по имени; см. list_columns"`
	Options     []string `json:"options,omitempty" jsonschema:"остальные поля карточки именами значений: проект, агент, маршрут"`
}

// CardResult is what the app says about a card it created.
type CardResult struct {
	ID    string `json:"id,omitempty"`
	Title string `json:"title,omitempty"`
	Error string `json:"error,omitempty"`
}

// Column is one column as the agent is told about it.
type Column struct {
	Name   string   `json:"name"`
	Action string   `json:"action,omitempty"`
	Agents []string `json:"agents,omitempty"`
}

type createInput struct {
	Card
}

type createManyInput struct {
	Cards []Card `json:"cards" jsonschema:"карточки по порядку; заводятся все, о каждой сообщается отдельно"`
}

type noInput struct{}

// Client talks to the front door. It is a plain HTTP client on loopback: the
// board lives in the desktop process, and this server is a child of the agent,
// not of the app.
type Client struct {
	Origin string
	Token  string
	HTTP   *http.Client
}

// NewClient builds the client from the environment the app spawned us with.
func NewClient(origin, token string) (*Client, error) {
	if strings.TrimSpace(origin) == "" || strings.TrimSpace(token) == "" {
		return nil, fmt.Errorf("не заданы %s и %s", EnvOrigin, EnvToken)
	}
	if !strings.HasSuffix(origin, "/") {
		origin += "/"
	}
	return &Client{Origin: origin, Token: token, HTTP: &http.Client{Timeout: 30 * time.Second}}, nil
}

func (c *Client) post(ctx context.Context, path string, body, out any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Origin+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	return c.do(req, out)
}

func (c *Client) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.Origin+path, nil)
	if err != nil {
		return err
	}
	return c.do(req, out)
}

func (c *Client) do(req *http.Request, out any) error {
	req.Header.Set("Authorization", "Bearer "+c.Token)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("доска не отвечает: %w", err)
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("доска ответила %s: %s", resp.Status, strings.TrimSpace(string(payload)))
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(payload, out)
}

// Columns lists the board's columns and what each one starts.
func (c *Client) Columns(ctx context.Context) ([]Column, error) {
	var out []Column
	if err := c.get(ctx, "acp/board/columns", &out); err != nil {
		return nil, err
	}
	return out, nil
}

// Create asks the board for cards and reports on each one separately: a plan of
// five tasks must not be lost because the third names a column that is not
// there.
func (c *Client) Create(ctx context.Context, cards []Card) ([]CardResult, error) {
	var out []CardResult
	if err := c.post(ctx, "acp/board/cards", struct {
		Cards []Card `json:"cards"`
	}{Cards: cards}, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// NewServer exposes the client's operations as tools.
func NewServer(cl *Client) *mcp.Server {
	srv := mcp.NewServer(
		&mcp.Implementation{Name: ServerName, Title: "XCIII board", Version: version},
		&mcp.ServerOptions{Instructions: instructions},
	)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_columns",
		Description: "Колонки доски и что происходит с карточкой, попавшей в каждую из них.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ noInput) (*mcp.CallToolResult, any, error) {
		columns, err := cl.Columns(ctx)
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
		return created(cl.Create(ctx, []Card{in.Card}))
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "create_cards",
		Description: "Завести несколько карточек разом — так заканчивается разбор задачи на части.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in createManyInput) (*mcp.CallToolResult, any, error) {
		if len(in.Cards) == 0 {
			return errorResult("не передано ни одной карточки"), nil, nil
		}
		return created(cl.Create(ctx, in.Cards))
	})

	return srv
}

// created turns the per-card outcome into what the model reads back. Failures
// are named rather than aggregated: the agent has to know which card to redo.
func created(results []CardResult, err error) (*mcp.CallToolResult, any, error) {
	if err != nil {
		return errorResult("%v", err), nil, nil
	}
	var b strings.Builder
	failed := 0
	for _, r := range results {
		switch {
		case r.Error != "":
			failed++
			fmt.Fprintf(&b, "- %q не заведена: %s\n", r.Title, r.Error)
		default:
			fmt.Fprintf(&b, "- %q заведена (%s)\n", r.Title, r.ID)
		}
	}
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

// ServeStdio runs the server on the agent's stdio until it closes it.
func ServeStdio(ctx context.Context, cl *Client) error {
	return NewServer(cl).Run(ctx, &mcp.StdioTransport{})
}
