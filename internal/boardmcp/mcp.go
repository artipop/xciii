// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Package boardmcp is the board as an agent's tools: the way an agent hands
// work back to this application instead of printing it for a person to retype.
//
// A planning conversation ends in tasks. Until it could create them itself, the
// end of planning was a person reading the screen and typing the cards in by
// hand — the only step of the whole loop still done twice.
//
// Finishing a task ends the same way, which is why creating cards is not all
// these tools do. A card carries what happens to it next in its own column, so
// an agent that can read the board and move a card on it can run the loop the
// board describes — and a person is left with the decisions instead of the
// dragging.
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

// instructions arrive with the tool list, and they are the only place these
// tools are described. Nothing in the prompts an agent is started with mentions
// them: a server says what it is for, and a prompt that named these tools would
// be a second copy of this paragraph — one that goes on telling an agent to use
// tools it was not given, in the file a person edits by hand.
const instructions = `Инструменты доски XCIII. Через них работа возвращается
в приложение, а не человеку в переписку: карточки заводятся, меняются и едут
дальше по доске сами.

Когда с человеком договорились, что делать, — заведи задачи: по одной карточке
на задачу, все разом через create_cards. Когда работа по карточке сделана —
переложи её в следующую колонку через move_card, это и запускает всё дальнейшее.

Доска уже выбрана, указать другую нельзя. Колонка решает, что с карточкой
произойдёт дальше, маршрут — что произойдёт после этого: сначала посмотри
list_columns и list_flows, потом клади карточку туда, где работа начинается,
если только человек не попросил иначе. Проект, агента, маршрут и любые другие
значения задавай именами — так, как они называются на доске.

Карточку, над которой ты работаешь, называть не нужно: там, где просят id,
пустое значение означает именно её.`

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

// FlowStage is one stage of a route: the column a card stands in, what runs
// there, and what carries the card on.
type FlowStage struct {
	Column  string
	Action  string
	Crew    []string
	Waiting []string
}

// Flow is one route the board's cards may take.
type Flow struct {
	Name   string
	Stages []FlowStage
}

// CardInfo is a card read back. Body and the route fields are filled in for one
// card asked about by itself; a listing carries neither.
type CardInfo struct {
	ID      string
	Title   string
	Column  string
	Options []string
	Body    string
	Mine    bool

	Flow    string
	Stage   string
	Waiting []string
	Running bool
	Queued  bool
}

// CardChange is what one card is asked to become. Empty means unchanged, so an
// agent that only wants to move a card sends only a column.
type CardChange struct {
	CardID  string
	Title   string
	Column  string
	Options []string
}

// Board is the board these tools act on, already bound to one agent's grant —
// which is why no method takes a board id. Resolving the grant is the handler's
// job, and it happens per request.
//
// A card id of "" everywhere below is the card the agent's own run stands on:
// the caller these tools mostly have is an agent working on one card, and making
// it look its own card up by title first is an invitation to act on another.
type Board interface {
	Columns(ctx context.Context) ([]Column, error)
	Flows(ctx context.Context) ([]Flow, error)
	// Cards lists the board's cards, optionally only those in one column.
	Cards(ctx context.Context, column string) ([]CardInfo, error)
	Card(ctx context.Context, cardID string) (CardInfo, error)
	// CreateCards attempts every card and reports on each: a plan is a list,
	// and one bad column in it must not cost the other four.
	CreateCards(ctx context.Context, cards []Card) ([]CardResult, error)
	// UpdateCard changes one card. A change with a column in it is a move, and
	// a move is what starts the column's automation.
	UpdateCard(ctx context.Context, change CardChange) error
	Comment(ctx context.Context, cardID, text string) error
}

type createInput struct {
	Card
}

type createManyInput struct {
	Cards []Card `json:"cards" jsonschema:"карточки по порядку; заводятся все, о каждой сообщается отдельно"`
}

type cardsInput struct {
	Column string `json:"column,omitempty" jsonschema:"показать только карточки этой колонки; пусто — вся доска"`
}

type cardInput struct {
	CardID string `json:"cardId,omitempty" jsonschema:"id карточки; пусто — та карточка, над которой идёт работа"`
}

type updateInput struct {
	CardID  string   `json:"cardId,omitempty" jsonschema:"id карточки; пусто — та карточка, над которой идёт работа"`
	Title   string   `json:"title,omitempty" jsonschema:"новый заголовок; пусто — оставить как есть"`
	Options []string `json:"options,omitempty" jsonschema:"значения свойств карточки именами: проект, агент, маршрут, ответ, которого ждёт маршрут"`
}

type moveInput struct {
	CardID string `json:"cardId,omitempty" jsonschema:"id карточки; пусто — та карточка, над которой идёт работа"`
	Column string `json:"column" jsonschema:"колонка доски по имени; см. list_columns"`
}

