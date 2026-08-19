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
// A hook is the CLI's own way out of that: a command it runs when it needs a
// person, handed the tool call on stdin and read for a decision on stdout. The
// command is this binary re-invoked (hook.go), and what it does is put the
// question on the card and hold. Measured on Claude Code 2.1.233 —
// docs/attention-hooks.md.
//
// Two things it deliberately does not do.
//
// It does not take the question away from the terminal: the CLI draws its own
// box at the same time, so the card is a second place to answer rather than a
// replacement — which is what makes a question of ours on screen legitimate,
// and why no answer leaves a standing box rather than a stuck agent.
//
// And it decides nothing itself. A hook that answered on its own would be a
// permission policy in a second place; autoAllowTools is where that lives.

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

// hookAskSettle is how long the CLI is given to paint the box it is asking in
// before its own output starts to mean something. The hook holds while that box
// is drawn (docs/attention-hooks.md), so without this the paint itself would
// read as the person having already answered.
const hookAskSettle = 2 * time.Second

// hookWatchEvery is how often the terminal is asked whether it has drawn since.
// Short, because the whole value of this is that the card stops lying quickly.
const hookWatchEvery = 300 * time.Millisecond

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
	term := m.Terminal(g.TerminalID)
	if term != nil {
		q.Agent = term.AgentName
		q.CardTitle = term.Title
	}

	// Held for a bounded time rather than for ever: see hookHold.
	ctx, cancel := context.WithTimeout(ctx, hookHold)
	defer cancel()

	// …and let go of sooner than that when the answer happened on the CLI's own
	// screen.
	ctx, stopWatching := m.withdrawWhenAnsweredOnScreen(ctx, term)
	defer stopWatching()

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

// withdrawWhenAnsweredOnScreen ends the wait as soon as the CLI draws again,
// which is what answering its own box makes it do.
//
// "Whoever is first wins" is true of the agent and false of everything a person
// looks at: answering on screen tells this side nothing, so the card and every
// notification go on announcing a decision the agent already has, for the rest
// of hookHold.
//
// The terminal does know. A permission box is a still frame — the premise
// AttentionTerminal rests on — so output after the box has settled is the person
// having pressed something. workedAt rather than lastOutput, because opening the
// window resizes the CLI and a TUI repaints when resized: being looked at must
// not read as being answered (resizeEcho).
//
// Safe in the direction it can be wrong: withdrawing leaves the CLI's own box
// standing, and a hook that answers nothing is already the ordinary outcome.
func (m *Manager) withdrawWhenAnsweredOnScreen(ctx context.Context, t *TerminalSession) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(ctx)
	if t == nil {
		// A deploy or a test has no terminal to watch, and neither has a hook
		// whose terminal has already gone.
		return ctx, cancel
	}
	settle := m.hookSettle
	if settle <= 0 {
		settle = hookAskSettle
	}
	go func() {
		timer := time.NewTimer(settle)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		drawn := t.workedAt()
		tick := time.NewTicker(hookWatchEvery)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.Done():
				// The CLI is gone; nothing is waiting for this answer either.
				cancel()
				return
			case <-tick.C:
				if t.workedAt().After(drawn) {
					cancel()
					return
				}
			}
		}
	}()
	return ctx, cancel
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
