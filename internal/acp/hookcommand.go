package acp

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// Registering the hook: what to run, and how each CLI spells "run this when you
// need a person". The asking itself is toolhook.go.

// hookTimeoutSeconds is how long the CLI is asked to wait for the hook. It is
// the vendor's own field, and it is set generously on purpose: the hook is
// holding a question a person has to read. It is longer than hookHold, so the
// hook always answers first and the CLI never has to decide what a killed hook
// meant.
const hookTimeoutSeconds = 90

// HookArg is the subcommand this binary answers a hook on (hook.go), and
// HookPath is where it posts. Exported so the root package and this one cannot
// spell either of them differently.
const (
	HookArg  = "hook"
	HookPath = "/acp/hook"
)

// hookCommand is the shell command line a CLI runs when it wants a person: this
// binary, re-invoked, told where to ask and with what right to.
//
// This binary rather than a script, for the reason maybeRunMCP exists — a
// helper on disk is a second artifact to install, to find on PATH and to keep in
// step with the app that reads its output. The grant is the same token the board
// tools take: it names the board, the card and the terminal, so a hook cannot
// ask about anything but the run it belongs to, and it stops working when the
// run ends.
func hookCommand(origin, token string) string {
	exe, err := os.Executable()
	if err != nil || exe == "" || origin == "" || token == "" {
		return ""
	}
	return strings.Join([]string{shellQuote(exe), HookArg, shellQuote(origin), shellQuote(token)}, " ")
}

// shellQuote makes one argument survive a shell. A packaged app lives at
// /Applications/XCIII.app/Contents/MacOS/XCIII, and a user who renamed it has
// put a space in that path.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// claudeHookArgs registers the hook with Claude Code. The settings are handed
// over as a JSON string rather than a file, so nothing of ours is written into
// the folder the agent works in.
func claudeHookArgs(hookCmd string) []string {
	if hookCmd == "" {
		return nil
	}
	settings := map[string]any{"hooks": map[string]any{
		"PermissionRequest": []any{map[string]any{
			"hooks": []any{map[string]any{
				"type":    "command",
				"command": hookCmd,
				"timeout": hookTimeoutSeconds,
			}},
		}},
	}}
	encoded, err := json.Marshal(settings)
	if err != nil {
		return nil
	}
	return []string{"--settings", string(encoded)}
}

// ClaudeHookInput is the payload Claude Code writes to the hook's stdin. Only
// the fields the card needs are read; the rest — session ids, transcript paths,
// the permission mode — is the CLI's own bookkeeping.
type ClaudeHookInput struct {
	HookEventName string          `json:"hook_event_name"`
	ToolName      string          `json:"tool_name"`
	ToolInput     json.RawMessage `json:"tool_input"`
	Cwd           string          `json:"cwd"`
}

// ClaudeHookOutput is the decision, in the shape Claude Code reads back. An
// empty decision is left out entirely: the schema treats a decision as a choice
// between allow and deny, and "nobody answered" is not one of them — it is the
// absence of the field, which leaves the CLI's own prompt to be answered on its
// own screen.
func ClaudeHookOutput(d ToolDecision) ([]byte, error) {
	specific := map[string]any{"hookEventName": "PermissionRequest"}
	if d.Behavior != "" {
		decision := map[string]any{"behavior": d.Behavior}
		if d.Message != "" {
			decision["message"] = d.Message
		}
		specific["decision"] = decision
	}
	return json.Marshal(map[string]any{"hookSpecificOutput": specific})
}

// ParseClaudeHook reads what arrived on stdin into the question this package
// asks. An event that is not the one we registered for is refused rather than
// guessed at.
func ParseClaudeHook(raw []byte) (ToolAsk, error) {
	var in ClaudeHookInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ToolAsk{}, fmt.Errorf("не разобрать запрос хука: %w", err)
	}
	if in.HookEventName != "" && in.HookEventName != "PermissionRequest" {
		return ToolAsk{}, fmt.Errorf("хук вызван на событии %q, а не PermissionRequest", in.HookEventName)
	}
	return ToolAsk{Tool: in.ToolName, Input: in.ToolInput, Cwd: in.Cwd}, nil
}
