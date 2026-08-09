// Package sources turns outside events into cards: mail, issues, a
// notification from a phone. It is board-agnostic in the same way internal/acp
// is — it reaches the board only through the BoardWriter interface below, and
// internal/boardadapter is the only package that implements it.
//
// It is deliberately not part of internal/acp. Sources have to work with the
// agent integration switched off: cards from a phone on a board of household
// chores are useful to somebody who has no agent and never will.
//
// The design this implements is docs/sources.md.
package sources

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"
)

// Item is one thing a source brought: one letter, one notification, one issue.
// Everything entering the pipeline is normalized to this before anything
// decides what to do with it, which is what keeps a polled source and a pushed
// one on the same path.
type Item struct {
	// ExternalID identifies the object in the source's own namespace, and
	// Version identifies its state. A source reports what it can see rather
	// than what changed, so without the pair every poll would create the whole
	// world again.
	ExternalID string    `json:"id"`
	Version    string    `json:"version,omitempty"`
	Title      string    `json:"title"`
	Body       string    `json:"body,omitempty"`
	URL        string    `json:"url,omitempty"`
	At         time.Time `json:"at,omitempty"`
	// BoardID is where this one item goes, overriding the source's own board.
	// It is refused unless the entry allows it (SourceEntry.PickBoard), because
	// the registry deciding the board is what keeps a plugin from writing
	// wherever it likes. What it is for is the opposite case: a person who is
	// present at the moment the item is made and picks the board then — the
	// share sheet, where the board *is* the question being asked.
	BoardID string            `json:"boardId,omitempty"`
	Props   map[string]string `json:"props,omitempty"`
	Labels  []string          `json:"labels,omitempty"`
	// Raw is the payload as it arrived. It is kept because the day a source
	// changes shape, the only way to find out what it now sends is to look at
	// what it sent.
	Raw json.RawMessage `json:"raw,omitempty"`
}

// WithFallbackID gives the item an id when the sender had none to give: the
// hash of what it said. A phone that loses the answer to a request repeats it,
// and without a stable key the repeat would be a second card.
func (it Item) WithFallbackID() Item {
	if strings.TrimSpace(it.ExternalID) != "" {
		return it
	}
	sum := sha256.Sum256([]byte(it.Title + "\x00" + it.Body + "\x00" + it.At.UTC().Format(time.RFC3339)))
	it.ExternalID = "sha256:" + hex.EncodeToString(sum[:16])
	return it
}

// CardSpec is a card the pipeline asks for. Properties are named rather than
// identified: a source knows it wants «Ссылка» filled in and cannot know the id
// the board gave it.
type CardSpec struct {
	Title string
	Icon  string
	Body  string
	// Source is what brought the item, and it becomes the card's author: the
	// board's own answer to "who made this", which is also what it groups the
	// inbox by. Empty means a card nobody outside made.
	Source     string
	Properties map[string]string
}

// BoardWriter is everything this package does to a board. It is narrow on
// purpose: a source describes what it found, and creating and moving cards is
// this side's business — see docs/sources.md, §8.
type BoardWriter interface {
	CreateCard(ctx context.Context, boardID string, spec CardSpec) (string, error)
	AddComment(ctx context.Context, cardID, text string) error
	MoveCardByOptionName(ctx context.Context, cardID, propertyName, optionName string) error

	// ColumnProperty names the property whose options are the board's columns.
	// The pipeline asks rather than assumes: a board of ours says «Статус» and
	// an upstream one says "Status", and a constant would be wrong for one of
	// them.
	ColumnProperty(ctx context.Context, boardID string) (string, error)
	// EnsureInbox makes the board's inbox exist — the column things arrive in
	// and the view that shows only them — and returns the column's id. A board
	// made before the inbox shipped has neither, and templates only ever reach
	// boards that do not exist yet.
	EnsureInbox(ctx context.Context, boardID, propertyName, optionName string) (string, error)
}
