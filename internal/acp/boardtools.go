// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package acp

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/artipop/xciii/internal/boardmcp"
)

// The board tools are how an agent says something back to this application
// instead of only to the person watching it: an MCP server of ours (internal/
// boardmcp), spawned by the agent, that reaches the front door over loopback.
//
// It is a separate process — that is what MCP is — so it cannot be trusted with
// the board id: it is handed a grant token instead, and the token is what names
// the board. An agent planning against one board therefore cannot leave cards on
// another, and when the run that was granted the token ends, the token stops
// working. This is the same bargain the dokku server takes: the model chooses
// steps, never targets.

// BoardGrant is one agent run's permission to write to one board.
type BoardGrant struct {
	BoardID string
	// Property is the board's column property, so a card asked for by column
	// name lands where the automation is watching. It comes from the config
	// rather than from the agent, which knows column names and nothing else.
	Property string
}

// GrantBoardTools opens a grant for one agent run and returns the token that
// carries it. The caller revokes it when the run ends; a grant that outlives
// its run is a door left open.
func (m *Manager) GrantBoardTools(boardID string) string {
	if boardID == "" {
		return ""
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		// Without a token there is no door, which is the safe way to fail.
		m.log.Warn("acp: cannot mint a board tools token", "err", err)
		return ""
	}
	token := hex.EncodeToString(buf)

	m.cfgMu.RLock()
	property := m.cfg.TriggerProperty
	m.cfgMu.RUnlock()

	m.grantsMu.Lock()
	defer m.grantsMu.Unlock()
	if m.grants == nil {
		m.grants = map[string]BoardGrant{}
	}
	m.grants[token] = BoardGrant{BoardID: boardID, Property: property}
	return token
}

// RevokeBoardTools closes a grant.
func (m *Manager) RevokeBoardTools(token string) {
	if token == "" {
		return
	}
	m.grantsMu.Lock()
	defer m.grantsMu.Unlock()
	delete(m.grants, token)
}

// boardGrant resolves a token, which is the only way into everything below.
func (m *Manager) boardGrant(token string) (BoardGrant, bool) {
	m.grantsMu.RLock()
	defer m.grantsMu.RUnlock()
	g, ok := m.grants[token]
	return g, ok
}

// SetOrigin records the address the front door answers on, which is what an
// MCP server of ours is pointed at. Set once the front door is listening.
func (m *Manager) SetOrigin(url string) {
	m.grantsMu.Lock()
	defer m.grantsMu.Unlock()
	m.origin = url
}

func (m *Manager) originURL() string {
	m.grantsMu.RLock()
	defer m.grantsMu.RUnlock()
	return m.origin
}

// boardToolsSpec is the MCP server as an agent is handed it: our own binary,
// re-invoked, pointed at the front door with a grant in its environment.
func (m *Manager) boardToolsSpec(token string) (mcpServerSpec, error) {
	self, err := os.Executable()
	if err != nil {
		return mcpServerSpec{}, fmt.Errorf("не удалось определить путь к приложению для MCP-сервера: %w", err)
	}
	origin := m.originURL()
	if origin == "" {
		return mcpServerSpec{}, fmt.Errorf("адрес приложения ещё не известен")
	}
	return mcpServerSpec{
		Name:    boardmcp.ServerName,
		Command: self,
		Args:    []string{"mcp", boardmcp.ServerName},
		Env: map[string]string{
			boardmcp.EnvOrigin: origin,
			boardmcp.EnvToken:  token,
		},
	}, nil
}

// openBoardTools mints a grant for a board and writes the MCP config file the
// vendor CLI of a terminal takes. It returns the token and the file, both of
// which the caller must close when the run ends: the file holds the token, and
// the token is a door into the board.
//
// A board nobody named, an agent whose CLI cannot be told about MCP at all, or
// an app that does not know its own address yet — each of those simply means no
// tools, never a terminal that refuses to open.
func (m *Manager) openBoardTools(boardID string, agent AgentEntry) (token, configPath string) {
	if boardID == "" || !terminalTakesMCP(agent) {
		return "", ""
	}
	token = m.GrantBoardTools(boardID)
	if token == "" {
		return "", ""
	}
	spec, err := m.boardToolsSpec(token)
	if err != nil {
		m.log.Warn("acp: no board tools for this terminal", "err", err)
		m.RevokeBoardTools(token)
		return "", ""
	}
	// 0600 by default, and it carries the grant, so it stays that way.
	f, err := os.CreateTemp("", "xciii-mcp-*.json")
	if err != nil {
		m.log.Warn("acp: cannot write the MCP config for a terminal", "err", err)
		m.RevokeBoardTools(token)
		return "", ""
	}
	defer f.Close()

	config := map[string]any{"mcpServers": map[string]any{spec.Name: map[string]any{
		"command": spec.Command,
		"args":    spec.Args,
		"env":     spec.Env,
	}}}
	if err := json.NewEncoder(f).Encode(config); err != nil {
		m.log.Warn("acp: cannot write the MCP config for a terminal", "err", err)
		m.RevokeBoardTools(token)
		_ = os.Remove(f.Name())
		return "", ""
	}
	return token, f.Name()
}

// closeBoardTools shuts the door again: the grant stops working and the file
// that carried it is gone.
func (m *Manager) closeBoardTools(token, configPath string) {
	m.RevokeBoardTools(token)
	if configPath != "" {
		_ = os.Remove(configPath)
	}
}

// CheckBoardTools reports whether a token still opens a door, which is what
// the HTTP end answers a call with before it reads a body.
func (m *Manager) CheckBoardTools(token string) error {
	if _, ok := m.boardGrant(token); !ok {
		return fmt.Errorf("нет доступа к доске")
	}
	return nil
}

// BoardToolColumn is one column as an agent is told about it: the name it must
// use and what putting a card there sets off.
type BoardToolColumn struct {
	Name   string   `json:"name"`
	Action string   `json:"action,omitempty"`
	Agents []string `json:"agents,omitempty"`
}

// BoardToolColumns answers "where can this card go, and what happens then".
// The columns come from the board's own configuration rather than from its
// schema: a column with no action is a place to park a card, and the agent
// needs to know which is which to put work where work starts.
func (m *Manager) BoardToolColumns(token string) ([]BoardToolColumn, error) {
	g, ok := m.boardGrant(token)
	if !ok {
		return nil, fmt.Errorf("нет доступа к доске")
	}
	specs := m.BoardColumns(g.BoardID)
	out := make([]BoardToolColumn, 0, len(specs))
	for _, s := range specs {
		out = append(out, BoardToolColumn{Name: s.Column, Action: s.Action, Agents: s.Agents})
	}
	return out, nil
}

// CreateCardFromTools is the write itself. Everything an agent may decide is a
// name a person would have typed; the board is the grant's.
func (m *Manager) CreateCardFromTools(ctx context.Context, token string, card NewCard) (string, error) {
	g, ok := m.boardGrant(token)
	if !ok {
		return "", fmt.Errorf("нет доступа к доске")
	}
	if strings.TrimSpace(card.Title) == "" {
		return "", fmt.Errorf("у карточки должен быть заголовок")
	}
	if m.writer == nil {
		return "", fmt.Errorf("доска недоступна")
	}
	card.BoardID = g.BoardID
	card.Property = g.Property

	id, err := m.writer.CreateCard(ctx, card)
	if err != nil {
		return "", err
	}
	m.log.Info("acp: card created by an agent", "card", id, "board", g.BoardID, "column", card.Column)
	return id, nil
}
