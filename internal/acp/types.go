// Package acp implements the board-to-coding-agent integration described in
// TZ_ACP_wails_v0.2.md: moving a card into a trigger column starts an ACP
// session in a dedicated git worktree and reports progress back to the card.
//
// The package deliberately knows nothing about the board server. It talks
// to the board only through the BoardEvents/BoardWriter interfaces below, whose
// implementations live in internal/boardadapter.
package acp

import (
	"context"
	"time"
)

// Column identifies one option of a select property ("column" on a kanban board).
type Column struct {
	PropertyID   string // select property id on the board
	PropertyName string // e.g. "Status"
	OptionID     string // option id stored in the card's properties map
	Name         string // option display value, e.g. "To Agent"
}

// CardMoved is the normalized "card changed column" event.
type CardMoved struct {
	EventID     string
	CardID      string
	BoardID     string
	Title       string
	Body        string            // card description text, if any
	Props       map[string]string // lowercased property name → display value
	OptionNames []string          // display names of every selected select/multiSelect option (tags included)
	// PersonNames are the usernames behind every person/multiPerson value on the
	// card — the "Assignee" route to an agent, which works because a registered
	// agent is provisioned as a board user (see BoardUsers).
	PersonNames []string
	FromColumn  Column
	ToColumn    Column
	At          time.Time
}

// BoardEvents delivers normalized card-move events from the board.
type BoardEvents interface {
	Subscribe(ctx context.Context) (<-chan CardMoved, error)
}

// BoardWriter performs the mutations the integration needs.
type BoardWriter interface {
	AddComment(ctx context.Context, cardID, text string) error
	MoveCard(ctx context.Context, cardID, optionID string) error
	// MoveCardByOptionName moves a card to a column the config names rather than
	// identifies: "Tested", not an option id.
	MoveCardByOptionName(ctx context.Context, cardID, propertyName, optionName string) error
	// AttachFile adds a file to the card's content — how a test run's
	// screenshots reach the person reading the result.
	AttachFile(ctx context.Context, cardID, filename, mime string, data []byte) error
	// CreateCard puts a new card on a board. This is the one way work gets onto
	// the board from outside a person's hands, and it exists for the planning
	// conversation: it ends in tasks, and until now somebody had to retype them.
	CreateCard(ctx context.Context, card NewCard) (string, error)
	// UpdateCard changes an existing card: its title, its select values, the
	// column it stands in. Alone among the writes here it is *not* silent — see
	// CardEdit for why.
	UpdateCard(ctx context.Context, cardID string, edit CardEdit) error
}

// NewCard is a card asked for from outside the board — by an agent through the
// board MCP server today. The board is not a field an agent fills in: it comes
// from the grant its tools were started with, so a conversation about one board
// cannot leave cards on another.
type NewCard struct {
	BoardID string
	Title   string
	Body    string
	// Column is the name of the option in the board's trigger property. It is
	// what decides whether anything happens to the card next, so a card asked
	// for without one lands wherever a card with no column lands.
	Property string
	Column   string
	// Options are the card's other select values by option name — a project, an
	// agent, a route. Which property each belongs to is the board's business,
	// not the caller's: that is already how a card is read back (CardMoved
	// carries OptionNames, and project/agent/flow resolution matches against
	// them without caring which property they came from).
	Options []string
}

// CardEdit is a change to a card asked for from outside the board — by an agent
// through the board MCP server today. Every field is empty-means-unchanged, so a
// caller that only knows the column does not have to send the title back with it.
//
// The rest of BoardWriter writes with notifications off, because those writes
// are the integration's own bookkeeping and must not re-trigger the agent that
// produced them. This one is the opposite: an agent asking for a card to move is
// somebody asking the board for something, exactly as a person dragging it is,
// and the automation has to see it or the request means nothing.
//
// The card's description is deliberately not here. It is a person's content —
// arbitrary blocks a person wrote — and an agent that has something to say about
// a card says it in a comment, which is where everything else a session says
// already goes.
type CardEdit struct {
	Title string
	// Property/Column name the column the card should stand in, the way the
	// config names it rather than by option id.
	Property string
	Column   string
	// Options are the card's other select values by option name — a project, a
	// route, the answer a stage is waiting for. Which property each belongs to
	// is the board's business, as it is for NewCard.
	Options []string
}

