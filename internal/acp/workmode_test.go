package acp

import (
	"context"
	"path/filepath"
	"testing"
)

// How a repository is worked in is asked of the folder on the board that offers
// it. A folder belongs to one board anyway, so that reads as the folder's own
// answer; the folder marked «на всех досках» is the case the board key earns.
func TestTheFolderSaysHowItIsWorkedInOnThisBoard(t *testing.T) {
	repo := initTestWorkdir(t)
	notes := t.TempDir()
	m := registryManager(t, filepath.Join(t.TempDir(), "config.json"))
	m.rootCtx = context.Background()
	if _, err := m.AddWorkdir("code", repo, "board1", WorkdirGit, false); err != nil {
		t.Fatal(err)
	}
	if _, err := m.AddWorkdir("notes", notes, "board1", "", false); err != nil {
		t.Fatal(err)
	}

	// A folder nobody has asked follows the machine's own old setting, so an
	// install that never sees this screen keeps working the way it did.
	if got := m.WorkModeFor("board1", repo); got != WorkModeWorktree {
		t.Errorf("a folder that was never asked works %q, want %q", got, WorkModeWorktree)
	}
	m.cfg.WorktreeMode = "never"
	if got := m.WorkModeFor("board1", repo); got != WorkModeBranch {
		t.Errorf("worktreeMode never reads as %q, want %q", got, WorkModeBranch)
	}

	// The folder's own answer wins on the board it was given for, and another
	// board that shares the folder is not bound by it.
	if _, err := m.SetWorkdirMode("code", "board1", WorkModeWorktree); err != nil {
		t.Fatal(err)
	}
	if got := m.WorkModeFor("board1", repo); got != WorkModeWorktree {
		t.Errorf("the folder asked for %q and got %q", WorkModeWorktree, got)
	}
	if got := m.WorkModeFor("board2", repo); got != WorkModeBranch {
		t.Errorf("another board reads %q, want the machine default it never overrode", got)
	}

	// An ordinary folder is worked in as it stands: there is no branch to make.
	if got := m.WorkModeFor("board1", notes); got != WorkModePlain {
		t.Errorf("a folder with no git works %q, want %q", got, WorkModePlain)
	}

	// Only the two answers exist. A third would be a rule about which of them
	// wins, and there is nothing to win.
	if _, err := m.SetWorkdirMode("code", "board1", "never"); err == nil {
		t.Error("an unknown mode was accepted")
	}

	// And the listing says the resolved answer, so a screen can draw which of
	// the two a folder does without knowing the machine's default.
	for _, st := range m.WorkdirStatusesForBoard("board1") {
		want := WorkModeWorktree
		if st.Name == "notes" {
			want = WorkModePlain
		}
		if st.Mode != want {
			t.Errorf("%s reads as %q, want %q", st.Name, st.Mode, want)
		}
	}
}

// A board that already carried the old answer keeps working the way it was set
// up: the answer moves onto the folders that board offers, and the key comes
// off the board so it is moved once.
func TestTheBoardsOldAnswerMovesOntoItsFolders(t *testing.T) {
	repo := initTestWorkdir(t)
	m, meta, _ := storeManager(t)
	m.rootCtx = context.Background()
	if _, err := m.AddWorkdir("code", repo, "board1", WorkdirGit, false); err != nil {
		t.Fatal(err)
	}
	meta.props = map[string]any{BoardPropGit: map[string]any{"mode": WorkModeBranch}}

	if moved := m.moveGitPolicyToWorkdirs("board1", meta.props); moved != 1 {
		t.Fatalf("moved %d folders, want the board's one", moved)
	}
	if got := m.WorkModeFor("board1", repo); got != WorkModeBranch {
		t.Errorf("the folder works %q, want the board's old answer %q", got, WorkModeBranch)
	}

	// A folder that already says how it is worked in is not overwritten, and a
	// board whose key is gone does nothing at all.
	if moved := m.moveGitPolicyToWorkdirs("board1", map[string]any{}); moved != 0 {
		t.Errorf("a board with no answer moved %d folders", moved)
	}
}
