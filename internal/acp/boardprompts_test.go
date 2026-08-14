package acp

import (
	"strings"
	"testing"
)

// A board's crew can be told different things: what the board says to
// everybody, and what it says to one agent. Both reach the agent, and the one
// about this agent on this board comes last — it answers the smallest question,
// so it must be the one still in front of the model.
func TestWhatABoardTellsOneAgentComesAfterWhatItTellsThemAll(t *testing.T) {
	brief := BoardBrief{
		Board:  "Отвечай по-русски.",
		Agents: map[string]string{"клаус": "Пиши тесты к каждому изменению.", "кодекс": "Только ревью, код не правь."},
	}
	agent := AgentEntry{Name: "клаус", Prompt: "Ты работаешь в проекте Shop."}

	lead := brief.lead(agent)
	for _, want := range []string{"Отвечай по-русски.", "Ты работаешь в проекте Shop.", "Пиши тесты к каждому изменению."} {
		if !strings.Contains(lead, want) {
			t.Fatalf("the agent was not told %q:\n%s", want, lead)
		}
	}
	if strings.Index(lead, "Ты работаешь") > strings.Index(lead, "Пиши тесты") {
		t.Errorf("the board's words for this agent came before the agent's own:\n%s", lead)
	}

	// What the board keeps for the other agent is the other agent's business.
	if strings.Contains(lead, "Только ревью") {
		t.Errorf("one agent was told what the board says to another:\n%s", lead)
	}

	// An agent the board says nothing about still gets the board's own words.
	plain := brief.lead(AgentEntry{Name: "джуни"})
	if !strings.Contains(plain, "Отвечай по-русски.") || strings.Contains(plain, "Пиши тесты") {
		t.Errorf("an unbriefed agent got:\n%s", plain)
	}
}

// Blank is the same as unsaid, in both halves: a board whose text was cleared
// keeps no key, so nothing about it survives to be handed back.
func TestABlankBriefKeepsNothing(t *testing.T) {
	brief := BoardBrief{Board: "   ", Agents: map[string]string{"клаус": "  ", "": "нечей"}}.trimmed()
	if !brief.empty() {
		t.Fatalf("blanks were kept: %+v", brief)
	}
	if lead := brief.lead(AgentEntry{Name: "клаус"}); lead != "" {
		t.Errorf("an empty brief said %q", lead)
	}
}
