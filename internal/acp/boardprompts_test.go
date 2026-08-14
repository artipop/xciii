package acp

import (
	"strings"
	"testing"
)

// Two prompts reach an agent and no more: the board's, which every agent
// working here is told, and the agent's own, which it carries onto every board.
// The order is the one the dialog and the guide print, so what a person reads
// is what the agent gets.
func TestAnAgentIsToldTheBoardsWordsThenItsOwn(t *testing.T) {
	lead := promptLead("Отвечай по-русски.", AgentEntry{Name: "клаус", Prompt: "Ты работаешь в проекте Shop."})

	if !strings.Contains(lead, "Отвечай по-русски.") || !strings.Contains(lead, "Ты работаешь в проекте Shop.") {
		t.Fatalf("something was left out:\n%s", lead)
	}
	if strings.Index(lead, "Отвечай") > strings.Index(lead, "Ты работаешь") {
		t.Errorf("the agent's own prompt came before the board's:\n%s", lead)
	}
}

// Blank is the same as unsaid: a board that says nothing adds nothing, and the
// task text starts where it would have started anyway.
func TestNothingSaidAddsNothing(t *testing.T) {
	if lead := promptLead("   ", AgentEntry{Name: "клаус"}); lead != "" {
		t.Errorf("an empty board and a bare agent led with %q", lead)
	}
}
