package acp

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	acpsdk "github.com/coder/acp-go-sdk"
)

// chunkFlushDelay batches streamed text before it reaches the UI: agents emit
// a token at a time, and one UI event per token would swamp the event bus.
const chunkFlushDelay = 60 * time.Millisecond

// sessionClient implements acpsdk.Client for one session: it receives the
// agent's stream, persists it, forwards it to the UI and answers permission
// requests according to policy.
type sessionClient struct {
	m *Manager
	s *Session

	chunkMu      sync.Mutex
	chunkBuf     strings.Builder
	chunkThought bool
	chunkTimer   *time.Timer

	// toolNames remembers what each tool call was called, because the agent
	// announces a call and asks permission for it in two separate messages, and
	// only the first one is required to carry a name.
	toolMu    sync.Mutex
	toolNames map[string]string // toolCallId → tool name
}

// emitChunk queues streamed text for the UI, flushing on a short timer or as
// soon as the kind of text changes (agent output vs. thinking).
func (c *sessionClient) emitChunk(text string, thought bool) {
	c.chunkMu.Lock()
	if c.chunkBuf.Len() > 0 && c.chunkThought != thought {
		c.flushLocked()
	}
	c.chunkThought = thought
	c.chunkBuf.WriteString(text)
	if c.chunkTimer == nil {
		c.chunkTimer = time.AfterFunc(chunkFlushDelay, c.flush)
	}
	c.chunkMu.Unlock()
}

func (c *sessionClient) flush() {
	c.chunkMu.Lock()
	c.flushLocked()
	c.chunkMu.Unlock()
}

// flushLocked emits whatever is buffered. Callers hold chunkMu.
func (c *sessionClient) flushLocked() {
	if c.chunkTimer != nil {
		c.chunkTimer.Stop()
		c.chunkTimer = nil
	}
	if c.chunkBuf.Len() == 0 {
		return
	}
	payload := map[string]any{
		"sessionId": c.s.ID, "cardId": c.s.CardID, "text": c.chunkBuf.String(),
	}
	if c.chunkThought {
		payload["thought"] = true
	}
	c.chunkBuf.Reset()
}

var _ acpsdk.Client = (*sessionClient)(nil)

// RequestPermission applies the auto-allow list and the session's accumulated
// "always allow" set, and asks the person about anything else. This is the
// protocol's own way of wanting a human, and answering it for them — which is
// what refusing it is — leaves an agent that cannot do its job and a card that
// does not say why.
//
// Blocking here is safe: the SDK dispatches every inbound request on its own
// goroutine, so the agent's session/update stream keeps flowing while the card
// waits, and the turn is still open when the answer arrives.
func (c *sessionClient) RequestPermission(ctx context.Context, params acpsdk.RequestPermissionRequest) (acpsdk.RequestPermissionResponse, error) {
	toolName := c.permissionToolName(params)
	title := ""
	if params.ToolCall.Title != nil {
		title = *params.ToolCall.Title
	}

	if c.s.autoAllowed(toolName, params.ToolCall.RawInput, c.m.cfg) || c.s.toolAllowed(toolName) ||
		c.s.toolPrefixAllowed(toolName) {
		c.recordDecision(toolName, title, "allow", true)
		return selectOption(params, acpsdk.PermissionOptionKindAllowOnce)
	}
	if c.s.usesOurMCP() && isMCPLaunchPrompt(toolName, title) {
		c.recordDecision(toolName, title, "allow", true)
		return selectOption(params, acpsdk.PermissionOptionKindAllowOnce)
	}
	answer := c.m.ask(ctx, c.s, Question{
		Kind:    QuestionPermission,
		Text:    permissionText(toolName, title),
		Tool:    toolName,
		Options: permissionOptions(params),
	})

	chosen := permissionOption(params, answer.OptionID)
	if answer.Declined || chosen == nil {
		// Nobody answered — the app is closing, the turn was cancelled, or the
		// person said no. The policy is still the way to stop being asked.
		c.recordDecision(toolName, title, "reject", answer.Declined)
		c.m.log.Info("acp: permission not granted",
			"session", c.s.ID, "card", c.s.CardID, "tool", toolName,
			"hint", fmt.Sprintf("add %q to autoAllowTools to stop being asked", toolName))
		return selectOption(params, acpsdk.PermissionOptionKindRejectOnce)
	}
	// "Always" is what makes answering once enough: the rest of this session's
	// calls to the same tool go through without asking again.
	if chosen.Kind == string(acpsdk.PermissionOptionKindAllowAlways) {
		c.s.allowToolAlways(toolName)
	}
	decision := "reject"
	if strings.HasPrefix(chosen.Kind, "allow") {
		decision = "allow"
	}
	c.recordDecision(toolName, title, decision, false)
	return acpsdk.RequestPermissionResponse{Outcome: acpsdk.RequestPermissionOutcome{
		Selected: &acpsdk.RequestPermissionOutcomeSelected{OptionId: acpsdk.PermissionOptionId(chosen.ID)},
	}}, nil
}

