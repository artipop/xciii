package acp

import (
	"fmt"
	"strings"
)

// What a board tells the agents that work on it, and it is two answers because
// they are two questions.
//
//   - **The board's own** — every agent working here is told it. «Отвечай
//     по-русски», «это домашние дела, а не код».
//   - **The board's, for one agent** — what this board says to that agent
//     alone: «клаус здесь пишет тесты к каждому изменению», «кодекс только
//     ревьюит, код не правит». A crew of two doing different jobs on one board
//     had nowhere to be told so.
//
// A third one exists and is deliberately somewhere else: AgentEntry.Prompt is
// the agent's own, kept in the registry, and it holds on every board this
// machine has. The rule is the same one the whole settings surface is sorted
// by — a setting lives where its owner does — and it is why "what the agent is
// always like" and "what this board wants of it" cannot be one field.
type BoardBrief struct {
	Board string `json:"board,omitempty"`

	// Agents is keyed by the registry name, which is also the name a card is
	// assigned to. A board carried to another machine keeps the keys, and the
	// ones that machine has no agent for simply never match — the same bargain
	// a column's crew already takes.
	Agents map[string]string `json:"agents,omitempty"`
}

// lead is everything an agent is told before the task itself, widest first:
// what the board says to everybody, what the agent carries onto every board,
// and what this board keeps for this agent alone. The narrowest is last on
// purpose — when two of them disagree, the one that answers the smallest
// question has to be the one still in front of the model.
func (b BoardBrief) lead(agent AgentEntry) string {
	var out []byte
	for _, part := range []string{b.Board, agent.Prompt, b.Agents[agent.Name]} {
		if p := strings.TrimSpace(part); p != "" {
			out = fmt.Appendf(out, "%s\n\n", p)
		}
	}
	return string(out)
}

// trimmed drops the blanks, so a board that was told nothing and a board whose
// text was cleared are the same board — the file has no key either way.
func (b BoardBrief) trimmed() BoardBrief {
	out := BoardBrief{Board: strings.TrimSpace(b.Board)}
	for name, text := range b.Agents {
		name = strings.TrimSpace(name)
		if name == "" || strings.TrimSpace(text) == "" {
			continue
		}
		if out.Agents == nil {
			out.Agents = map[string]string{}
		}
		out.Agents[name] = text
	}
	return out
}

func (b BoardBrief) empty() bool {
	return b.Board == "" && len(b.Agents) == 0
}

// BoardBriefOf is what a board says, as the engine reads it.
func (m *Manager) BoardBriefOf(boardID string) BoardBrief {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	return m.boardBriefLocked(boardID)
}

func (m *Manager) boardBriefLocked(boardID string) BoardBrief {
	brief := BoardBrief{Board: m.cfg.BoardPrompts[boardID]}
	for name, text := range m.cfg.BoardAgentPrompts[boardID] {
		if brief.Agents == nil {
			brief.Agents = map[string]string{}
		}
		brief.Agents[name] = text
	}
	return brief
}

// BoardPrompt is the board's own half, on its own — what a planning terminal
// and every session are told before anything else.
func (m *Manager) BoardPrompt(boardID string) string {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	return m.cfg.BoardPrompts[boardID]
}

// SetBoardBrief stores what a board says and persists it. Blank texts remove
// their keys rather than storing an empty string, so unsaying something leaves
// the board as it was before anybody said it.
//
// It is written through to the board itself, like the board's columns and
// routes: the instruction is about this board and has to travel with it.
func (m *Manager) SetBoardBrief(boardID string, brief BoardBrief) error {
	if strings.TrimSpace(boardID) == "" {
		return fmt.Errorf("не указана доска")
	}
	// Read the board before writing to it: the write below is the whole of
	// this board's automation, and this is the one edit that can be the first
	// thing that ever happens to a board.
	m.listenBeforeSpeaking(boardID)
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	m.putBriefLocked(boardID, brief.trimmed())
	return m.saveBoardsLocked(boardID)
}

func (m *Manager) putBriefLocked(boardID string, brief BoardBrief) {
	if brief.Board == "" {
		delete(m.cfg.BoardPrompts, boardID)
	} else {
		if m.cfg.BoardPrompts == nil {
			m.cfg.BoardPrompts = map[string]string{}
		}
		m.cfg.BoardPrompts[boardID] = brief.Board
	}
	if len(brief.Agents) == 0 {
		delete(m.cfg.BoardAgentPrompts, boardID)
		return
	}
	if m.cfg.BoardAgentPrompts == nil {
		m.cfg.BoardAgentPrompts = map[string]map[string]string{}
	}
	m.cfg.BoardAgentPrompts[boardID] = brief.Agents
}

// adoptBrief takes what the board itself says, unless this machine already has
// an answer for that board — the same rule as a column: what somebody edited
// here is theirs until they say otherwise. The two halves are adopted
// separately, because a board can perfectly well carry one and not the other.
func (m *Manager) adoptBrief(boardID string, brief BoardBrief) bool {
	brief = brief.trimmed()
	if brief.empty() {
		return false
	}
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	took := false
	if brief.Board != "" && strings.TrimSpace(m.cfg.BoardPrompts[boardID]) == "" {
		if m.cfg.BoardPrompts == nil {
			m.cfg.BoardPrompts = map[string]string{}
		}
		m.cfg.BoardPrompts[boardID] = brief.Board
		took = true
	}
	if len(brief.Agents) > 0 && len(m.cfg.BoardAgentPrompts[boardID]) == 0 {
		if m.cfg.BoardAgentPrompts == nil {
			m.cfg.BoardAgentPrompts = map[string]map[string]string{}
		}
		m.cfg.BoardAgentPrompts[boardID] = brief.Agents
		took = true
	}
	if !took {
		return false
	}
	if err := m.persistConfigLocked(); err != nil {
		m.log.Warn("acp: cannot persist the board's instructions", "board", boardID, "err", err)
	}
	return true
}

// briefFrom reads what a board says about itself. Unreadable is treated as
// absent rather than as an error: this is a string and a small map beside two
// lists, and a board whose brief is malformed still has columns worth taking.
func briefFrom(props map[string]any) BoardBrief {
	var brief BoardBrief
	if raw, ok := boardProp(props, BoardPropPrompt); ok {
		text, _ := raw.(string)
		brief.Board = strings.TrimSpace(text)
	}
	if raw, ok := boardProp(props, BoardPropAgentPrompts); ok {
		agents := map[string]string{}
		if err := reinterpret(raw, &agents); err == nil && len(agents) > 0 {
			brief.Agents = agents
		}
	}
	return brief.trimmed()
}
