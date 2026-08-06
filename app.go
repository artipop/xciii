// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/artipop/xciii/internal/acp"
)

// errACPDisabled is returned by bindings when the integration is off.
var errACPDisabled = errors.New("интеграция агента выключена (см. конфиг acp)")

// App is the bound service: its exported methods are what the frontend calls
// by name (main.App.<Method>). It contains no logic of its own; ACP calls
// delegate to the manager.
type App struct {
	mu      sync.RWMutex
	wapp    *application.App
	origin  string
	emitter *wailsEmitter
	mgr     *acp.Manager // nil when the ACP integration is disabled
}

func NewApp(emitter *wailsEmitter) *App {
	return &App{emitter: emitter}
}

// SetApplication hands over the running application, the way to reach the
// runtime in v3. It is set once, before Run.
func (a *App) SetApplication(wapp *application.App) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.wapp = wapp
}

// SetOrigin records the address the front door serves the app under, which is
// what a second window has to be pointed at.
func (a *App) SetOrigin(url string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.origin = url
}

func (a *App) originURL() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.origin
}

func (a *App) app() *application.App {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.wapp
}

// OpenInBrowser opens the given URL in the user's default system browser.
// Bound to JS and invoked by the target=_blank click handler injected in
// bootstrapScript.
func (a *App) OpenInBrowser(url string) {
	wapp := a.app()
	if wapp == nil || url == "" {
		return
	}
	_ = wapp.Browser.OpenURL(url)
}

// CancelSession cancels the live agent session of a card, if any.
func (a *App) CancelSession(cardID string) bool {
	if a.mgr == nil {
		return false
	}
	return a.mgr.CancelSessionForCard(cardID, "отменено пользователем")
}