// permissionText is the question as a person reads it: what the agent is about
// to do, in the agent's own words where it gave any.
func permissionText(toolName, title string) string {
	switch {
	case title != "" && toolName != "":
		return fmt.Sprintf("Разрешить %s: %s?", toolName, title)
	case title != "":
		return fmt.Sprintf("Разрешить: %s?", title)
	case toolName != "":
		return fmt.Sprintf("Разрешить %s?", toolName)
	}
	return "Разрешить действие агента?"
}

// permissionOptions turns the agent's options into the card's buttons. The
// labels are the agent's own — it knows what it is asking better than we do.
func permissionOptions(params acpsdk.RequestPermissionRequest) []QuestionOption {
	out := make([]QuestionOption, 0, len(params.Options))
	for _, opt := range params.Options {
		out = append(out, QuestionOption{
			ID:    string(opt.OptionId),
			Label: opt.Name,
			Kind:  string(opt.Kind),
		})
	}
	return out
}

// permissionOption finds the option the person chose.
func permissionOption(params acpsdk.RequestPermissionRequest, optionID string) *QuestionOption {
	for _, opt := range params.Options {
		if string(opt.OptionId) == optionID {
			chosen := QuestionOption{ID: optionID, Label: opt.Name, Kind: string(opt.Kind)}
			return &chosen
		}
	}
	return nil
}

// recordDecision persists and broadcasts how a permission ended up. byPolicy
// marks decisions the user was never asked about.
func (c *sessionClient) recordDecision(toolName, title, decision string, byPolicy bool) {
	c.s.appendEvent(c.m, "permission", map[string]any{
		"tool":     toolName,
		"title":    title,
		"decision": decision,
		"byPolicy": byPolicy,
	})
}

// selectOption picks the agent-offered option of the wanted kind, falling back
// to cancellation when the agent offered nothing suitable.
func selectOption(params acpsdk.RequestPermissionRequest, kind acpsdk.PermissionOptionKind) (acpsdk.RequestPermissionResponse, error) {
	for _, opt := range params.Options {
		if opt.Kind == kind {
			return acpsdk.RequestPermissionResponse{Outcome: acpsdk.RequestPermissionOutcome{
				Selected: &acpsdk.RequestPermissionOutcomeSelected{OptionId: opt.OptionId},
			}}, nil
		}
	}
	return acpsdk.RequestPermissionResponse{Outcome: acpsdk.RequestPermissionOutcome{
		Cancelled: &acpsdk.RequestPermissionOutcomeCancelled{},
	}}, nil
}

// permissionToolName extracts the tool name the bridge put into the meta.
func (c *sessionClient) permissionToolName(params acpsdk.RequestPermissionRequest) string {
	if name := metaToolName(params.ToolCall.Meta); name != "" {
		return normalizeToolName(name)
	}
	// The call was announced before permission was asked for it, and that
	// announcement is where an adapter puts the name.
	if name := c.recalledToolName(string(params.ToolCall.ToolCallId)); name != "" {
		return name
	}
	kind := ""
	if params.ToolCall.Kind != nil {
		kind = string(*params.ToolCall.Kind)
	}
	if name := inferToolName(kind, params.ToolCall.RawInput); name != "" {
		return name
	}
	if params.ToolCall.Title != nil {
		if name, _, found := strings.Cut(*params.ToolCall.Title, ":"); found {
			return strings.TrimSpace(name)
		}
		return *params.ToolCall.Title
	}
	return ""
}

