package main

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/artipop/xciii/internal/acp"
	"github.com/artipop/xciii/internal/boardmcp"
)

// The board tools an agent calls, served by the app itself on the front door
// (internal/boardmcp says why there is no subprocess in between).
//
// They are here rather than on the board's own API because what they offer is
// ours, not Focalboard's: a column that means something, a project by name, a
// card placed where the automation will pick it up. Through the board API an
// agent would have had to learn property ids to do the same thing.
//
// Nothing here trusts the caller for anything but its token. The token is one
// agent run's grant (acp/boardtools.go), and the board it names is the only
// board these calls can touch.

// boardToolRoutes serves the tools. Like the terminal sockets, it is built
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

// open resolves a request to the board its caller holds a grant for. It is the
// whole of the authentication: no grant, no board, no tools.
func (b *boardToolRoutes) open(r *http.Request) (boardmcp.Board, error) {
	mgr := b.manager()
	if mgr == nil {
		return nil, fmt.Errorf("агенты выключены")
	}
	token := bearer(r)
	if err := mgr.CheckBoardTools(token); err != nil {
		return nil, err
	}
	return &grantedBoard{mgr: mgr, token: token}, nil
}

// Handler is the /acp/board/ subtree.
func (b *boardToolRoutes) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.Handle(boardmcp.Path, boardmcp.NewHandler(b.open))
	return mux
}

// grantedBoard is the manager seen through one grant: every call is already
// bound to the board the token names, so nothing below takes a board id.
type grantedBoard struct {
	mgr   *acp.Manager
	token string
}

var _ boardmcp.Board = (*grantedBoard)(nil)

func (g *grantedBoard) Columns(_ context.Context) ([]boardmcp.Column, error) {
	columns, err := g.mgr.BoardToolColumns(g.token)
	if err != nil {
		return nil, err
	}
	out := make([]boardmcp.Column, 0, len(columns))
	for _, c := range columns {
		out = append(out, boardmcp.Column{Name: c.Name, Action: c.Action, Agents: c.Agents})
	}
	return out, nil
}

func (g *grantedBoard) Flows(_ context.Context) ([]boardmcp.Flow, error) {
	flows, err := g.mgr.BoardToolFlows(g.token)
	if err != nil {
		return nil, err
	}
	out := make([]boardmcp.Flow, 0, len(flows))
	for _, f := range flows {
		stages := make([]boardmcp.FlowStage, 0, len(f.Stages))
		for _, s := range f.Stages {
			stages = append(stages, boardmcp.FlowStage{
				Column:  s.Column,
				Action:  s.Action,
				Crew:    s.Crew,
				Waiting: s.Waiting,
			})
		}
		out = append(out, boardmcp.Flow{Name: f.Name, Stages: stages})
	}
	return out, nil
}

func (g *grantedBoard) Cards(ctx context.Context, column string) ([]boardmcp.CardInfo, error) {
	cards, err := g.mgr.BoardToolCards(ctx, g.token, column)
	if err != nil {
		return nil, err
	}
	out := make([]boardmcp.CardInfo, 0, len(cards))
	for _, c := range cards {
		out = append(out, cardInfo(c))
	}
	return out, nil
}

func (g *grantedBoard) Card(ctx context.Context, cardID string) (boardmcp.CardInfo, error) {
	card, err := g.mgr.BoardToolCardByID(ctx, g.token, cardID)
	if err != nil {
		return boardmcp.CardInfo{}, err
	}
	return cardInfo(card), nil
}

func (g *grantedBoard) UpdateCard(ctx context.Context, change boardmcp.CardChange) error {
	return g.mgr.UpdateCardFromTools(ctx, g.token, change.CardID, acp.CardEdit{
		Title:   change.Title,
		Column:  change.Column,
		Options: change.Options,
	})
}

func (g *grantedBoard) Comment(ctx context.Context, cardID, text string) error {
	return g.mgr.CommentFromTools(ctx, g.token, cardID, text)
}

// Describe is about the conversation rather than the board, and the grant is
// what knows which conversation that is.
func (g *grantedBoard) Describe(_ context.Context, text string) error {
	return g.mgr.DescribeTerminalFromTools(g.token, text)
}

func cardInfo(c acp.BoardToolCard) boardmcp.CardInfo {
	return boardmcp.CardInfo{
		ID:      c.ID,
		Title:   c.Title,
		Column:  c.Column,
		Options: c.Options,
		Body:    c.Body,
		Mine:    c.Mine,
		Flow:    c.Flow,
		Stage:   c.Stage,
		Waiting: c.Waiting,
		Running: c.Running,
		Queued:  c.Queued,
	}
}

func (g *grantedBoard) CreateCards(ctx context.Context, cards []boardmcp.Card) ([]boardmcp.CardResult, error) {
	results := make([]boardmcp.CardResult, 0, len(cards))
	for _, card := range cards {
		id, err := g.mgr.CreateCardFromTools(ctx, g.token, acp.NewCard{
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
	return results, nil
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
