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
//
// English, like everything else this application says to an agent. The board is
// in whatever language the people using it write in, and their words travel
// through these tools as data — a column name, a card title. The instructions
// around them are ours, and one language for them is one thing to keep true.
const instructions = `The XCIII board's tools. Work comes back into the application through
them instead of into a chat message for somebody to retype: cards are created,
changed, and carried on across the board by themselves.

Once you and the person have agreed what to do, create the tasks: one card per
task, all of them in a single create_cards call.

If this conversation started with a task from a card, then it *is* a stage of a
route: when the work is done, say so with finish_work — the card then travels on
by itself, and until that call it stands still, waiting for you. If the card does
not travel by itself, move it to the next column with move_card; that is what
sets off everything that follows.

The board is already chosen and cannot be named. A column decides what happens to
a card that lands in it, and a route decides what happens after that: read
list_columns and list_flows first, then put a card where the work begins, unless
the person asked for something else. Give the folder, the agent, the route and
every other value by name — the names they have on the board.

You never have to name the card you are working on: wherever an id is asked for,
an empty value means that card.

Once it is clear what this conversation is about, say it in one line with
describe_conversation, and update it when you move on to something else — the
person reads that line in the list of open terminals to find the right one. If
you are asked to name the conversation, answer with name_conversation.`

// Card is one card asked for; the field names are what the model fills in.
type Card struct {
	Title       string   `json:"title" jsonschema:"the card's title — one line saying what has to be done"`
	Description string   `json:"description,omitempty" jsonschema:"the task itself: the context, what to change, how to check it"`
	Column      string   `json:"column,omitempty" jsonschema:"a column of the board, by name; see list_columns"`
	Options     []string `json:"options,omitempty" jsonschema:"the card's other fields, by the names of their values: folder, agent, route"`
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
	// Describe records, in one line, what the conversation this run is having is
	// about. It is the one tool here that writes about the *conversation* rather
	// than about the board, and it exists because nothing else can know: a
	// terminal is a vendor CLI in a pty, so no protocol carries a recap of it.
	Describe(ctx context.Context, text string) error
	// Name is what this conversation is called in the list of open terminals. It
	// is the same field a person renames by hand, and it is asked for rather than
	// volunteered: the app types the request into the conversation itself.
	Name(ctx context.Context, title string) error
	// Finish is the agent saying the stage of the route it was given is over,
	// and what became of it. It is the one thing the app cannot see for itself:
	// the stage is the agent's own CLI in a terminal, and an interactive CLI
	// does not exit when a turn ends.
	Finish(ctx context.Context, ok bool, summary string) error
}

type createInput struct {
	Card
}

type createManyInput struct {
	Cards []Card `json:"cards" jsonschema:"the cards, in order; every one is attempted and reported on separately"`
}

type cardsInput struct {
	Column string `json:"column,omitempty" jsonschema:"show only the cards in this column; empty means the whole board"`
}

type cardInput struct {
	CardID string `json:"cardId,omitempty" jsonschema:"the card's id; empty means the card being worked on"`
}

type updateInput struct {
	CardID  string   `json:"cardId,omitempty" jsonschema:"the card's id; empty means the card being worked on"`
	Title   string   `json:"title,omitempty" jsonschema:"a new title; empty leaves it alone"`
	Options []string `json:"options,omitempty" jsonschema:"the card's property values by name: folder, agent, route, the answer its route is waiting for"`
}

type moveInput struct {
	CardID string `json:"cardId,omitempty" jsonschema:"the card's id; empty means the card being worked on"`
	Column string `json:"column" jsonschema:"a column of the board, by name; see list_columns"`
}

type commentInput struct {
	CardID string `json:"cardId,omitempty" jsonschema:"the card's id; empty means the card being worked on"`
	Text   string `json:"text" jsonschema:"the comment"`
}

type describeInput struct {
	Text string `json:"text" jsonschema:"one line: what this conversation is doing right now"`
}

type nameInput struct {
	Title string `json:"title" jsonschema:"a short name for this conversation, three to five words, in the language the conversation is in"`
}