// noteToolCall files whatever the announcement of a call tells us about which
// tool it is: the name the agent gave it, else what its kind and input say.
func (c *sessionClient) noteToolCall(id string, meta map[string]any, kind string, input any) {
	name := normalizeToolName(metaToolName(meta))
	if name == "" {
		name = inferToolName(kind, input)
	}
	c.rememberToolName(id, name)
}

// rememberToolName files a named tool call under its id, so the permission
// request that follows can be matched to it.
func (c *sessionClient) rememberToolName(id, name string) {
	if id == "" || name == "" {
		return
	}
	c.toolMu.Lock()
	defer c.toolMu.Unlock()
	if c.toolNames == nil {
		c.toolNames = make(map[string]string)
	}
	// A turn's worth of tool calls is small; a session's is not, and nothing
	// tells us a call is finished with. Forgetting the oldest keeps a long
	// console session from growing this without bound.
	if len(c.toolNames) >= maxRememberedTools {
		for k := range c.toolNames {
			delete(c.toolNames, k)
			break
		}
	}
	c.toolNames[id] = name
}

// maxRememberedTools bounds the id → name map.
const maxRememberedTools = 512

func (c *sessionClient) recalledToolName(id string) string {
	c.toolMu.Lock()
	defer c.toolMu.Unlock()
	return c.toolNames[id]
}

// isMCPLaunchPrompt spots an agent asking whether it may start an MCP server.
// Junie sends that question with no tool name at all — "Allow running MCP?" is
// the entire request — so there is nothing for a name-based policy to match,
// and an unattended session would reject the very server it was started with,
// leaving the agent without the tools it was asked to use. Answering it
// ourselves is honest only because we are the ones who configured that server
// (usesOurMCP): consent was given when the session was started.
func isMCPLaunchPrompt(toolName, title string) bool {
	for _, text := range []string{toolName, title} {
		if strings.Contains(strings.ToLower(text), "mcp") {
			return true
		}
	}
	return false
}

func (c *sessionClient) SessionUpdate(ctx context.Context, params acpsdk.SessionNotification) error {
	u := params.Update
	switch {
	case u.AgentMessageChunk != nil:
		if t := u.AgentMessageChunk.Content.Text; t != nil {
			c.s.finalMu.Lock()
			c.s.finalBuf.WriteString(t.Text)
			c.s.finalMu.Unlock()
			c.s.appendEvent(c.m, "chunk", map[string]any{"text": t.Text})
			c.emitChunk(t.Text, false)
		}
	case u.AgentThoughtChunk != nil:
		if t := u.AgentThoughtChunk.Content.Text; t != nil {
			c.s.appendEvent(c.m, "thought", map[string]any{"text": t.Text})
			if c.m.cfg.ShowThoughts {
				c.emitChunk(t.Text, true)
			}
		}
	case u.ToolCall != nil:
		c.flush() // keep the console in the order the agent produced it
		c.noteToolCall(string(u.ToolCall.ToolCallId), u.ToolCall.Meta,
			string(u.ToolCall.Kind), u.ToolCall.RawInput)
		c.s.appendEvent(c.m, "tool_call", map[string]any{
			"toolCallId": string(u.ToolCall.ToolCallId),
			"title":      u.ToolCall.Title,
			"status":     string(u.ToolCall.Status),
		})
	case u.ToolCallUpdate != nil:
		// An update may be the first message that names the call: an adapter
		// that fills the input in stages sends the name with every one of them.
		kind := ""
		if u.ToolCallUpdate.Kind != nil {
			kind = string(*u.ToolCallUpdate.Kind)
		}
		c.noteToolCall(string(u.ToolCallUpdate.ToolCallId), u.ToolCallUpdate.Meta,
			kind, u.ToolCallUpdate.RawInput)
		status := ""
		if u.ToolCallUpdate.Status != nil {
			status = string(*u.ToolCallUpdate.Status)
		}
		c.s.appendEvent(c.m, "tool_update", map[string]any{
			"toolCallId": string(u.ToolCallUpdate.ToolCallId),
			"status":     status,
		})
	}
	return nil
}

