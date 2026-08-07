// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"

	"github.com/artipop/xciii/internal/acp"
	"github.com/artipop/xciii/internal/boardmcp"
)

// This is the app's end of the board tools: `xciii mcp board` is spawned by an
// agent, and it reaches back here over the front door (internal/boardmcp says
// why it has to be a separate process at all).
//
// It is on the front door rather than on the board's own API because what it
// offers is ours, not Focalboard's: a column that means something, a project by
// name, a card placed where the automation will pick it up. The board API would
// have made the agent learn property ids to do the same thing.
//
// Nothing here trusts the caller for anything but its token. The token is one
// agent run's grant (acp/boardtools.go), and the board it names is the only
// board these calls can touch.

// boardToolRoutes serves the tool calls. Like the terminal sockets, it is built
// before the manager exists and is given it afterwards.
type boardToolRoutes struct {
	mu  sync.RWMutex
	mgr *acp.Manager
}

func newBoardToolRoutes() *boardToolRoutes { return &boardToolRoutes{} }

// SetManager hands over the manager once the ACP integration is up.
func (b *boardToolRoutes) SetManager(m *acp.Manager) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.mgr = m
}

func (b *boardToolRoutes) manager() *acp.Manager {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.mgr
}

// bearer is the grant the call carries, and the whole of its identity.
func bearer(r *http.Request) string {
	const prefix = "Bearer "
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, prefix) {
		return ""
	}
	return strings.TrimSpace(auth[len(prefix):])
}

// Columns answers GET /acp/board/columns.
func (b *boardToolRoutes) Columns(w http.ResponseWriter, r *http.Request) {
	mgr := b.manager()
	if mgr == nil {
		http.Error(w, "агенты выключены", http.StatusServiceUnavailable)
		return
	}
	columns, err := mgr.BoardToolColumns(bearer(r))
	if err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	out := make([]boardmcp.Column, 0, len(columns))
	for _, c := range columns {
		out = append(out, boardmcp.Column{Name: c.Name, Action: c.Action, Agents: c.Agents})
	}
	writeJSON(w, out)
}

// CreateCards answers POST /acp/board/cards. Every card is attempted and every
// outcome is reported: a plan is a list, and one bad column in it must not cost
// the other four cards.
func (b *boardToolRoutes) CreateCards(w http.ResponseWriter, r *http.Request) {
	mgr := b.manager()
	if mgr == nil {
		http.Error(w, "агенты выключены", http.StatusServiceUnavailable)
		return
	}
	token := bearer(r)
	if err := mgr.CheckBoardTools(token); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}

	var body struct {
		Cards []boardmcp.Card `json:"cards"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		http.Error(w, "не удалось разобрать запрос: "+err.Error(), http.StatusBadRequest)
		return
	}
	if len(body.Cards) == 0 {
		http.Error(w, "не передано ни одной карточки", http.StatusBadRequest)
		return
	}

	results := make([]boardmcp.CardResult, 0, len(body.Cards))
	for _, card := range body.Cards {
		id, err := mgr.CreateCardFromTools(r.Context(), token, acp.NewCard{
			Title:   card.Title,
			Body:    card.Description,
			Column:  card.Column,
			Options: card.Options,
		})
		if err != nil {
			results = append(results, boardmcp.CardResult{Title: card.Title, Error: err.Error()})
			continue
		}
		results = append(results, boardmcp.CardResult{ID: id, Title: card.Title})
	}
	writeJSON(w, results)
}

// Handler is the /acp/board/ subtree.
func (b *boardToolRoutes) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /acp/board/columns", b.Columns)
	mux.HandleFunc("POST /acp/board/cards", b.CreateCards)
	return mux
}

func writeJSON(w http.ResponseWriter, payload any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}