// ListAgentProjects returns the project registry as JSON: [{"name","path"}, …].
// boardID is the board asking; "" asks for the whole registry, which is what a
// place with no board behind it (the planning dialog) wants.
func (a *App) ListAgentProjects(boardID string) (string, error) {
	if a.mgr == nil {
		return "[]", nil
	}
	out, err := json.Marshal(a.mgr.ProjectsForBoard(boardID))
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// PickDirectory opens the native folder picker and returns the chosen
// absolute path ("" when the user cancels). A server build has no native
// dialog to open, so it says so rather than returning an empty path the UI
// would read as a cancellation.
func (a *App) PickDirectory(title string) (string, error) {
	wapp := a.app()
	if wapp == nil {
		return "", nil
	}
	return pickDirectory(wapp, title)
}

// AddAgentProject registers a local project (name defaults to the directory
// basename when empty) and returns the created entry as JSON. It belongs to
// boardID — the board it was added on and the only one that offers it — unless
// global says every board should.
func (a *App) AddAgentProject(name, path, boardID string, global bool) (string, error) {
	if a.mgr == nil {
		return "", errACPDisabled
	}
	entry, err := a.mgr.AddProject(name, path, boardID, global)
	if err != nil {
		return "", err
	}
	out, _ := json.Marshal(entry)
	return string(out), nil
}

// RemoveAgentProject deletes a project registry entry by name.
func (a *App) RemoveAgentProject(name string) error {
	if a.mgr == nil {
		return errACPDisabled
	}
	return a.mgr.RemoveProject(name)
}

// ListAgentAdapters reports, per agent kind, whether it can be started on this
// machine — the adapter is installed, npx would fetch it, or Node.js is missing
// — so the dialog can say it instead of a card failing later.
func (a *App) ListAgentAdapters() (string, error) {
	if a.mgr == nil {
		return "[]", nil
	}
	out, err := json.Marshal(a.mgr.AdapterStatuses())
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// InstallAgentAdapter installs a kind's adapter with npm and returns npm's own
// output, so a failure is readable.
func (a *App) InstallAgentAdapter(kind string) (string, error) {
	if a.mgr == nil {
		return "", errACPDisabled
	}
	return a.mgr.InstallAdapter(kind)
}

// ListAgents returns the agent registry as JSON: [{"name","kind",…}, …].
func (a *App) ListAgents() (string, error) {
	if a.mgr == nil {
		return "[]", nil
	}
	out, err := json.Marshal(a.mgr.Agents())
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// AddAgent registers a new agent from a JSON-encoded AgentEntry and returns the
// created entry as JSON.
func (a *App) AddAgent(entryJSON string) (string, error) {
	if a.mgr == nil {
		return "", errACPDisabled
	}
	var entry acp.AgentEntry
	if err := json.Unmarshal([]byte(entryJSON), &entry); err != nil {
		return "", err
	}
	saved, err := a.mgr.AddAgent(entry)
	if err != nil {
		return "", err
	}
	out, _ := json.Marshal(saved)
	return string(out), nil
}

// UpdateAgent replaces an existing agent (matched by name) from a JSON-encoded
// AgentEntry and returns the saved entry as JSON.
func (a *App) UpdateAgent(entryJSON string) (string, error) {
	if a.mgr == nil {
		return "", errACPDisabled
	}
	var entry acp.AgentEntry
	if err := json.Unmarshal([]byte(entryJSON), &entry); err != nil {
		return "", err
	}
	saved, err := a.mgr.UpdateAgent(entry)
	if err != nil {
		return "", err
	}
	out, _ := json.Marshal(saved)
	return string(out), nil
}

// AgentOptions asks the agent itself which settings it has — Fast mode, an
// effort level, a permission mode — and returns them as JSON:
// [{"id","name","type","current","values":[…]}, …]. The agent is started the
// way a session would start it and asked nothing, so the dialog offers exactly
// what this agent supports and no toggle for what it does not. refresh skips
// the cached answer.
func (a *App) AgentOptions(entryJSON string, refresh bool) (string, error) {
	if a.mgr == nil {
		return "[]", nil
	}
	var entry acp.AgentEntry
	if err := json.Unmarshal([]byte(entryJSON), &entry); err != nil {
		return "", err
	}
	options, err := a.mgr.AgentOptions(entry, refresh)
	if err != nil {
		return "", err
	}
	out, err := json.Marshal(options)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// RemoveAgent deletes an agent registry entry by name.
func (a *App) RemoveAgent(name string) error {
	if a.mgr == nil {
		return errACPDisabled
	}
	return a.mgr.RemoveAgent(name)
}

// SyncAgentUsers gives every registered agent a board account and adds it to
// the board's members, so cards can be assigned to an agent in a person
// property. Returns the accounts as JSON: [{"name","username","userId",
// "created"}, …].
func (a *App) SyncAgentUsers(boardID string) (string, error) {
	if a.mgr == nil {
		return "", errACPDisabled
	}
	users, err := a.mgr.SyncAgentUsers(context.Background(), boardID)
	if err != nil {
		return "", err
	}
	out, _ := json.Marshal(users)
	return string(out), nil
}

// ListProxies returns the proxy registry as JSON: [{"name","proxy",…}, …].
func (a *App) ListProxies() (string, error) {
	if a.mgr == nil {
		return "[]", nil
	}
	out, err := json.Marshal(a.mgr.Proxies())
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// AddProxy registers a network configuration from a JSON-encoded ProxyEntry and
// returns the created entry as JSON.
func (a *App) AddProxy(entryJSON string) (string, error) {
	if a.mgr == nil {
		return "", errACPDisabled
	}
	var entry acp.ProxyEntry
	if err := json.Unmarshal([]byte(entryJSON), &entry); err != nil {
		return "", err
	}
	saved, err := a.mgr.AddProxy(entry)
	if err != nil {
		return "", err
	}
	out, _ := json.Marshal(saved)
	return string(out), nil
}

// UpdateProxy replaces an existing network configuration (matched by name) from
// a JSON-encoded ProxyEntry and returns the saved entry as JSON.
func (a *App) UpdateProxy(entryJSON string) (string, error) {
	if a.mgr == nil {
		return "", errACPDisabled
	}
	var entry acp.ProxyEntry
	if err := json.Unmarshal([]byte(entryJSON), &entry); err != nil {
		return "", err
	}
	saved, err := a.mgr.UpdateProxy(entry)
	if err != nil {
		return "", err
	}
	out, _ := json.Marshal(saved)
	return string(out), nil
}

// RemoveProxy deletes a network configuration by name.
func (a *App) RemoveProxy(name string) error {
	if a.mgr == nil {
		return errACPDisabled
	}
	return a.mgr.RemoveProxy(name)
}

// ListDeployTargets returns the deploy registry as JSON:
// [{"name","sshHost","baseDomain",…}, …].
func (a *App) ListDeployTargets() (string, error) {
	if a.mgr == nil {
		return "[]", nil
	}
	out, err := json.Marshal(a.mgr.Deploys())
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// AddDeployTarget registers a Dokku destination from a JSON-encoded DeployEntry
// and returns the created entry as JSON.
func (a *App) AddDeployTarget(entryJSON string) (string, error) {
	if a.mgr == nil {
		return "", errACPDisabled
	}
	var entry acp.DeployEntry
	if err := json.Unmarshal([]byte(entryJSON), &entry); err != nil {
		return "", err
	}
	saved, err := a.mgr.AddDeploy(entry)
	if err != nil {
		return "", err
	}
	out, _ := json.Marshal(saved)
	return string(out), nil
}

// UpdateDeployTarget replaces an existing destination (matched by name) from a
// JSON-encoded DeployEntry and returns the saved entry as JSON.
func (a *App) UpdateDeployTarget(entryJSON string) (string, error) {
	if a.mgr == nil {
		return "", errACPDisabled
	}
	var entry acp.DeployEntry
	if err := json.Unmarshal([]byte(entryJSON), &entry); err != nil {
		return "", err
	}
	saved, err := a.mgr.UpdateDeploy(entry)
	if err != nil {
		return "", err
	}
	out, _ := json.Marshal(saved)
	return string(out), nil
}

// RemoveDeployTarget deletes a Dokku destination by name.
func (a *App) RemoveDeployTarget(name string) error {
	if a.mgr == nil {
		return errACPDisabled
	}
	return a.mgr.RemoveDeploy(name)
}

// ListFlows returns the routes a board may use as JSON — its own, plus any tied
// to no board in particular — each a graph of nodes (a column) and edges (an
// event and where it leads).
func (a *App) ListFlows(boardID string) (string, error) {
	if a.mgr == nil {
		return "[]", nil
	}
	out, err := json.Marshal(a.mgr.BoardFlows(boardID))
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// BoardSetupPlan returns what this board needs answered before its automation
// can run: which steps, in which order, which of them may be skipped and which
// are already answered by this machine. It is one answer to one question — the
// wizard walks it and the board menu reads it to know which registries are
// worth opening at all.
func (a *App) BoardSetupPlan(boardID string) (string, error) {
	if a.mgr == nil {
		return "", errACPDisabled
	}
	out, err := json.Marshal(a.mgr.SetupPlanFor(boardID))
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// MarkBoardSetupOffered remembers that the setup wizard has opened itself for
// this board. It is stored beside the rest of the board's setup rather than in
// the page: the desktop app serves itself on a fresh port every launch, so the
// page's own storage is a fresh one too.
func (a *App) MarkBoardSetupOffered(boardID string) error {
	if a.mgr == nil {
		return errACPDisabled
	}
	return a.mgr.MarkSetupOffered(boardID)
}

// CheckBoardSetupAnswer says whether an answer fits the step it answers on this
// board — a project under git for a board that publishes a branch or waits for
// one, and any requirement a step grows later. Called before the answer is
// filed, so the question can refuse it where it was asked.
func (a *App) CheckBoardSetupAnswer(boardID, step, value string) error {
	if a.mgr == nil {
		return errACPDisabled
	}
	return a.mgr.CheckSetupAnswer(boardID, step, value)
}

// RecordBoardSetupStep remembers what was done with a step — skipping above
// all, which is the one answer no registry can be read for.
func (a *App) RecordBoardSetupStep(boardID, step, status string) error {
	if a.mgr == nil {
		return errACPDisabled
	}
	return a.mgr.RecordSetupStep(boardID, step, status)
}

// ListSetupSteps returns the closed set of setup steps this build can carry
// out, so a board can only ask for one that exists.
func (a *App) ListSetupSteps() (string, error) {
	out, err := json.Marshal(acp.SetupStepDefs)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// ListFlowTriggers returns the closed set of edge triggers the engine
// implements, so the editor can only offer transitions that actually work.
func (a *App) ListFlowTriggers() (string, error) {
	out, err := json.Marshal(acp.FlowTriggers)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// ListFlowTemplates returns the routes a fresh install is seeded with, rebuilt
// from the current column names. An install whose registry predates them (or
// whose routes were deleted) can add the ones it is missing from the editor
// instead of retyping a graph.
func (a *App) ListFlowTemplates() (string, error) {
	if a.mgr == nil {
		return "[]", nil
	}
	out, err := json.Marshal(a.mgr.FlowTemplates())
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// AddFlow registers a route from a JSON-encoded FlowEntry and returns it.
func (a *App) AddFlow(entryJSON string) (string, error) {
	if a.mgr == nil {
		return "", errACPDisabled
	}
	var entry acp.FlowEntry
	if err := json.Unmarshal([]byte(entryJSON), &entry); err != nil {
		return "", err
	}
	saved, err := a.mgr.AddFlow(entry)
	if err != nil {
		return "", err
	}
	out, _ := json.Marshal(saved)
	return string(out), nil
}

// UpdateFlow replaces an existing route (matched by name) and returns it.
func (a *App) UpdateFlow(entryJSON string) (string, error) {
	if a.mgr == nil {
		return "", errACPDisabled
	}
	var entry acp.FlowEntry
	if err := json.Unmarshal([]byte(entryJSON), &entry); err != nil {
		return "", err
	}
	saved, err := a.mgr.UpdateFlow(entry)
	if err != nil {
		return "", err
	}
	out, _ := json.Marshal(saved)
	return string(out), nil
}

// RemoveFlow deletes a route by name. Cards standing on it simply stop moving
// by themselves.
func (a *App) RemoveFlow(name string) error {
	if a.mgr == nil {
		return errACPDisabled
	}
	return a.mgr.RemoveFlow(name)
}

// ListBoardColumns returns what each configured column of a board does: the
// action, the crew that works it and how many of them at once.
func (a *App) ListBoardColumns(boardID string) (string, error) {
	if a.mgr == nil {
		return "[]", nil
	}
	out, err := json.Marshal(a.mgr.BoardColumns(boardID))
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// SaveBoardColumn stores the settings of one column from a JSON-encoded
// ColumnSpec and returns what was saved.
func (a *App) SaveBoardColumn(specJSON string) (string, error) {
	if a.mgr == nil {
		return "", errACPDisabled
	}
	var spec acp.ColumnSpec
	if err := json.Unmarshal([]byte(specJSON), &spec); err != nil {
		return "", err
	}
	saved, err := a.mgr.SaveColumn(spec)
	if err != nil {
		return "", err
	}
	out, _ := json.Marshal(saved)
	return string(out), nil
}

// RemoveBoardColumn forgets a column's settings. The column stays on the board.
func (a *App) RemoveBoardColumn(boardID, optionID, column string) error {
	if a.mgr == nil {
		return errACPDisabled
	}
	return a.mgr.RemoveColumn(boardID, optionID, column)
}

// GetCardFlow describes where a card stands on its route: the stages, the one
// it is on, what that stage waits for. Returns "null" for a card with no route.
func (a *App) GetCardFlow(cardID string) (string, error) {
	if a.mgr == nil {
		return "null", nil
	}
	flow, err := a.mgr.CardFlowFor(cardID)
	if err != nil {
		return "", err
	}
	out, err := json.Marshal(flow)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// SeedBoardAutomation takes the columns and routes a board carries of its own
// into the registry now, rather than waiting for the first card to be moved.
// The setup wizard calls it, so what the board can do is visible as soon as it
// is configured. Idempotent: anything already registered is left alone.
func (a *App) SeedBoardAutomation(boardID string) error {
	if a.mgr == nil {
		return errACPDisabled
	}
	a.mgr.SeedBoard(boardID)
	return nil
}

// GetBoardFlowOverview returns where the board's cards stand on each route:
// per stage, how many are there, how many are working and how many wait.
func (a *App) GetBoardFlowOverview(boardID string) (string, error) {
	if a.mgr == nil {
		return "[]", nil
	}
	overview, err := a.mgr.BoardFlowOverview(boardID)
	if err != nil {
		return "", err
	}
	out, err := json.Marshal(overview)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// GetWorktreeMode reports where sessions run ("always" or "never"). The column
// editor asks, because a crew of several agents in one project only works
// when each session gets its own worktree.
func (a *App) GetWorktreeMode() (string, error) {
	if a.mgr == nil {
		return "", nil
	}
	return a.mgr.WorktreeMode(), nil
}

// GetAgentSystemPrompt returns the board/column-level system prompt.
func (a *App) GetAgentSystemPrompt() (string, error) {
	if a.mgr == nil {
		return "", nil
	}
	return a.mgr.SystemPrompt(), nil
}

// SetAgentSystemPrompt stores the board/column-level system prompt.
func (a *App) SetAgentSystemPrompt(text string) error {
	if a.mgr == nil {
		return errACPDisabled
	}
	return a.mgr.SetSystemPrompt(text)
}

// StartCardDeploy publishes a card's branch to its Dokku target without moving
// the card into the deploy column, and returns the deploy session's id. branch
// is the one the card is working on (its session's worktree branch); empty lets
// the card property or the checked-out branch decide.
func (a *App) StartCardDeploy(cardID, branch string) (string, error) {
	if a.mgr == nil {
		return "", errACPDisabled
	}
	s, err := a.mgr.StartDeployForCard(cardID, branch)
	if err != nil {
		return "", err
	}
	return s.ID, nil
}

// ---- terminal windows ----

// A terminal is the agent's own CLI in a window of ours: the same project,
// worktree, branch and environment a session would get, with a human at the
// keyboard instead of a prompt loop. These bindings start one and hand back
// where to draw it; the drawing is xterm.js on a WebSocket (terminalws.go).

// terminalHandle is what the UI needs to show a terminal: which one, and where.
type terminalHandle struct {
	acp.TerminalInfo
	// URL is the page that draws it. A desktop build has already opened a
	// window there by the time this is returned; a server build has no windows,
	// so the browser opens a tab itself.
	URL string `json:"url"`
	// Windowed says which of those two happened.
	Windowed bool `json:"windowed"`
}

// OpenCardTerminal opens (or focuses) the agent CLI for a card and returns the
// terminal as JSON. projectName/agentName may be empty, in which case the card
// decides exactly as it does for a session.
func (a *App) OpenCardTerminal(cardID, projectName, agentName string) (string, error) {
	if a.mgr == nil {
		return "", errACPDisabled
	}
	t, err := a.mgr.StartCardTerminal(cardID, projectName, agentName)
	if err != nil {
		return "", err
	}
	return a.terminalWindow(t)
}

// OpenPlanningTerminal opens the CLI with no card behind it — the terminal half
// of "Plan a task".
func (a *App) OpenPlanningTerminal(projectName, agentName string) (string, error) {
	if a.mgr == nil {
		return "", errACPDisabled
	}
	t, err := a.mgr.StartPlanningTerminal(projectName, agentName)
	if err != nil {
		return "", err
	}
	return a.terminalWindow(t)
}

// terminalWindow opens the window for a terminal session and describes it.
func (a *App) terminalWindow(t *acp.TerminalSession) (string, error) {
	info := t.Info()
	handle := terminalHandle{TerminalInfo: info, URL: a.originURL() + "acp/terminal/" + info.ID}
	if wapp := a.app(); wapp != nil {
		handle.Windowed = openTerminalWindow(wapp, info, handle.URL)
	}
	out, err := json.Marshal(handle)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// GetTerminalInfo describes a live terminal, for the page that draws it.
func (a *App) GetTerminalInfo(terminalID string) (string, error) {
	if a.mgr == nil {
		return "", errACPDisabled
	}
	t := a.mgr.Terminal(terminalID)
	if t == nil {
		return "", errors.New("терминал не активен")
	}
	out, err := json.Marshal(t.Info())
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// GetCardAgent is everything a card shows about its agent in one call: the
// terminal it already has running or could continue, and the state of the
// automation's own session — the branch it works on, so the card can offer to
// deploy it, and whether something is running, so it can be cancelled.
//
// There is no transcript here. A session reports itself in the card's comments,
// and a conversation with an agent happens in a terminal window.
// JSON: {"running":{…}|null,"resume":{…},"session":{…}}.
func (a *App) GetCardAgent(cardID string) (string, error) {
	if a.mgr == nil {
		return "{}", nil
	}
	session, err := a.mgr.CardAgentState(cardID)
	if err != nil {
		return "", err
	}
	payload := map[string]any{
		"resume":  a.mgr.TerminalHistoryForCard(cardID),
		"session": session,
	}
	// An agent waiting on an answer is the one thing on a card that is
	// addressed to the person reading it.
	if q := a.mgr.QuestionForCard(cardID); q != nil {
		payload["question"] = q
	}
	if live := a.mgr.TerminalForCard(cardID); live != nil {
		payload["running"] = live.Info()
	}
	out, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// ListTerminals returns every terminal currently running as JSON, newest first.
// A window can be closed while its CLI keeps working, and a planning terminal
// has no card to be found through, so this is how the UI offers it back.
func (a *App) ListTerminals() (string, error) {
	if a.mgr == nil {
		return "[]", nil
	}
	out, err := json.Marshal(a.mgr.LiveTerminals())
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// AnswerQuestion hands an agent the answer it is waiting for: an option it
// offered, or text typed instead. Both empty means no — the agent hears a
// refusal and carries on without what it asked for.
func (a *App) AnswerQuestion(questionID, optionID, text string) error {
	if a.mgr == nil {
		return errACPDisabled
	}
	ans := acp.Answer{OptionID: optionID, Text: text}
	if optionID == "" && strings.TrimSpace(text) == "" {
		ans.Declined = true
	}
	return a.mgr.AnswerQuestion(questionID, ans)
}

// ListAttention returns everything waiting for a person as JSON: the terminals
// whose agent has gone quiet, oldest wait first. The page keeps itself current
// from acp:attention events; this is what a page that opened later starts from.
func (a *App) ListAttention() (string, error) {
	if a.mgr == nil {
		return "[]", nil
	}
	out, err := json.Marshal(a.mgr.Attention())
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// ShowTerminal reopens the window of a terminal that is already running and
// returns it as JSON, the same shape OpenCardTerminal returns.
func (a *App) ShowTerminal(terminalID string) (string, error) {
	if a.mgr == nil {
		return "", errACPDisabled
	}
	t := a.mgr.Terminal(terminalID)
	if t == nil {
		return "", errors.New("терминал уже завершён")
	}
	return a.terminalWindow(t)
}

// CloseTerminal ends a terminal session and everything its CLI started.
func (a *App) CloseTerminal(terminalID string) error {
	if a.mgr == nil {
		return errACPDisabled
	}
	return a.mgr.CloseTerminal(terminalID)
}