// File-system proxying is jailed to the session worktree. The claude bridge
// never calls these (the CLI does its own I/O); external ACP agents might.
func (c *sessionClient) ReadTextFile(ctx context.Context, params acpsdk.ReadTextFileRequest) (acpsdk.ReadTextFileResponse, error) {
	path, err := c.jail(params.Path)
	if err != nil {
		return acpsdk.ReadTextFileResponse{}, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return acpsdk.ReadTextFileResponse{}, err
	}
	return acpsdk.ReadTextFileResponse{Content: string(b)}, nil
}

func (c *sessionClient) WriteTextFile(ctx context.Context, params acpsdk.WriteTextFileRequest) (acpsdk.WriteTextFileResponse, error) {
	path, err := c.jail(params.Path)
	if err != nil {
		return acpsdk.WriteTextFileResponse{}, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return acpsdk.WriteTextFileResponse{}, err
	}
	if err := os.WriteFile(path, []byte(params.Content), 0o644); err != nil {
		return acpsdk.WriteTextFileResponse{}, err
	}
	return acpsdk.WriteTextFileResponse{}, nil
}

func (c *sessionClient) jail(path string) (string, error) {
	if !filepath.IsAbs(path) {
		return "", fmt.Errorf("path must be absolute: %s", path)
	}
	clean := filepath.Clean(path)
	root := c.s.Worktree.Path
	if root == "" {
		return "", fmt.Errorf("session has no worktree")
	}
	// The agent may well spell the worktree differently than we do and still
	// mean it: on macOS the temp and home trees are reached through symlinks
	// (/var → /private/var), and an agent that resolved the path before asking
	// would be refused its own working directory. Comparing against the
	// resolved root as well is what makes both spellings the same place.
	for _, candidate := range []string{clean, resolvedPath(clean)} {
		for _, r := range []string{root, resolvedPath(root)} {
			if underRoot(candidate, r) {
				return clean, nil
			}
		}
	}
	c.m.log.Warn("acp: fs access outside worktree denied", "session", c.s.ID, "path", clean)
	return "", fmt.Errorf("path %s is outside the session worktree", clean)
}

// underRoot reports whether path is root or something inside it.
func underRoot(path, root string) bool {
	if root == "" {
		return false
	}
	return path == root || strings.HasPrefix(path, root+string(filepath.Separator))
}

// resolvedPath follows symlinks, falling back to the path as given — a path
// that cannot be resolved is not a reason to refuse everything. A file being
// created does not exist yet, so its directory is resolved instead.
func resolvedPath(path string) string {
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		return resolved
	}
	dir, base := filepath.Split(path)
	if resolved, err := filepath.EvalSymlinks(filepath.Clean(dir)); err == nil {
		return filepath.Join(resolved, base)
	}
	return path
}

// Terminal capability is not advertised.
func (c *sessionClient) CreateTerminal(ctx context.Context, params acpsdk.CreateTerminalRequest) (acpsdk.CreateTerminalResponse, error) {
	return acpsdk.CreateTerminalResponse{}, fmt.Errorf("terminal not supported")
}
func (c *sessionClient) KillTerminal(ctx context.Context, params acpsdk.KillTerminalRequest) (acpsdk.KillTerminalResponse, error) {
	return acpsdk.KillTerminalResponse{}, fmt.Errorf("terminal not supported")
}
func (c *sessionClient) TerminalOutput(ctx context.Context, params acpsdk.TerminalOutputRequest) (acpsdk.TerminalOutputResponse, error) {
	return acpsdk.TerminalOutputResponse{}, fmt.Errorf("terminal not supported")
}
func (c *sessionClient) ReleaseTerminal(ctx context.Context, params acpsdk.ReleaseTerminalRequest) (acpsdk.ReleaseTerminalResponse, error) {
	return acpsdk.ReleaseTerminalResponse{}, fmt.Errorf("terminal not supported")
}
func (c *sessionClient) WaitForTerminalExit(ctx context.Context, params acpsdk.WaitForTerminalExitRequest) (acpsdk.WaitForTerminalExitResponse, error) {
	return acpsdk.WaitForTerminalExitResponse{}, fmt.Errorf("terminal not supported")
}