type commentInput struct {
	CardID string `json:"cardId,omitempty" jsonschema:"id карточки; пусто — та карточка, над которой идёт работа"`
	Text   string `json:"text" jsonschema:"текст комментария"`
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
		Name:        "list_flows",
		Description: "Маршруты доски: по каким колонкам карточка едет дальше сама и что её двигает.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ noInput) (*mcp.CallToolResult, any, error) {
		flows, err := board.Flows(ctx)
		if err != nil {
			return errorResult("%v", err), nil, nil
		}
		if len(flows) == 0 {
			return textResult("У доски нет маршрутов: карточка остаётся там, куда её положили, пока её не переложат."), nil, nil
		}
		var b strings.Builder
		for _, flow := range flows {
			fmt.Fprintf(&b, "%s:\n", flow.Name)
			for _, stage := range flow.Stages {
				fmt.Fprintf(&b, "  - %s", stage.Column)
				if stage.Action != "" {
					fmt.Fprintf(&b, " — %s", stage.Action)
				}
				if len(stage.Crew) > 0 {
					fmt.Fprintf(&b, " (агенты: %s)", strings.Join(stage.Crew, ", "))
				}
				if len(stage.Waiting) > 0 {
					fmt.Fprintf(&b, " [дальше: %s]", strings.Join(stage.Waiting, "; "))
				}
				b.WriteString("\n")
			}
		}
		return textResult(strings.TrimSpace(b.String())), nil, nil
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_cards",
		Description: "Карточки доски: id, заголовок, колонка, выбранные значения и где карточка стоит на маршруте.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in cardsInput) (*mcp.CallToolResult, any, error) {
		cards, err := board.Cards(ctx, in.Column)
		if err != nil {
			return errorResult("%v", err), nil, nil
		}
		if len(cards) == 0 {
			if strings.TrimSpace(in.Column) != "" {
				return textResult(fmt.Sprintf("В колонке %q карточек нет.", in.Column)), nil, nil
			}
			return textResult("На доске нет карточек."), nil, nil
		}
		var b strings.Builder
		for _, card := range cards {
			b.WriteString(cardLine(card))
			b.WriteString("\n")
		}
		return textResult(strings.TrimSpace(b.String())), nil, nil
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "get_card",
		Description: "Одна карточка целиком: описание, выбранные значения и где она стоит на маршруте.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in cardInput) (*mcp.CallToolResult, any, error) {
		card, err := board.Card(ctx, in.CardID)
		if err != nil {
			return errorResult("%v", err), nil, nil
		}
		out := cardLine(card)
		if strings.TrimSpace(card.Body) != "" {
			out += "\n\n" + card.Body
		}
		return textResult(out), nil, nil
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

	mcp.AddTool(srv, &mcp.Tool{
		Name: "update_card",
		Description: "Изменить карточку: заголовок и значения её свойств именами — проект, агент, " +
			"маршрут, ответ, которого ждёт маршрут. Колонку этим менять нельзя, для неё есть move_card.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in updateInput) (*mcp.CallToolResult, any, error) {
		if strings.TrimSpace(in.Title) == "" && len(in.Options) == 0 {
			return errorResult("не сказано, что менять"), nil, nil
		}
		err := board.UpdateCard(ctx, CardChange{CardID: in.CardID, Title: in.Title, Options: in.Options})
		if err != nil {
			return errorResult("%v", err), nil, nil
		}
		return textResult("Карточка изменена."), nil, nil
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name: "move_card",
		Description: "Переложить карточку в другую колонку. Это и запускает то, что колонка делает " +
			"с карточкой, — так работа передаётся дальше по доске.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in moveInput) (*mcp.CallToolResult, any, error) {
		if strings.TrimSpace(in.Column) == "" {
			return errorResult("не сказано, в какую колонку"), nil, nil
		}
		if err := board.UpdateCard(ctx, CardChange{CardID: in.CardID, Column: in.Column}); err != nil {
			return errorResult("%v", err), nil, nil
		}
		return textResult(fmt.Sprintf("Карточка в колонке %q.", in.Column)), nil, nil
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name: "comment_card",
		Description: "Написать в карточку — туда же, где человек читает всё остальное, что о ней " +
			"сказали агенты.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in commentInput) (*mcp.CallToolResult, any, error) {
		if strings.TrimSpace(in.Text) == "" {
			return errorResult("пустой комментарий"), nil, nil
		}
		if err := board.Comment(ctx, in.CardID, in.Text); err != nil {
			return errorResult("%v", err), nil, nil
		}
		return textResult("Комментарий добавлен."), nil, nil
	})

	return srv
}

// cardLine is one card in one line, which is what both the listing and the
// single-card answer are built from: the same card must not read differently
// depending on which tool asked for it.
func cardLine(card CardInfo) string {
	var b strings.Builder
	fmt.Fprintf(&b, "- %s — %s", card.ID, card.Title)
	if card.Mine {
		b.WriteString(" (эта карточка в работе у тебя)")
	}
	if card.Column != "" {
		fmt.Fprintf(&b, "\n  колонка: %s", card.Column)
	}
	if len(card.Options) > 0 {
		fmt.Fprintf(&b, "\n  значения: %s", strings.Join(card.Options, ", "))
	}
	if card.Flow != "" {
		fmt.Fprintf(&b, "\n  маршрут: %s", card.Flow)
		if card.Stage != "" {
			fmt.Fprintf(&b, ", шаг «%s»", card.Stage)
		}
		switch {
		case card.Running:
			b.WriteString(", агент работает")
		case card.Queued:
			b.WriteString(", ждёт очереди")
		}
		if len(card.Waiting) > 0 {
			fmt.Fprintf(&b, "\n  дальше поедет, когда: %s", strings.Join(card.Waiting, "; "))
		}
	}
	return b.String()
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