// BoardReader reads a card on demand, so a session can be opened from the UI
// without waiting for the card to be moved into the trigger column. The
// returned event carries no columns — nothing was moved.
type BoardReader interface {
	CardByID(ctx context.Context, cardID string) (CardMoved, error)
	// CardsForBoard is every card on a board. The events it returns carry no
	// Body: reading one costs a query per card, and a list is read to pick a
	// card out, not to work from it — CardByID is what answers about one card.
	CardsForBoard(ctx context.Context, boardID string) ([]CardMoved, error)
}

// BoardCardState keeps what this integration knows about one card on the card
// itself, beside the properties a person filled in. Today that is where the
// card stands on its route (FlowState).
//
// It is a separate interface from BoardWriter because it is not a write a
// person asked for: it never notifies, so it cannot set off the automation that
// produced it, and it never touches anything a person can see.
//
// Optional. A manager without it keeps the position in its own store only,
// which is what every test that does not care about the board does.
type BoardCardState interface {
	CardFlow(ctx context.Context, cardID string) (FlowState, bool, error)
	SetCardFlow(ctx context.Context, cardID string, st FlowState) error
	ClearCardFlow(ctx context.Context, cardID string) error
	// BoardCardFlows is every parked card of one board, which is how this
	// machine refills its index for a board it has not seen before — an
	// imported one, or one somebody else's machine has been moving.
	BoardCardFlows(ctx context.Context, boardID string) ([]FlowState, error)
}

// AgentUser is a registry entry seen as a board account: the user an agent is
// assigned as. Username is derived from Name (see AgentUsername); UserID and
// Created are filled in by BoardUsers.
type AgentUser struct {
	Name     string `json:"name"`
	Username string `json:"username"`
	UserID   string `json:"userId,omitempty"`
	Created  bool   `json:"created,omitempty"`
}

// BoardUsers keeps the board-side accounts in step with the agent registry, so
// an agent can be picked in a person property ("Assignee") like any other
// member — and stops being offered once it is unregistered. Optional, but a
// board without it has no way left to name an agent on a card: assigning one
// is the way.
type BoardUsers interface {
	// EnsureAgentAccounts gives every agent the account it is named by, and
	// nothing else. An account is the machine's, like the registry it comes
	// from, so this needs no board: it runs when an agent is registered, which
	// is the one moment there is something new to write.
	EnsureAgentAccounts(ctx context.Context, agents []AgentUser) ([]AgentUser, error)

	EnsureAgentUsers(ctx context.Context, boardID string, agents []AgentUser) ([]AgentUser, error)
	// RetireAgentUser drops the account's board memberships and reports how
	// many were removed. The account itself stays: cards may still name it, and
	// re-registering the agent should give it its identity back.
	RetireAgentUser(ctx context.Context, agent AgentUser) (int, error)
}

// UIEmitter pushes events to the desktop UI. Implementations must be safe to
// call before the UI is ready (drop and log).
type UIEmitter interface {
	Emit(event string, payload any)
}

// SessionStatus is the lifecycle state of an agent session.
type SessionStatus string

const (
	StatusQueued  SessionStatus = "queued"
	StatusRunning SessionStatus = "running"
	// StatusIdle and StatusWaitingPermission are no longer reached: a session
	// runs its task and ends, and a tool outside the policy is refused rather
	// than put to a person. They stay because rows written before that still
	// say so, and a status read back from the database has to mean something.
	StatusIdle              SessionStatus = "idle"
	StatusWaitingPermission SessionStatus = "waiting_permission"
	StatusDone              SessionStatus = "done"
	StatusFailed            SessionStatus = "failed"
	StatusCancelled         SessionStatus = "cancelled"
)

// Terminal reports whether the status is final.
func (s SessionStatus) Terminal() bool {
	return s == StatusDone || s == StatusFailed || s == StatusCancelled
}

// UI event names emitted through UIEmitter. There are two: a session changed
// state, and a terminal appeared or ended. What a session *says* is not among
// them — that is the card's comments, and, while an agent is working with a
// person, the terminal window it runs in.
const (
	EventSession = "acp:session"
	// EventTerminal says a terminal session (an agent CLI in a window) started
	// or ended, so a card can offer to open or to resume it.
	EventTerminal = "acp:terminal"
	// EventAttention says an agent stopped and is waiting for a person — the
	// one state a card cannot infer from anything it already has, because it
	// happens inside a terminal nobody may be looking at.
	EventAttention = "acp:attention"
)
