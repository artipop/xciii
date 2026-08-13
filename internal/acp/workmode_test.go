package acp

import (
	"context"
	"testing"
)

// How work in a repository is arranged is the board's answer, because it is
// what the board's routes are built out of — and the folder has the last word,
// since a folder with no git has no branch to give anybody.
func TestTheBoardSaysHowWorkInARepositoryIsArranged(t *testing.T) {
	repo := initTestWorkdir(t)
	notes := t.TempDir()
	m, _, _ := storeManager(t)
	m.rootCtx = context.Background()

	// A board nobody has asked follows the machine's own old setting, so an
	// install that never sees this screen keeps working the way it did.
	if got := m.WorkModeFor("board1", repo); got != WorkModeWorktree {
		t.Errorf("a board that was never asked works %q, want %q", got, WorkModeWorktree)
	}
	m.cfg.WorktreeMode = "never"
	if got := m.WorkModeFor("board1", repo); got != WorkModeBranch {
		t.Errorf("worktreeMode never reads as %q, want %q", got, WorkModeBranch)
	}

	// The board's own answer wins over the machine's, and is written onto the
	// board — where it travels with it.
	if _, err := m.SetBoardGitPolicy("board1", GitPolicy{Mode: WorkModeWorktree}); err != nil {
		t.Fatal(err)
	}
	if got := m.WorkModeFor("board1", repo); got != WorkModeWorktree {
		t.Errorf("the board asked for %q and got %q", WorkModeWorktree, got)
	}
	if got := m.WorkModeFor("board2", repo); got != WorkModeBranch {
		t.Errorf("another board reads %q, want the machine default it never overrode", got)
	}

	// An ordinary folder is worked in as it stands, whatever the board says:
	// there is no branch to make in it.
	if got := m.WorkModeFor("board1", notes); got != WorkModePlain {
		t.Errorf("a folder with no git works %q, want %q", got, WorkModePlain)
	}

	// Only the two answers exist. A third would be a rule about which of them
	// wins, and there is nothing to win.
	if _, err := m.SetBoardGitPolicy("board1", GitPolicy{Mode: "never"}); err == nil {
		t.Error("an unknown mode was accepted")
	}
}

// The answer lives on the board, so a board carried to another machine brings
// it, and the machine's own file keeps nothing about that board.
func TestTheGitPolicyIsSavedOnTheBoard(t *testing.T) {
	m, meta, cfgPath := storeManager(t)

	if _, err := m.SetBoardGitPolicy("board1", GitPolicy{Mode: WorkModeBranch, BranchPrefix: "task/"}); err != nil {
		t.Fatal(err)
	}
	saved := boardGitFrom(meta.written["board1"])
	if saved.Mode != WorkModeBranch || saved.Prefix() != "task/" {
		t.Errorf("the board was told %+v", saved)
	}
	if got := storedConfig(t, cfgPath).BoardGit["board1"].Mode; got != "" {
		t.Errorf("the machine's file also kept %q for that board", got)
	}

	// And a board that carries an answer is believed when it is read: this is
	// how the setting arrives on a second machine.
	other, _, _ := storeManager(t)
	other.adoptGitPolicy("board1", saved)
	if got := other.BoardGitPolicy("board1"); got.Mode != WorkModeBranch || got.Prefix() != "task/" {
		t.Errorf("the second machine read %+v off the board", got)
	}
}
