package acp

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func initTestWorkdir(t *testing.T) string {
	t.Helper()
	workdir := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", workdir}, args...)...)
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, out)
		}
	}
	run("init", "-b", "main")
	if err := os.WriteFile(filepath.Join(workdir, "README.md"), []byte("hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", ".")
	run("commit", "-m", "init")
	return workdir
}

func TestWorkspaceBranchNamesTheCard(t *testing.T) {
	// The readable case: the branch (and so the preview address) says what the
	// card is about.
	got := WorkspaceBranch("", "Login via SSO", "card-1234abcd")
	if !strings.HasPrefix(got, "login-via-sso-") {
		t.Errorf("branch %q, want it named after the title", got)
	}

	// Two cards with the same title must not share a branch.
	if WorkspaceBranch("", "Same", "card-a") == WorkspaceBranch("", "Same", "card-b") {
		t.Error("two cards with one title collided on a branch")
	}
	// One card is one branch, however many times it is asked for: a card that
	// travels a three-stage route used to leave three of them, and its
	// terminal used to sit on a fourth.
	if WorkspaceBranch("", "Same", "card-a") != WorkspaceBranch("", "Same", "card-a") {
		t.Error("one card was given two branches")
	}

	// Nothing is prefixed unless the board asks for one: a branch says what
	// the work is, not which program made it.
	if got := WorkspaceBranch("", "Same", "card-a"); strings.Contains(got, "/") {
		t.Errorf("branch %q carries a prefix nobody asked for", got)
	}
	if got := WorkspaceBranch("task/", "Same", "card-a"); !strings.HasPrefix(got, "task/") {
		t.Errorf("branch %q ignores the board's own prefix", got)
	}

	// A blank title falls back to the owner, a non-Latin one to whatever
	// folding leaves; both must still be a valid ref of the same shape.
	for _, name := range []string{WorkspaceBranch("", "", "card-1234abcd"), WorkspaceBranch("", "Задача", "card-1234abcd")} {
		if name == "" || strings.ContainsAny(name, " ~^:?*[\\") {
			t.Errorf("branch %q is not a usable ref", name)
		}
	}
}

func TestCreateWorktreeNamingAndBase(t *testing.T) {
	workdir := initTestWorkdir(t)
	root := t.TempDir()
	ctx := context.Background()

	branch := WorkspaceBranch("", "Логин через SSO", "card-1234abcd")
	path := WorkspacePath(root, workdir, "card-1234abcd")
	wt, err := CreateWorktree(ctx, workdir, branch, "", path)
	if err != nil {
		t.Fatal(err)
	}
	if wt.Branch != branch {
		t.Errorf("worktree is on %q, want the card's branch %q", wt.Branch, branch)
	}
	if !strings.HasPrefix(wt.Path, root) {
		t.Errorf("worktree path %q outside root %q", wt.Path, root)
	}
	if _, err := os.Stat(filepath.Join(wt.Path, "README.md")); err != nil {
		t.Errorf("worktree missing checked-out file: %v", err)
	}
}

func TestCreateWorktreeBadBase(t *testing.T) {
	workdir := initTestWorkdir(t)
	if _, err := CreateWorktree(context.Background(), workdir, "some-card", "no-such-branch", filepath.Join(t.TempDir(), "wt")); err == nil {
		t.Fatal("expected error for missing base branch")
	}
}

func TestRemoveWorktreeCleanVsDirty(t *testing.T) {
	workdir := initTestWorkdir(t)
	ctx := context.Background()

	clean, err := CreateWorktree(ctx, workdir, "clean-card", "", filepath.Join(t.TempDir(), "wt"))
	if err != nil {
		t.Fatal(err)
	}
	removed, err := RemoveWorktreeIfClean(ctx, workdir, clean)
	if err != nil || !removed {
		t.Fatalf("clean worktree should be removed: removed=%v err=%v", removed, err)
	}

	dirty, err := CreateWorktree(ctx, workdir, "dirty-card", "", filepath.Join(t.TempDir(), "wt"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dirty.Path, "new.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	removed, err = RemoveWorktreeIfClean(ctx, workdir, dirty)
	if err != nil {
		t.Fatal(err)
	}
	if removed {
		t.Fatal("dirty worktree must be kept")
	}
	if _, err := os.Stat(dirty.Path); err != nil {
		t.Fatalf("dirty worktree directory vanished: %v", err)
	}
}

func TestConcurrentWorktreeCreation(t *testing.T) {
	workdir := initTestWorkdir(t)
	root := t.TempDir()
	var wg sync.WaitGroup
	errs := make([]error, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			owner := "card" + string(rune('a'+i))
			_, errs[i] = CreateWorktree(context.Background(), workdir,
				WorkspaceBranch("", "card", owner), "", WorkspacePath(root, workdir, owner))
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Errorf("concurrent worktree %d: %v", i, err)
		}
	}
}
