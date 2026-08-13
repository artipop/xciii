package acp

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/artipop/xciii/internal/dokku"
)

// WorktreeInfo describes a session's dedicated git worktree.
type WorktreeInfo struct {
	Path    string
	Branch  string
	BaseRef string
}

// worktreeLocks serializes worktree creation per workdir to avoid
// concurrent git index locks.
var worktreeLocks sync.Map // workdir path → *sync.Mutex

func repoLock(workdir string) *sync.Mutex {
	mu, _ := worktreeLocks.LoadOrStore(workdir, &sync.Mutex{})
	return mu.(*sync.Mutex)
}

func gitCmd(ctx context.Context, workdir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", workdir}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}

// IsGitWorkdir reports whether a workdir is under git. Not every one is: a
// board of household chores sends an agent into a folder of notes, and asking
// somebody to run `git init` on their notes before the app will look at them is
// asking them to learn git for the sake of a shopping list. What git buys —
// worktrees, branches, and every transition that waits for one — is offered to
// the folders that have it and quietly absent from the ones that do not.
//
// It is asked at the moment it matters rather than recorded on the entry: a
// folder can become a workdir later, and one that was may stop being one.
func IsGitWorkdir(ctx context.Context, workdir string) bool {
	if strings.TrimSpace(workdir) == "" {
		return false
	}
	// Callers reach this from the UI as well as from the trigger loop, and the
	// manager's context does not exist until it starts: a nil one is a panic in
	// exec.CommandContext rather than a timeout.
	if ctx == nil {
		ctx = context.Background()
	}
	_, err := gitCmd(ctx, workdir, "rev-parse", "--git-dir")
	return err == nil
}

// DefaultBaseBranch is what to put in a folder's base-branch setting when it is
// added, and what to fall back on for an entry added before that setting
// existed: the remote's own idea of its main branch first, since that is the
// one a merge lands on, then whatever is checked out. A literal "main" would be
// wrong for half the repositories in the world, so there is no guess — an empty
// answer means the caller falls back to HEAD, which is what the worktree code
// already did.
func DefaultBaseBranch(ctx context.Context, workdir string) string {
	if ctx == nil {
		ctx = context.Background()
	}
	if out, err := gitCmd(ctx, workdir, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"); err == nil {
		if b := strings.TrimPrefix(strings.TrimSpace(out), "origin/"); b != "" {
			return b
		}
	}
	if out, err := gitCmd(ctx, workdir, "rev-parse", "--abbrev-ref", "HEAD"); err == nil && out != "HEAD" {
		return strings.TrimSpace(out)
	}
	return ""
}

// CreateWorktree adds a worktree at path, on branch, cut from baseBranch (or
// HEAD when empty). A branch that already exists is checked out into the new
// directory rather than made again — which is what puts a card's work back
// after its copy was folded away.
func CreateWorktree(ctx context.Context, workdir, branch, baseBranch, path string) (WorktreeInfo, error) {
	mu := repoLock(workdir)
	mu.Lock()
	defer mu.Unlock()

	if _, err := gitCmd(ctx, workdir, "rev-parse", "--git-dir"); err != nil {
		return WorktreeInfo{}, fmt.Errorf("%s is not a git workdir: %w", workdir, err)
	}

	baseRef := strings.TrimSpace(baseBranch)
	if baseRef == "" {
		baseRef = "HEAD"
	} else if _, err := gitCmd(ctx, workdir, "rev-parse", "--verify", baseRef); err != nil {
		return WorktreeInfo{}, fmt.Errorf("base branch %q not found in %s", baseRef, workdir)
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return WorktreeInfo{}, err
	}
	args := []string{"worktree", "add", "-b", branch, path, baseRef}
	if branchExists(ctx, workdir, branch) {
		args = []string{"worktree", "add", path, branch}
	}
	if _, err := gitCmd(ctx, workdir, args...); err != nil {
		return WorktreeInfo{}, err
	}
	return WorktreeInfo{Path: path, Branch: branch, BaseRef: baseRef}, nil
}

// SwitchToBranch puts the folder itself on branch, making it off baseBranch if
// it does not exist yet. This is the other way to work in a repository, and it
// moves the person's own checkout — which is why the caller has to have checked
// that nothing is uncommitted (WorkdirIsClean) and that nobody else holds the
// folder.
func SwitchToBranch(ctx context.Context, workdir, branch, baseBranch string) (WorktreeInfo, error) {
	mu := repoLock(workdir)
	mu.Lock()
	defer mu.Unlock()

	if _, err := gitCmd(ctx, workdir, "rev-parse", "--git-dir"); err != nil {
		return WorktreeInfo{}, fmt.Errorf("%s is not a git workdir: %w", workdir, err)
	}
	baseRef := strings.TrimSpace(baseBranch)
	if baseRef == "" {
		baseRef = "HEAD"
	}
	if branchExists(ctx, workdir, branch) {
		if _, err := gitCmd(ctx, workdir, "switch", branch); err != nil {
			return WorktreeInfo{}, err
		}
	} else if _, err := gitCmd(ctx, workdir, "switch", "-c", branch, baseRef); err != nil {
		return WorktreeInfo{}, err
	}
	return WorktreeInfo{Path: workdir, Branch: branch, BaseRef: baseRef}, nil
}

// WorkdirIsClean reports that nothing is uncommitted in the folder. Asked
// before the folder's own checkout is moved: switching under somebody's
// unsaved work is the one thing this must never do.
func WorkdirIsClean(ctx context.Context, workdir string) (bool, error) {
	out, err := gitCmd(ctx, workdir, "status", "--porcelain")
	if err != nil {
		return false, err
	}
	return out == "", nil
}

func branchExists(ctx context.Context, workdir, branch string) bool {
	_, err := gitCmd(ctx, workdir, "rev-parse", "--verify", "--quiet", "refs/heads/"+branch)
	return err == nil
}

// RemoveWorktreeIfClean removes the worktree (and its branch) only when it has
// no uncommitted changes and no commits ahead of its base ref.
func RemoveWorktreeIfClean(ctx context.Context, workdir string, w WorktreeInfo) (bool, error) {
	mu := repoLock(workdir)
	mu.Lock()
	defer mu.Unlock()

	status, err := gitCmd(ctx, w.Path, "status", "--porcelain")
	if err != nil {
		return false, err
	}
	if status != "" {
		return false, nil
	}
	ahead, err := gitCmd(ctx, w.Path, "rev-list", "--count", w.BaseRef+"..HEAD")
	if err == nil && ahead != "0" {
		return false, nil
	}
	if _, err := gitCmd(ctx, workdir, "worktree", "remove", "--force", w.Path); err != nil {
		return false, err
	}
	_, _ = gitCmd(ctx, workdir, "branch", "-D", w.Branch)
	return true, nil
}

// FoldWorktree puts a copy away and keeps its branch: the work is committed,
// so the branch is the product and the directory is only where it was made.
// The next terminal on that card remakes the copy from the branch, which is
// what makes this safe — and why it refuses when anything is uncommitted, since
// that is the one state no branch is holding.
func FoldWorktree(ctx context.Context, workdir string, w WorktreeInfo) (bool, error) {
	if w.Path == "" || w.Path == workdir {
		return false, nil
	}
	mu := repoLock(workdir)
	mu.Lock()
	defer mu.Unlock()

	status, err := gitCmd(ctx, w.Path, "status", "--porcelain")
	if err != nil || status != "" {
		return false, err
	}
	if _, err := gitCmd(ctx, workdir, "worktree", "remove", w.Path); err != nil {
		return false, err
	}
	return true, nil
}

// PruneStale runs `git worktree prune` on every known workdir, cleaning up
// records of worktrees whose directories are gone.
func PruneStale(ctx context.Context, workdirs []string) {
	for _, workdir := range workdirs {
		_, _ = gitCmd(ctx, workdir, "worktree", "prune")
	}
}

// WorkspaceBranch names the branch after the card it belongs to:
// "Login via SSO" → login-via-sso-1a2b. The branch is what the card shows
// and what a deploy publishes, so it ends up in a preview hostname — hence the
// same folding a Dokku app name gets (dokku.AppSlug: lowercase, [a-z0-9-], cut
// with a hash), and a blank title falls back to the owner's own id. A title
// with no ASCII in it keeps only what folding leaves, which for a fully
// non-Latin title is AppSlug's hash: unreadable, but valid and unique.
//
// The tail is the *owner's* short id, not the run's. A card is one piece of
// work: its stages, and the terminals a person opens beside them, share one
// branch. Naming it after the session was what made a card that travelled a
// three-stage route leave three branches and three checkouts behind — and put
// the conversation in a different copy from the session that was running.
func WorkspaceBranch(prefix, title, owner string) string {
	slug := dokku.AppSlug(title)
	if strings.TrimSpace(title) == "" {
		slug = shortID(owner)
	}
	return fmt.Sprintf("%s%s-%s", prefix, slug, shortID(owner))
}

// WorkspacePath is where a card's copy of a folder lives: under the machine's
// worktree directory, named after the folder and the owner, so two cards of one
// repository never land in the same place.
func WorkspacePath(root, workdir, owner string) string {
	return filepath.Join(root, fmt.Sprintf("%s-%s", filepath.Base(workdir), shortID(owner)))
}

func shortID(id string) string {
	id = strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			return r
		}
		return -1
	}, id)
	if len(id) > 8 {
		return id[:8]
	}
	if id == "" {
		return "x"
	}
	return id
}
