package acp

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

// The way a CLI in a pty asks for permission without a protocol.
//
// An agent stage is the vendor's own CLI in a terminal (stageterminal.go), so
// there is no JSON-RPC to carry session/request_permission and never was: the
// CLI draws its box on the screen and waits for a keypress. From outside, that
// is indistinguishable from a model thinking — which is the whole reason
// AttentionTerminal measures silence and waits terminalQuietFor before saying
// anything.
//
// A hook is the CLI's own way out of that. It is a command the CLI runs when it
// needs a person, handing it the tool call on stdin and reading a decision back
// off stdout; the command is this binary re-invoked (hook.go), and what it does
// is put the question on the card and hold. Measured on Claude Code 2.1.233:
// the payload carries the tool and its arguments, the hook may hold while
// somebody thinks, and the decision it returns is honoured — see
// docs/attention-hooks.md for the whole measurement.
//
// Two things this deliberately does not do.
//
// It does not take the question away from the terminal. The CLI draws its own
// box at the same time (a Notification with notification_type
// "permission_prompt" arrives while the hook is still holding), so the person
// looking at the terminal answers there and the person looking at the board
// answers here, and whoever is first wins. That is what makes putting a
// question of ours on screen legitimate at all: nothing of ours is drawn over
// the CLI's screen, and nothing is hidden from it — the card is a second place
// to answer, not a replacement. It is also why no answer is a safe outcome
// rather than a stuck agent: the box is still there.
//
// And it does not decide anything itself. A hook that answers on its own would
// be a permission policy in a second place — autoAllowTools is where that
// lives, on the session side, and duplicating it here would mean two rules for
// one question.

// ToolAsk is the hook's question: what the CLI is about to do, in the words its
// vendor used. Only the fields both this and the CLI agree on are here — the
// rest of the payload (session ids, transcript paths, the mode) is the CLI's own
// bookkeeping and nothing on the card would be better for having it.
type ToolAsk struct {
	Tool string `json:"tool"`
	// Input is the tool call's arguments, whatever shape they came in. Kept as
	// raw JSON because it is the vendor's schema and not ours: what it is for is
	// being read by a person (askSummary), never branched on.
	Input json.RawMessage `json:"input,omitempty"`
	Cwd   string          `json:"cwd,omitempty"`
}

// ToolDecision is the answer, in the shape hook.go turns back into whatever the
// CLI expects. Empty Behavior means nobody answered, which is the outcome that
// leaves the question to the CLI's own box.
type ToolDecision struct {
	Behavior string `json:"behavior,omitempty"` // "allow" | "deny" | ""
	Message  string `json:"message,omitempty"`
}

// Decisions a person can give. Anything else is nobody having answered.
const (
	toolAllow = "allow"
	toolDeny  = "deny"
)

// hookHold is how long the question stands before the hook is told nobody
// answered. It is not a guess about how long a person takes — it is how long the
// *CLI* is willing to wait, and a hook still running when the CLI has stopped
// listening holds a question about a decision already made on screen. Well
// inside any vendor's own hook timeout, so the CLI hears an answer rather than
// killing us for one.
const hookHold = 55 * time.Second

// AskToolPermission puts a CLI's permission request on the card and waits for
// somebody to answer it. The token is the run's own grant, the same one the
// board tools take: it names the board, the card and the terminal, so nothing
// about which card is being asked about comes from the caller.
func (m *Manager) AskToolPermission(ctx context.Context, token string, ask ToolAsk) (ToolDecision, error) {
	g, ok := m.boardGrant(token)
	if !ok {
		return ToolDecision{}, fmt.Errorf("нет доступа к доске")
	}
	tool := strings.TrimSpace(ask.Tool)
	if tool == "" {
		return ToolDecision{}, fmt.Errorf("не сказано, какой инструмент")
	}

	q := Question{
		ID:      uuid.NewString(),
		Kind:    QuestionPermission,
		Tool:    tool,
		Text:    askSummary(tool, ask.Input),
		CardID:  g.CardID,
		BoardID: g.BoardID,
		Options: []QuestionOption{
			{ID: toolAllow, Label: "Разрешить", Kind: "allow_once"},
			{ID: toolDeny, Label: "Запретить", Kind: "reject_once"},
		},
		AskedAt: time.Now(),
	}
	// The card's title and the agent's name are what the notification reads as,
	// and the terminal is the one thing here that knows both.
	if t := m.Terminal(g.TerminalID); t != nil {
		q.Agent = t.AgentName
		q.CardTitle = t.Title
	}

	// Held for a bounded time rather than for ever: see hookHold.
	ctx, cancel := context.WithTimeout(ctx, hookHold)
	defer cancel()

	m.log.Info("acp: the CLI is asking for permission", "terminal", g.TerminalID, "card", g.CardID, "tool", tool)
	answer := m.awaitAnswer(ctx, q)

	switch {
	case answer.OptionID == toolAllow:
		return ToolDecision{Behavior: toolAllow}, nil
	case answer.OptionID == toolDeny:
		return ToolDecision{Behavior: toolDeny, Message: answer.Text}, nil
	default:
		// Declined, timed out, or answered with words we have nowhere to put.
		// The CLI's own box is still on its screen, so saying nothing here is
		// leaving the question where it was rather than dropping it.
		return ToolDecision{}, nil
	}
}

// askSummary is the one line a person reads off the card. The arguments are the
// vendor's own schema, so this reads the two shapes every CLI agrees on — a
// command and a path — and otherwise says what it can without pretending to
// understand.
func askSummary(tool string, input json.RawMessage) string {
	fields := map[string]any{}
	if len(input) > 0 {
		_ = json.Unmarshal(input, &fields)
	}
	for _, key := range []string{"command", "file_path", "path", "url", "pattern"} {
		if v, ok := fields[key].(string); ok && strings.TrimSpace(v) != "" {
			return fmt.Sprintf("%s: %s", tool, ellipsis(v, 240))
		}
	}
	if len(fields) == 0 {
		return tool
	}
	// Nothing recognised: name the arguments rather than dump them, so the line
	// stays a line.
	keys := make([]string, 0, len(fields))
	for k := range fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return fmt.Sprintf("%s (%s)", tool, strings.Join(keys, ", "))
}

func ellipsis(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
