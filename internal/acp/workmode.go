package acp

import (
	"errors"
	"strings"
)

var (
	errNoBoard     = errors.New("не указана доска")
	errBadWorkMode = errors.New("способ работы в репозитории — «worktree» (своя копия на карточку) или «branch» (ветка в самой папке)")
)

// How work in a folder is arranged. A folder is what an agent is sent into; the
// mode is what that means when the folder is a repository, and it is the
// board's answer rather than the machine's — it decides what the board's routes
// can be built out of. A board whose QA stage checks the card's own code before
// anything is merged needs a copy per card; a monorepo nobody can run twice
// wants one card at a time on a branch of its own.
//
// There is no third answer for a repository. "Work in it as it stands, on
// whatever branch is checked out" was `worktreeMode: never`, and it is what an
// ordinary folder does anyway — offering it for a repository as well would make
// "which of the two decides" a rule instead of a fact.
const (
	// WorkModePlain is an ordinary folder: the agent works in it, and there is
	// no branch. What every folder that is not a repository does, whatever the
	// board says.
	WorkModePlain = "plain"
	// WorkModeBranch is a branch in the folder itself: one card at a time,
	// and the person's own checkout moves with it.
	WorkModeBranch = "branch"
	// WorkModeWorktree is a copy of its own per card, on a branch of its own:
	// several cards of one repository at once, and the person's checkout is
	// left alone.
	WorkModeWorktree = "worktree"
)

// GitPolicy is what a board does with a folder that is a repository. It lives
// on the board (BoardPropGit), because it shapes the board's routes — and not
// in config.json, where only what the machine owns belongs: where the copies go
// on disk (WorktreeDir) is the machine's business, how work is arranged is not.
type GitPolicy struct {
	// Mode is WorkModeWorktree or WorkModeBranch. Anything else — including
	// empty, which is a board that has never been asked — falls back to the
	// machine's own default (Config.WorktreeMode).
	Mode string `json:"mode,omitempty"`
	// BranchPrefix is what the branches this board makes are called — "feature/",
	// say. Empty is the default, and the default is nothing at all.
	BranchPrefix string `json:"branchPrefix,omitempty"`
}

// DefaultBranchPrefix is what a card's branch is named with when the board does
// not say: nothing. It was `acp/` while the branch was the agent integration's
// own bookkeeping; the branch is the card's work, and a person reading `git
// branch` should see what the work is, not which program made it. Branches
// already made keep their names — a branch is remembered by name, per card
// (workdir_claim), and nothing re-derives one.
const DefaultBranchPrefix = ""

// Prefix is the branch prefix this policy asks for.
func (p GitPolicy) Prefix() string {
	return strings.TrimSpace(p.BranchPrefix)
}

// BoardGitPolicy is the board's answer, with the machine's default filled in
// for a board that has not been asked. `worktreeMode: never` becomes
// WorkModeBranch: a repository always means a branch now, and the install that
// asked for "never" asked for "not a copy per card", which is what it gets.
func (m *Manager) BoardGitPolicy(boardID string) GitPolicy {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	return m.boardGitPolicyLocked(boardID)
}

func (m *Manager) boardGitPolicyLocked(boardID string) GitPolicy {
	p := m.cfg.BoardGit[boardID]
	switch strings.ToLower(strings.TrimSpace(p.Mode)) {
	case WorkModeWorktree:
		p.Mode = WorkModeWorktree
	case WorkModeBranch:
		p.Mode = WorkModeBranch
	default:
		p.Mode = WorkModeWorktree
		if !m.cfg.UseWorktrees() {
			p.Mode = WorkModeBranch
		}
	}
	return p
}

// SetBoardGitPolicy records how this board works in a repository, on the board
// itself.
func (m *Manager) SetBoardGitPolicy(boardID string, p GitPolicy) (GitPolicy, error) {
	if strings.TrimSpace(boardID) == "" {
		return GitPolicy{}, errNoBoard
	}
	mode := strings.ToLower(strings.TrimSpace(p.Mode))
	if mode != WorkModeWorktree && mode != WorkModeBranch {
		return GitPolicy{}, errBadWorkMode
	}
	m.listenBeforeSpeaking(boardID)

	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	if m.cfg.BoardGit == nil {
		m.cfg.BoardGit = map[string]GitPolicy{}
	}
	saved := GitPolicy{Mode: mode, BranchPrefix: strings.TrimSpace(p.BranchPrefix)}
	m.cfg.BoardGit[boardID] = saved
	return saved, m.saveBoardsLocked(boardID)
}

// WorkModeFor is how work in this folder is arranged for this board: what the
// board asked for, unless the folder cannot carry a branch at all. The folder
// decides first because the board's answer is about repositories — a board of
// household notes has the same policy as any other and never notices it.
func (m *Manager) WorkModeFor(boardID, workdir string) string {
	if strings.TrimSpace(workdir) == "" || !IsGitWorkdir(m.rootCtx, workdir) {
		return WorkModePlain
	}
	return m.BoardGitPolicy(boardID).Mode
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
