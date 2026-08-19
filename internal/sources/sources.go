// Package sources turns outside events into cards: mail, issues, a
// notification from a phone. It reaches the board only through BoardWriter.
//
// Deliberately not part of internal/acp: a source has to work with the agent
// integration switched off. The design is docs/sources.md.
package sources

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"
)

// Item is one thing a source brought, normalized before anything decides what
// to do with it — which is what keeps a polled source and a pushed one on one
// path.
type Item struct {
	// ExternalID and Version identify the object and its state in the source's
	// own namespace. A source reports what it sees rather than what changed, so
	// without the pair every poll creates the world again.
	ExternalID string    `json:"id"`
	Version    string    `json:"version,omitempty"`
	Title      string    `json:"title"`
	Body       string    `json:"body,omitempty"`
	URL        string    `json:"url,omitempty"`
	At         time.Time `json:"at,omitempty"`
	// BoardID overrides the source's own board, and is refused unless the entry
	// allows it (SourceEntry.PickBoard) — a plugin must not choose where it
	// writes. It is for the share sheet, where the board is the question asked.
	BoardID string            `json:"boardId,omitempty"`
	Props   map[string]string `json:"props,omitempty"`
	Labels  []string          `json:"labels,omitempty"`
	Raw     json.RawMessage   `json:"raw,omitempty"` // as it arrived, for the day a source changes shape
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
// identified: a rule is written by a person against the board in front of them,
// who cannot know the ids the board gave its properties.
type CardSpec struct {
	Title string
	Icon  string
	Body  string
	// Source becomes the card's author, which is what the inbox groups by.
	Source string
	// URL is a field rather than a property because it is the pipeline's own
	// doing; which property holds it is the board's business.
	URL        string
	Properties map[string]string
	Item       ItemRef
}

// ItemRef is a card's origin, on the card itself (fields.xciiiSource): what
// stops the same letter becoming a second card.
//
// On the card and not only in source_item, because that table is keyed by card
// id and a board carried to another machine arrives with new ids — the table
// would say nothing about the cards actually there. Source is not a field: it
// is the card's author on the board, and the lookup is always for one source.
type ItemRef struct {
	ExternalID string `json:"externalId,omitempty"`
	Version    string `json:"version,omitempty"`
}

// BoardItems is the board asked what a source has already brought it. Optional:
// without it this machine's own table is the only record, which is right for a
// board that has never left this machine and wrong the moment one arrives.
type BoardItems interface {
	// CardBySourceItem finds the card a source's item became. Not found is not
	// an error: most items have never been seen.
	CardBySourceItem(ctx context.Context, boardID, source, externalID string) (cardID, version string, ok bool, err error)
}

// BoardWriter is everything this package does to a board, and it is narrow on
// purpose: a source describes what it found, and the cards are this side's
// business (docs/sources.md, §8).
type BoardWriter interface {
	CreateCard(ctx context.Context, boardID string, spec CardSpec) (string, error)
	AddComment(ctx context.Context, cardID, text string) error
	MoveCardByOptionName(ctx context.Context, cardID, propertyName, optionName string) error

	// ColumnProperty is asked rather than assumed: ours say «Статус», upstream
	// boards say "Status", and a constant is wrong for one of them.
	ColumnProperty(ctx context.Context, boardID string) (string, error)
	// EnsureInbox makes the inbox column and its view exist, for a board that
	// predates them — a template only ever reaches a board that does not exist.
	EnsureInbox(ctx context.Context, boardID, propertyName, optionName string) (string, error)
}
