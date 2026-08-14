package acp

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

// A workspace is what a folder hands out: a directory to work in and, when the
// folder is a repository, a branch of its own. One entry point, because who is
// asking must not change the answer — a session, a terminal beside it and the
// next stage of the route all get the same workspace, and that is the whole
// point of it belonging to the *owner* rather than to the run.
//
// Owner is a card id, or "board:<id>" for a conversation with no card. It is
// the key everything hangs off: the branch is named after it, the copy on disk
// is named after it, and a folder held in branch mode is held by it.

// Workspace is where work happens and what it is called.
type Workspace struct {
	// Cwd is the directory to run in — the copy, or the folder itself.
	Cwd string
	// Branch is empty for an ordinary folder, which has none.
	Branch string
	// Base is what the branch was cut from, and what "merged" means for it.
	Base string
	// Mode is which of the three this is (WorkModePlain and the rest).
	Mode string
	// Fresh says this call created it, rather than handing back one the owner
	// already had.
	Fresh bool
}

// WorkSpec is a request for one.
type WorkSpec struct {
	// Workdir is the folder's path, as the registry has it.
	Workdir string
	// Owner is the card, or "board:<id>".
	Owner string
	// BoardID is the board the card is on: how this folder is worked in *here*
	// (WorkMode), and what the branch is written onto.
	BoardID string
	// Title is what the branch is named after; the card's, usually.
	Title string
	// Agent and Task feed branch naming when the machine asks the agent for a
	// name (naming.go). Both optional: without them the title is the name.
	Agent *AgentEntry
	Task  string
}

// The two refusals a caller has to tell apart, because neither is a failure of
// the work: they are the folder saying "not now", and the answer is to wait or
// to say so on the card (a stall), never to fail the card's task.
var (
	errWorkdirBusy  = errors.New("папка занята другой карточкой")
	errWorkdirDirty = errors.New("в папке есть несохранённые изменения")
)

// BoardOwner is the owner of a conversation that has no card: the board's own,
// so that «черновики доски» and a planning terminal are one thing rather than a
// row per window.
func BoardOwner(boardID string) string { return "board:" + boardID }

// ClaimWorkspace gives the owner its workspace in this folder, making it the
// first time and handing back the same one after that.
func (m *Manager) ClaimWorkspace(spec WorkSpec) (Workspace, error) {
	workdir := strings.TrimSpace(spec.Workdir)
	if workdir == "" || strings.TrimSpace(spec.Owner) == "" {
		return Workspace{}, fmt.Errorf("рабочее место требует папки и владельца")
	}
	mode := m.WorkModeFor(spec.BoardID, workdir)
	if mode == WorkModePlain {
		// Nothing is created and nothing is recorded: an ordinary folder is
		// worked in as it stands, by whoever opens it.
		return Workspace{Cwd: workdir, Mode: mode}, nil
	}

	if held, ok := m.heldWorkspace(workdir, spec.Owner, mode); ok {
		return held, nil
	}

	// What the branch is named after: the agent's answer when the machine is
	// set to ask for one, else the card's own title (transliterated by the
	// slug). The owner's tail stays either way — names must not collide.
	title := spec.Title
	if named := m.agentBranchName(spec, workdir); named != "" {
		title = named
	}
	branch := WorkspaceBranch(m.BranchPrefixFor(workdir), title, spec.Owner)
	base := m.BaseBranchFor(workdir)

	var (
		info WorktreeInfo
		err  error
	)
	switch mode {
	case WorkModeWorktree:
		info, err = CreateWorktree(m.rootCtx, workdir, branch, base, WorkspacePath(m.cfg.WorktreeDir, workdir, spec.Owner))
	case WorkModeBranch:
		if err := m.folderIsFree(workdir, spec.Owner); err != nil {
			return Workspace{}, err
		}
		clean, cerr := WorkdirIsClean(m.rootCtx, workdir)
		if cerr != nil {
			return Workspace{}, cerr
		}
		if !clean {
			return Workspace{}, fmt.Errorf("%w: %s", errWorkdirDirty, workdir)
		}
		info, err = SwitchToBranch(m.rootCtx, workdir, branch, base)
	}
	if err != nil {
		return Workspace{}, err
	}

	ws := Workspace{Cwd: info.Path, Branch: info.Branch, Base: info.BaseRef, Mode: mode, Fresh: true}
	m.recordClaim(workdir, spec.Owner, ws)
	m.writeCardBranch(spec, ws.Branch)
	return ws, nil
}

// writeCardBranch puts the branch on the card. The card is where it belongs:
// it survives the card being carried to another board (MoveCardToBoard) or
// opened on another machine, it can be searched and filtered, and a deploy
// already reads a branch off the card before anything of ours. The path of the
// copy is deliberately not written — a path means nothing on another machine.
func (m *Manager) writeCardBranch(spec WorkSpec, branch string) {
	if branch == "" || m.writer == nil || m.meta == nil || spec.BoardID == "" {
		return
	}
	// The owner is the card only when there is one; a conversation with no card
	// has nowhere to write.
	if strings.HasPrefix(spec.Owner, "board:") {
		return
	}
	propID := m.boardBranchProperty(spec.BoardID)
	if propID == "" {
		return
	}
	ctx, cancel := context.WithTimeout(m.rootCtx, 10*time.Second)
	defer cancel()
	if err := m.writer.SetCardText(ctx, spec.Owner, propID, branch); err != nil {
		m.log.Warn("acp: cannot write the branch on the card", "card", spec.Owner, "err", err)
	}
}

