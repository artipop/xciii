package acp

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Naming a branch by asking the agent. Off by default: it spends an agent run
// and a wait on something transliteration already does for free, so it is for
// the person who wants «pochini-avtorizatsiyu-cherez-sso» to instead read
// «fix-sso-login» — a name, not a spelling.
//
// The session lives only for the name: no terminal is opened, nothing is
// recorded on the card, and whatever goes wrong — the agent is slow, the
// answer is prose, the process refuses to start — the caller falls back to
// the transliterated title. A branch name is never worth failing a card over.

// branchNamingTimeout bounds the whole ask, adapter start included. Generous
// enough for a cold CLI start, short enough that a terminal opened by a person
// does not sit unexplained for minutes.
const branchNamingTimeout = 45 * time.Second

// branchNamingPrompt is what the naming session is asked. It is the whole of
// the session's task, so it insists on the shape of the answer: everything
// else the agent might say is noise the caller has to survive.
const branchNamingPrompt = `Придумай название git-ветки для задачи ниже: латиницей, в kebab-case, два-четыре коротких слова, по смыслу задачи. Без префиксов, без номеров, без пояснений. Ответь ровно одной строкой — самим названием. Не используй инструменты.

Задача: %s`

// AgentNamedBranches reports the machine's setting.
func (m *Manager) AgentNamedBranches() bool {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	return m.cfg.AgentNamedBranches
}

// SetAgentNamedBranches flips it and persists the config.
func (m *Manager) SetAgentNamedBranches(on bool) error {
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	m.cfg.AgentNamedBranches = on
	return m.persistConfigLocked()
}

// agentBranchName asks the agent for a branch name, or returns "" for any
// reason at all — the fallback is always ready and never worth an error.
func (m *Manager) agentBranchName(spec WorkSpec, workdir string) string {
	m.cfgMu.RLock()
	enabled := m.cfg.AgentNamedBranches
	m.cfgMu.RUnlock()
	if !enabled || spec.Agent == nil {
		return ""
	}

	task := strings.TrimSpace(spec.Title)
	if extra := strings.TrimSpace(spec.Task); extra != "" && extra != task {
		task += "\n" + truncateRunes(extra, 500)
	}
	if task == "" {
		return ""
	}

	net, err := m.resolveNetwork(*spec.Agent)
	if err != nil {
		m.log.Info("acp: branch naming skipped", "err", err)
		return ""
	}

	ctx, cancel := context.WithTimeout(m.rootCtx, branchNamingTimeout)
	defer cancel()

	// The same headless shape a source's run uses (inboxrun.go): Planning
	// keeps it read-only and off the card, and the folder itself is the cwd —
	// the workspace this name is for does not exist yet.
	s := &Session{
		ID:          "name-" + uuid.New().String(),
		Agent:       *spec.Agent,
		Net:         net,
		WorkdirPath: workdir,
		Planning:    true,
		PromptText:  fmt.Sprintf(branchNamingPrompt, task),
		Policy:      agentPolicy(*spec.Agent),
		status:      StatusQueued,
		allowTools:  map[string]bool{},
	}
	s.Worktree.Path = workdir

	conn, sessionID, cleanup, err := m.openConnection(ctx, s)
	if err != nil {
		m.log.Info("acp: branch naming skipped", "err", err)
		return ""
	}
	defer cleanup()

	text, err := m.runTurn(s, conn, sessionID, s.PromptText)
	if err != nil {
		m.log.Info("acp: branch naming failed, falling back to the title", "err", err)
		return ""
	}
	name := branchNameFromAnswer(text)
	if name == "" {
		m.log.Info("acp: branch naming answered with no usable name", "answer", truncateRunes(text, 120))
	}
	return name
}

// branchNameFromAnswer digs the name out of what the agent said. The prompt
// asks for one line, and an agent that ignores that usually puts the name
// last — after the prose, in the shape of a conclusion.
func branchNameFromAnswer(text string) string {
	lines := strings.Split(text, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		candidate := strings.Trim(strings.TrimSpace(lines[i]), "`\"'«»")
		if candidate == "" {
			continue
		}
		// A sentence is not a name, however good the sentence: the cap is what
		// keeps a paragraph from becoming a forty-word branch.
		if utf8.RuneCountInString(candidate) > 64 || strings.Contains(candidate, " ") && len(strings.Fields(candidate)) > 6 {
			return ""
		}
		return candidate
	}
	return ""
}
