package acp

import (
	"fmt"
	"strings"
)

// What an agent is told before the task itself, and there are two of them
// because there are two owners:
//
//   - **the board's** — every agent working here is told it. «Отвечай
//     по-русски», «это домашние дела, а не код». It is this file, it is
//     «Системный промпт доски…» in the board's ⋯ menu, and it lives on the
//     board so it travels with it.
//   - **the agent's own** — AgentEntry.Prompt, in the registry, edited in
//     «Настройки → Агенты». It holds on every board this machine has, because
//     it is about the agent rather than about any board.
//
// There is deliberately no third: a text per (board, agent) belongs to no single
// thing a person can point at — a cell of a table rather than a setting — and
// what a *folder* wants said is already in the folder's own AGENTS.md. Two
// prompts with one owner each fits in the sentence the dialog prints.

// promptLead is those two, in the order the agent gets them: the board's
// words, then the agent's own, then whatever the caller appends — the card's
// task, the deploy facts, the planning instructions. One helper because all
// four callers had the same two blocks written out by hand.
func promptLead(boardPrompt string, agent AgentEntry) string {
	var out []byte
	for _, part := range []string{boardPrompt, agent.Prompt} {
		if p := strings.TrimSpace(part); p != "" {
			out = fmt.Appendf(out, "%s\n\n", p)
		}
	}
	return string(out)
}

// BoardPrompt returns what every session of this board is told before the
// agent's own system prompt and the card task. Empty for a board that never
// said anything, which is most of them.
func (m *Manager) BoardPrompt(boardID string) string {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	return m.cfg.BoardPrompts[boardID]
}

// SetBoardPrompt stores that instruction for one board and persists. Empty text
// removes the key rather than storing a blank, so a board that has said nothing
// and a board that unsaid it are the same board.
//
// It is written through to the board itself, like the board's columns and
// routes: the instruction is about this board and has to travel with it.
func (m *Manager) SetBoardPrompt(boardID, text string) error {
	if strings.TrimSpace(boardID) == "" {
		return fmt.Errorf("не указана доска")
	}
	// Read the board before writing to it: the write below is the whole of
	// this board's automation, and this is the one edit that can be the first
	// thing that ever happens to a board.
	m.listenBeforeSpeaking(boardID)
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	if strings.TrimSpace(text) == "" {
		delete(m.cfg.BoardPrompts, boardID)
	} else {
		if m.cfg.BoardPrompts == nil {
			m.cfg.BoardPrompts = map[string]string{}
		}
		m.cfg.BoardPrompts[boardID] = text
	}
	return m.saveBoardsLocked(boardID)
}

// adoptPrompt takes the board's own instructions, unless this machine already
// has an answer for that board — the same rule as a column: what somebody
// edited here is theirs until they say otherwise.
func (m *Manager) adoptPrompt(boardID, text string) bool {
	text = strings.TrimSpace(text)
	if text == "" {
		return false
	}
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	if strings.TrimSpace(m.cfg.BoardPrompts[boardID]) != "" {
		return false
	}
	if m.cfg.BoardPrompts == nil {
		m.cfg.BoardPrompts = map[string]string{}
	}
	m.cfg.BoardPrompts[boardID] = text
	if err := m.persistConfigLocked(); err != nil {
		m.log.Warn("acp: cannot persist the board's instructions", "board", boardID, "err", err)
	}
	return true
}

// boardPromptFrom reads the board's own instructions. Unreadable is treated as
// absent rather than as an error: the prompt is a string beside two lists, and
// a board whose prompt is malformed still has columns worth taking.
func boardPromptFrom(props map[string]any) string {
	raw, ok := boardProp(props, BoardPropPrompt)
	if !ok {
		return ""
	}
	text, _ := raw.(string)
	return strings.TrimSpace(text)
}
