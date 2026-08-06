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
	"encoding/json"
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
	ExternalID string            `json:"id"`
	Version    string            `json:"version,omitempty"`
	Title      string            `json:"title"`
	Body       string            `json:"body,omitempty"`
	URL        string            `json:"url,omitempty"`
	At         time.Time         `json:"at,omitempty"`
	Props      map[string]string `json:"props,omitempty"`
	Labels     []string          `json:"labels,omitempty"`
	// Raw is the payload as it arrived. It is kept because the day a source
	// changes shape, the only way to find out what it now sends is to look at
	// what it sent.
	Raw json.RawMessage `json:"raw,omitempty"`
}

// CardSpec is a card the pipeline asks for. Properties are named rather than
// identified: a source knows it wants «Ссылка» filled in and cannot know the id
// the board gave it.
type CardSpec struct {
	Title      string
	Icon       string
	Body       string
	Properties map[string]string
}

// BoardWriter is everything this package does to a board. It is narrow on
// purpose: a source describes what it found, and creating and moving cards is
// this side's business — see docs/sources.md, §8.
type BoardWriter interface {
	CreateCard(ctx context.Context, boardID string, spec CardSpec) (string, error)
	AddComment(ctx context.Context, cardID, text string) error
	MoveCardByOptionName(ctx context.Context, cardID, propertyName, optionName string) error
}