// boardBranchProperty is the id of the board's branch field, if it has one.
func (m *Manager) boardBranchProperty(boardID string) string {
	ctx, cancel := context.WithTimeout(m.rootCtx, 10*time.Second)
	defer cancel()
	props, err := m.meta.BoardProperties(ctx, boardID)
	if err != nil {
		return ""
	}
	raw, ok := boardProp(props, BoardPropBranch)
	if !ok {
		return ""
	}
	id, _ := raw.(string)
	return strings.TrimSpace(id)
}

// heldWorkspace is the workspace this owner already has here, put back in
// working order. A copy whose directory is gone is remade from its branch —
// which is what happens after a finished card's copy was folded away, and what
// makes folding it away safe.
func (m *Manager) heldWorkspace(workdir, owner, mode string) (Workspace, bool) {
	if m.store == nil {
		return Workspace{}, false
	}
	c, ok, err := m.store.WorkspaceOf(workdir, owner)
	if err != nil {
		m.log.Warn("acp: cannot read the folder's workspaces", "workdir", workdir, "err", err)
		return Workspace{}, false
	}
	if !ok {
		return Workspace{}, false
	}
	// Whatever the folder says *now*, a card that already has a workspace keeps
	// it: its work is in there. Changing how a repository is worked in is an
	// answer about the cards to come, not a reason to take a running card's
	// branch away and hand it another — which is what re-deciding here did,
	// leaving the copy on disk with nothing pointing at it.
	ws := Workspace{Cwd: c.Path, Branch: c.Branch, Base: c.Base, Mode: c.Mode}
	if c.Mode != WorkModeWorktree {
		return ws, true
	}
	if info, err := os.Stat(c.Path); err == nil && info.IsDir() {
		return ws, true
	}
	// The directory is gone; the branch is not. Putting the copy back is one
	// git command, and losing the branch would be losing the work.
	remade, err := CreateWorktree(m.rootCtx, workdir, c.Branch, c.Base, c.Path)
	if err != nil {
		m.log.Warn("acp: cannot restore the card's copy", "workdir", workdir, "branch", c.Branch, "err", err)
		return Workspace{}, false
	}
	ws.Cwd = remade.Path
	return ws, true
}

// folderIsFree refuses a folder somebody else is working in. Only branch mode
// asks: a copy per card is exactly what makes the question unnecessary.
func (m *Manager) folderIsFree(workdir, owner string) error {
	if m.store == nil {
		return nil
	}
	held, ok, err := m.store.WorkdirHeldBy(workdir)
	if err != nil || !ok || held.Owner == owner {
		return err
	}
	// The reason says what will end it, because that is the only thing a
	// person reading it off the card can act on.
	return fmt.Errorf("%w (%s) — освободится, когда её ветка будет влита в основную", errWorkdirBusy, held.Owner)
}

func (m *Manager) recordClaim(workdir, owner string, ws Workspace) {
	if m.store == nil {
		return
	}
	if err := m.store.ClaimWorkdir(WorkspaceClaim{
		Workdir: workdir,
		Owner:   owner,
		Mode:    ws.Mode,
		Branch:  ws.Branch,
		Path:    ws.Cwd,
		Base:    ws.Base,
	}); err != nil {
		m.log.Warn("acp: cannot record the workspace", "workdir", workdir, "owner", owner, "err", err)
	}
}

// ReleaseWorkspace gives the folder back. In branch mode that is what lets the
// next card in; in worktree mode it only says the card is done with it, since
// nothing was ever held.
func (m *Manager) ReleaseWorkspace(workdir, owner string) {
	if m.store == nil {
		return
	}
	if err := m.store.ReleaseWorkdir(workdir, owner); err != nil {
		m.log.Warn("acp: cannot release the folder", "workdir", workdir, "owner", owner, "err", err)
	}
}

// ReleaseMergedBranch frees whatever workspace was on this branch. The watcher
// calls it when a branch is merged, which is the moment the work in it is over
// — and, in branch mode, the moment the folder is somebody else's turn.
func (m *Manager) ReleaseMergedBranch(workdir, branch string) {
	if m.store == nil || strings.TrimSpace(branch) == "" {
		return
	}
	owner, err := m.store.ReleaseBranch(workdir, branch)
	if err != nil {
		m.log.Warn("acp: cannot release the merged branch", "workdir", workdir, "branch", branch, "err", err)
		return
	}
	if owner != "" {
		m.log.Info("acp: the folder is free again", "workdir", workdir, "branch", branch, "owner", owner)
	}
}

// WorkspaceModeForCard is which of the two arrangements this card's workspace
// is, for the surfaces that say it out loud. Empty for a card with none — an
// ordinary folder records no claim.
func (m *Manager) WorkspaceModeForCard(cardID string) string {
	if m.store == nil || cardID == "" {
		return ""
	}
	mode, err := m.store.WorkspaceModeForOwner(cardID)
	if err != nil {
		m.log.Warn("acp: cannot read the card's workspace mode", "card", cardID, "err", err)
		return ""
	}
	return mode
}
