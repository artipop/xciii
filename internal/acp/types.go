// Package acp is the board-to-coding-agent integration: a card entering a
// column starts work on it, and what happens is reported back to the card.
//
// It knows nothing about the board server — only the interfaces below, whose
// implementations live in internal/boardadapter. The reasoning behind the
// shapes here is in CLAUDE.md and docs/decisions.md.
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
	EventID         string
	CardID          string
	BoardID         string
	Title           string
	Body            string            // card description text, if any
	Props           map[string]string // lowercased property name → display value
	Values          map[string]string // by property id — how this app finds the fields it made
	OptionNames     []string          // display names of every selected select/multiSelect option
	PersonNames     []string          // usernames behind person values, for reading
	PersonIDs       []string          // the same values as ids — what an assigned card is matched by
	SelectedOptions []Column          // every single-select value, with the ids OptionNames drops
	FromColumn      Column
	ToColumn        Column
	At              time.Time
}

// BoardEvents delivers normalized card-move events from the board.
type BoardEvents interface {
	Subscribe(ctx context.Context) (<-chan CardMoved, error)
}

// BoardWriter performs the mutations the integration needs. Every write here is
// silent except UpdateCard — see CardEdit.
type BoardWriter interface {
	AddComment(ctx context.Context, cardID, text string) error
	MoveCard(ctx context.Context, cardID, optionID string) error
	// MoveCardByOptionName moves by name rather than by option id.
	MoveCardByOptionName(ctx context.Context, cardID, propertyName, optionName string) error
	AttachFile(ctx context.Context, cardID, filename, mime string, data []byte) error
	CreateCard(ctx context.Context, card NewCard) (string, error)
	UpdateCard(ctx context.Context, cardID string, edit CardEdit) error
	// SetCardText writes one text property by id — never by name, which is the
	// board's to choose (BoardPropBranch records which property this is).
	SetCardText(ctx context.Context, cardID, propertyID, value string) error
	// SetCardFields writes named properties: a select by one of its option
	// names, anything else as text.
	SetCardFields(ctx context.Context, cardID string, fields map[string]string) error
}

// NewCard is a card asked for from outside the board — by an agent through the
// board MCP server. BoardID comes from the run's grant rather than the caller,
// so a conversation about one board cannot leave cards on another.
type NewCard struct {
	BoardID  string
	Title    string
	Body     string
	Property string
	Column   string
	// Options are the card's other select values by option name. Which property
	// each belongs to is the board's business, not the caller's.
	Options []string
}

// CardEdit is a change asked for from outside the board. Empty means unchanged.
//
// It is the one write in BoardWriter that notifies: an agent asking for a card
// to move is a request to the board exactly as a person's drag is, and the
// automation has to see it. The description is deliberately absent — that is a
// person's content, and an agent says what it has to say in a comment.
type CardEdit struct {
	Title    string
	Property string
	Column   string
	Options  []string
}

// BoardReader reads a card on demand, so work can be started from the UI
// without moving the card. The returned event carries no columns.
type BoardReader interface {
	CardByID(ctx context.Context, cardID string) (CardMoved, error)
	// CardsForBoard carries no Body: a body is a query per card, and a listing
	// is read to pick a card out rather than to work from it.
	CardsForBoard(ctx context.Context, boardID string) ([]CardMoved, error)
}

// BoardCardState keeps where a card stands on its route on the card itself, so
// it travels with the board. Separate from BoardWriter because it never
// notifies and shows nothing to anybody.
//
// Optional: without it the position lives in this machine's store alone.
type BoardCardState interface {
	CardFlow(ctx context.Context, cardID string) (FlowState, bool, error)
	SetCardFlow(ctx context.Context, cardID string, st FlowState) error
	ClearCardFlow(ctx context.Context, cardID string) error
	// BoardCardFlows refills this machine's index for a board it has not seen.
	BoardCardFlows(ctx context.Context, boardID string) ([]FlowState, error)
}

// AgentUser is a registry entry seen as a board account. Username is derived
// from Name (AgentUsername); UserID and Created are filled in by BoardUsers.
type AgentUser struct {
	Name     string `json:"name"`
	Username string `json:"username"`
	UserID   string `json:"userId,omitempty"`
	Created  bool   `json:"created,omitempty"`
}

// BoardUsers keeps board accounts in step with the agent registry, so an agent
// can be picked in a person property like any other member. Assigning one is
// how a card names its agent, so a board without this cannot name one at all.
type BoardUsers interface {
	// EnsureAgentAccounts needs no board: an account is the machine's, made when
	// an agent is registered.
	EnsureAgentAccounts(ctx context.Context, agents []AgentUser) ([]AgentUser, error)
	EnsureAgentUsers(ctx context.Context, boardID string, agents []AgentUser) ([]AgentUser, error)
	// RetireAgentUser drops board memberships and reports how many. The account
	// stays: cards may still name it.
	RetireAgentUser(ctx context.Context, agent AgentUser) (int, error)
	AssignCardAgent(ctx context.Context, cardID string, agent AgentUser) error
}

// UIEmitter pushes events to the desktop UI. Must be safe to call before the UI
// is ready (drop and log).
type UIEmitter interface {
	Emit(event string, payload any)
}

// SessionStatus is the lifecycle state of an agent session.
type SessionStatus string

const (
	StatusQueued  SessionStatus = "queued"
	StatusRunning SessionStatus = "running"
	// Idle and WaitingPermission are never reached now; rows written before
	// still say so, and a status read back has to mean something.
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

// UI event names emitted through UIEmitter. What a session *says* is not among
// them: that is the card's comments and the terminal it runs in.
const (
	EventSession  = "acp:session"
	EventTerminal = "acp:terminal"
	// EventAttention says an agent stopped and is waiting for a person.
	EventAttention = "acp:attention"
)
