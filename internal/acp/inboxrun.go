package acp

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// Running an agent for a source, rather than for a card.
//
// Everything else here starts from a card that moved: a worktree, a branch,
// comments back to that card. A source has none of those. What it wants is one
// turn — "look in this service and file what you find" — with two MCP servers
// attached and nobody watching.
//
// It is deliberately not a Session in the visible sense: nothing is emitted to
// the board, nothing is recorded against a card, and no worktree is made. What
// it does reuse is the part that is genuinely hard — starting the agent,
// negotiating the protocol, and running a turn to the end.

// InboxRun is one turn asked for by internal/sources.
type InboxRun struct {
	// Agent names the registry entry to run.
	Agent string
	// Dir is where it runs. Nothing is written there; it is a working directory
	// because a process needs one.
	Dir string
	// Prompt is the whole of what the agent is told.
	Prompt string
	// Servers are the MCP servers to attach for this turn: ours, which is how
	// anything gets filed, and the service's own.
	Servers []InboxServer
}

// InboxServer is one stdio MCP server for the turn.
type InboxServer struct {
	Name    string
	Command string
	Args    []string
	Env     map[string]string
}

// RunInbox runs one turn and returns the agent's last message.
//
// Every tool of the servers named here is allowed without asking, by prefix:
// nobody is looking at this run, and an unanswered permission request is a
// refused one — the same reasoning a deploy session's tools are seeded with,
// and the reason those servers are the app's to choose and not the model's.
// The agent's *own* tools stay under its usual policy: this is not a licence to
// run anything, it is a licence to use the two servers it was handed.
func (m *Manager) RunInbox(ctx context.Context, run InboxRun) (string, error) {
	agentName := strings.TrimSpace(run.Agent)
	if agentName == "" {
		return "", fmt.Errorf("не сказано, каким агентом опрашивать")
	}
	agent, err := m.planningAgent(agentName)
	if err != nil {
		return "", err
	}
	net, err := m.resolveNetwork(agent)
	if err != nil {
		return "", err
	}
	dir := strings.TrimSpace(run.Dir)
	if dir == "" {
		return "", fmt.Errorf("не сказано, где запускать агента")
	}

	s := &Session{
		ID:    "inbox-" + uuid.New().String(),
		Agent: agent,
		Net:   net,
		// No card and no board: comments and events check for these and do
		// nothing, which is what a run nobody is watching should do.
		ProjectPath: dir,
		// Planning is "reads, does not write" — it is what keeps a worktree
		// from being made for a session that has no repository to make one in.
		Planning:   true,
		PromptText: run.Prompt,
		Policy:     agentPolicy(agent),
		status:     StatusQueued,
		allowTools: map[string]bool{},
	}
	s.Worktree.Path = dir
	for _, server := range run.Servers {
		s.extraMCP = append(s.extraMCP, mcpServerSpec{
			Name:    server.Name,
			Command: server.Command,
			Args:    append([]string(nil), server.Args...),
			Env:     server.Env,
		})
		s.allowToolPrefix("mcp__" + server.Name + "__")
	}

	conn, sessionID, cleanup, err := m.openConnection(ctx, s)
	if err != nil {
		return "", err
	}
	defer cleanup()

	return m.runTurn(s, conn, sessionID, s.PromptText)
}
