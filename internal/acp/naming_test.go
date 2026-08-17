package acp

import (
	"strings"
	"testing"
	"time"
)

// The prompt asks for one line, and an agent that ignores that usually puts
// the name last. Whatever cannot be a name falls through to the title — a
// branch name is never worth failing a card over.
func TestBranchNameFromAnswer(t *testing.T) {
	cases := map[string]string{
		"fix-sso-login":   "fix-sso-login",
		"`fix-sso-login`": "fix-sso-login",
		"Вот название:\n\nfix-sso-login\n": "fix-sso-login",
		"": "",
		"Я думаю, что эта задача прежде всего о том, как устроен вход, поэтому назвал бы её длинно и подробно, вот так вот": "",
	}
	for in, want := range cases {
		if got := branchNameFromAnswer(in); got != want {
			t.Errorf("branchNameFromAnswer(%q) = %q, want %q", in, got, want)
		}
	}
}

// With the setting on, the branch is what the agent said — the fake agent's
// final message slugged — and the owner's tail stays, because two cards must
// not collide however alike their answers.
func TestAgentNamesTheBranchWhenAsked(t *testing.T) {
	m, _, events, _ := testManager(t, fakeClaudeHappy, func(c *Config) {
		c.AgentNamedBranches = true
	})

	events.ch <- moveEvent("cardN", "opt-backlog", "opt-agent")
	waitFor(t, 20*time.Second, "agent-named session done", func() bool {
		sessions, _, err := m.store.SessionsForCard("cardN")
		return err == nil && len(sessions) == 1 && sessions[0].Status == StatusDone
	})

	sessions, _, _ := m.store.SessionsForCard("cardN")
	branch := sessions[0].Branch
	if !strings.HasPrefix(branch, "fake-work-done-") {
		t.Errorf("branch %q, want it named by the agent's answer", branch)
	}
}
