package acp

import (
	"errors"
	"fmt"
	"strings"
)

// How work in a folder is arranged. A folder is what an agent is sent into; the
// mode is what that means when the folder is a repository, and it is asked of
// **the folder, on the board that offers it** (WorkdirEntry.Modes).
//
// Not of the board alone: one answer for every repository a board touches is
// wrong the moment a board has two of them. Not of the folder alone either: a
// folder marked «на всех досках» is one entry seen from several boards, and the
// board where three people work it wants a copy per card while the board where
// one person does may not. A folder belongs to one board anyway, so for almost
// every entry there is exactly one answer and it reads as the folder's own.
//
// There is no third answer for a repository. "Work in it as it stands, on
// whatever branch is checked out" was `worktreeMode: never`, and it is what an
// ordinary folder does anyway — offering it for a repository as well would make
// "which of the two decides" a rule instead of a fact.
const (
	// WorkModePlain is an ordinary folder: the agent works in it, and there is
	// no branch. What every folder that is not a repository does, whatever the
	// registry says.
	WorkModePlain = "plain"
	// WorkModeBranch is a branch in the folder itself: one card at a time,
	// and the person's own checkout moves with it.
	WorkModeBranch = "branch"
	// WorkModeWorktree is a copy of its own per card, on a branch of its own:
	// several cards of one repository at once, and the person's checkout is
	// left alone.
	WorkModeWorktree = "worktree"
)

var errNoBoard = errors.New("не указана доска")

var errBadWorkMode = errors.New("способ работы в репозитории — «worktree» (своя копия на карточку) или «branch» (ветка в самой папке)")

// DefaultBranchPrefix is what a card's branch is named with when the folder does
// not say: nothing. It was `acp/` while the branch was the agent integration's
// own bookkeeping; the branch is the card's work, and a person reading `git
// branch` should see what the work is, not which program made it.
const DefaultBranchPrefix = ""

// WorkMode is how work in this folder is arranged on this board: what the entry
// says for it, else the machine's own old default. An entry written before the
// setting existed carries nothing, and `worktreeMode: never` is the install
// that asked for "not a copy per card", which is what it gets.
func (m *Manager) WorkMode(boardID string, e WorkdirEntry) string {
	switch strings.ToLower(strings.TrimSpace(e.Modes[boardID])) {
	case WorkModeWorktree:
		return WorkModeWorktree
	case WorkModeBranch:
		return WorkModeBranch
	}
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	if !m.cfg.UseWorktrees() {
		return WorkModeBranch
	}
	return WorkModeWorktree
}

// WorkModeFor is that answer for a path, with the folder having the last word:
// a folder that is not a repository is worked in as it stands, whatever the
// registry says about it.
func (m *Manager) WorkModeFor(boardID, workdir string) string {
	if strings.TrimSpace(workdir) == "" || !IsGitWorkdir(m.rootCtx, workdir) {
		return WorkModePlain
	}
	e, _ := m.WorkdirByPath(workdir)
	return m.WorkMode(boardID, e)
}

// SetWorkdirMode records how this folder is worked in on one board.
func (m *Manager) SetWorkdirMode(name, boardID, mode string) (WorkdirEntry, error) {
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode != WorkModeWorktree && mode != WorkModeBranch {
		return WorkdirEntry{}, errBadWorkMode
	}
	if strings.TrimSpace(boardID) == "" {
		return WorkdirEntry{}, errNoBoard
	}
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	for i, r := range m.cfg.Workdirs {
		if !strings.EqualFold(r.Name, name) {
			continue
		}
		if m.cfg.Workdirs[i].Modes == nil {
			m.cfg.Workdirs[i].Modes = map[string]string{}
		}
		m.cfg.Workdirs[i].Modes[boardID] = mode
		return m.cfg.Workdirs[i], m.persistConfigLocked()
	}
	return WorkdirEntry{}, fmt.Errorf("папка %q не найдена", name)
}

// BranchPrefixFor is what the branches made in this folder are called.
func (m *Manager) BranchPrefixFor(workdir string) string {
	e, ok := m.WorkdirByPath(workdir)
	if !ok {
		return DefaultBranchPrefix
	}
	return strings.TrimSpace(e.BranchPrefix)
}

// WorkdirByPath finds the registry entry a path belongs to. A folder an agent
// was sent into is always a registry entry — resolveWorkdir has no other source
// — but a session started before the entry was removed still has to answer.
func (m *Manager) WorkdirByPath(path string) (WorkdirEntry, bool) {
	clean := strings.TrimSpace(path)
	if clean == "" {
		return WorkdirEntry{}, false
	}
	for _, e := range m.Workdirs() {
		if e.Path == clean {
			return e, true
		}
	}
	return WorkdirEntry{}, false
}

// BaseBranchFor is what work in this folder starts from: the registry entry's
// setting, else what git says. Empty means "whatever is checked out", which is
// what the worktree code falls back on.
func (m *Manager) BaseBranchFor(workdir string) string {
	if e, ok := m.WorkdirByPath(workdir); ok {
		return m.BaseBranchOf(e)
	}
	return DefaultBaseBranch(m.rootCtx, workdir)
}