type finishInput struct {
	Done    bool   `json:"done" jsonschema:"true — the card's work is done; false — it could not be done"`
	Summary string `json:"summary" jsonschema:"what was done, or why it could not be — this goes onto the card as a comment"`
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
		Description: "The board's columns, and what happens to a card that lands in each of them.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ noInput) (*mcp.CallToolResult, any, error) {
		columns, err := board.Columns(ctx)
		if err != nil {
			return errorResult("%v", err), nil, nil
		}
		if len(columns) == 0 {
			return textResult("This board has no configured columns: a card just lands on it and a person picks it up."), nil, nil
		}
		var b strings.Builder
		for _, col := range columns {
			fmt.Fprintf(&b, "- %s", col.Name)
			if col.Action != "" {
				fmt.Fprintf(&b, " — %s", col.Action)
			}
			if len(col.Agents) > 0 {
				fmt.Fprintf(&b, " (agents: %s)", strings.Join(col.Agents, ", "))
			}
			b.WriteString("\n")
		}
		return textResult(strings.TrimSpace(b.String())), nil, nil
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_flows",
		Description: "The board's routes: which columns a card travels by itself, and what moves it along.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ noInput) (*mcp.CallToolResult, any, error) {
		flows, err := board.Flows(ctx)
		if err != nil {
			return errorResult("%v", err), nil, nil
		}
		if len(flows) == 0 {
			return textResult("This board has no routes: a card stays where it was put until somebody moves it."), nil, nil
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
					fmt.Fprintf(&b, " (agents: %s)", strings.Join(stage.Crew, ", "))
				}
				if len(stage.Waiting) > 0 {
					fmt.Fprintf(&b, " [next: %s]", strings.Join(stage.Waiting, "; "))
				}
				b.WriteString("\n")
			}
		}
		return textResult(strings.TrimSpace(b.String())), nil, nil
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_cards",
		Description: "The board's cards: id, title, column, the values selected on each, and where it stands on its route.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in cardsInput) (*mcp.CallToolResult, any, error) {
		cards, err := board.Cards(ctx, in.Column)
		if err != nil {
			return errorResult("%v", err), nil, nil
		}
		if len(cards) == 0 {
			if strings.TrimSpace(in.Column) != "" {
				return textResult(fmt.Sprintf("There are no cards in the %q column.", in.Column)), nil, nil
			}
			return textResult("This board has no cards."), nil, nil
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
		Description: "One card in full: its description, the values selected on it, and where it stands on its route.",
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
		Description: "Create one card on the board.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in createInput) (*mcp.CallToolResult, any, error) {
		return created(board.CreateCards(ctx, []Card{in.Card}))
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "create_cards",
		Description: "Create several cards at once — this is how breaking a task down ends.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in createManyInput) (*mcp.CallToolResult, any, error) {
		if len(in.Cards) == 0 {
			return errorResult("no cards were passed"), nil, nil
		}
		return created(board.CreateCards(ctx, in.Cards))
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name: "update_card",
		Description: "Change a card: its title, and its property values by name — folder, agent, route, " +
			"the answer its route is waiting for. Not its column: move_card is for that.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in updateInput) (*mcp.CallToolResult, any, error) {
		if strings.TrimSpace(in.Title) == "" && len(in.Options) == 0 {
			return errorResult("nothing was said to change"), nil, nil
		}
		err := board.UpdateCard(ctx, CardChange{CardID: in.CardID, Title: in.Title, Options: in.Options})
		if err != nil {
			return errorResult("%v", err), nil, nil
		}
		return textResult("The card has been changed."), nil, nil
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name: "move_card",
		Description: "Move a card to another column. This is what sets off whatever that column does " +
			"with a card — it is how work is handed on across the board.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in moveInput) (*mcp.CallToolResult, any, error) {
		if strings.TrimSpace(in.Column) == "" {
			return errorResult("no column was named"), nil, nil
		}
		if err := board.UpdateCard(ctx, CardChange{CardID: in.CardID, Column: in.Column}); err != nil {
			return errorResult("%v", err), nil, nil
		}
		return textResult(fmt.Sprintf("The card is in the %q column.", in.Column)), nil, nil
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name: "comment_card",
		Description: "Write on a card — the same place the person reads everything else the agents " +
			"have said about it.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in commentInput) (*mcp.CallToolResult, any, error) {
		if strings.TrimSpace(in.Text) == "" {
			return errorResult("the comment is empty"), nil, nil
		}
		if err := board.Comment(ctx, in.CardID, in.Text); err != nil {
			return errorResult("%v", err), nil, nil
		}
		return textResult("The comment has been added."), nil, nil
	})

	// How a stage of a route ends. The app started this conversation with the
	// card's task in it and has no other way to learn that the task is done: a
	// CLI that is still running is a CLI a person may simply be reading.
	mcp.AddTool(srv, &mcp.Tool{
		Name: "finish_work",
		Description: "Say that the card's work is finished. Call this when you have done what the " +
			"card asks — or when it is clear that it cannot be done. Until you say so the card stands " +
			"still, waiting for you; after it, the card travels on along its route and this " +
			"conversation closes.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in finishInput) (*mcp.CallToolResult, any, error) {
		if strings.TrimSpace(in.Summary) == "" {
			return errorResult("nothing was said about what was done: the short summary goes onto the card, and it is what the person reads"), nil, nil
		}
		if err := board.Finish(ctx, in.Done, in.Summary); err != nil {
			return errorResult("%v", err), nil, nil
		}
		if in.Done {
			return textResult("The work is accepted and the card travels on. This conversation is about to close."), nil, nil
		}
		return textResult("Recorded that the work could not be finished. The card takes the route's branch for failure."), nil, nil
	})

	// The two tools here about the conversation rather than about the board. A
	// person picks one terminal out of a list of them, and the list would
	// otherwise say who is talking and where and nothing about what is going on.
	mcp.AddTool(srv, &mcp.Tool{
		Name: "describe_conversation",
		Description: "Say in one line what this conversation is doing. The person sees that line in " +
			"the list of open terminals. Update it when you move on to something else; an empty string removes it.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in describeInput) (*mcp.CallToolResult, any, error) {
		if err := board.Describe(ctx, in.Text); err != nil {
			return errorResult("%v", err), nil, nil
		}
		if strings.TrimSpace(in.Text) == "" {
			return textResult("The conversation's description has been removed."), nil, nil
		}
		return textResult("The conversation's description has been updated."), nil, nil
	})

	// Named rather than described: the name is what the row in the list is called
	// and what a person renames by hand, while the description is a line under it
	// that changes as the conversation moves on. The app asks for this one — it
	// types the request into the conversation (AskTerminalName) — because a name
	// nobody gave reads «клаус · черновики доски», which is true of every row.
	mcp.AddTool(srv, &mcp.Tool{
		Name: "name_conversation",
		Description: "Give this conversation a short name — three to five words, in the language the " +
			"conversation is in. The person picks it out of a list of open terminals by that name.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in nameInput) (*mcp.CallToolResult, any, error) {
		if strings.TrimSpace(in.Title) == "" {
			return errorResult("no name was given"), nil, nil
		}
		if err := board.Name(ctx, in.Title); err != nil {
			return errorResult("%v", err), nil, nil
		}
		return textResult(fmt.Sprintf("This conversation is now called %q.", strings.TrimSpace(in.Title))), nil, nil
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
		b.WriteString(" (this is the card you are working on)")
	}
	if card.Column != "" {
		fmt.Fprintf(&b, "\n  column: %s", card.Column)
	}
	if len(card.Options) > 0 {
		fmt.Fprintf(&b, "\n  values: %s", strings.Join(card.Options, ", "))
	}
	if card.Flow != "" {
		fmt.Fprintf(&b, "\n  route: %s", card.Flow)
		if card.Stage != "" {
			fmt.Fprintf(&b, ", stage %q", card.Stage)
		}
		switch {
		case card.Running:
			b.WriteString(", an agent is working on it")
		case card.Queued:
			b.WriteString(", waiting its turn")
		}
		if len(card.Waiting) > 0 {
			fmt.Fprintf(&b, "\n  travels on when: %s", strings.Join(card.Waiting, "; "))
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
			fmt.Fprintf(&b, "- %q was not created: %s\n", r.Title, r.Error)
			continue
		}
		fmt.Fprintf(&b, "- %q created (%s)\n", r.Title, r.ID)
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
		text = "(empty answer)"
	}
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}
}

func errorResult(format string, args ...any) *mcp.CallToolResult {
	res := textResult(fmt.Sprintf(format, args...))
	res.IsError = true
	return res
}
