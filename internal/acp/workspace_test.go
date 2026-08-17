package acp

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// workspaceManager is a manager with a real store and a repository to work in.
func workspaceManager(t *testing.T) (*Manager, string) {
	t.Helper()
	dataDir := t.TempDir()
	cfg := DefaultConfig(dataDir)
	st, err := newTestStore(t, filepath.Join(dataDir, "acp.db"))
	if err != nil {
		t.Fatal(err)
	}
	m := NewManager(cfg, "", st, newFakeWriter(), &fakeEmitter{}, nil)
	m.rootCtx = context.Background()
	repo := initTestWorkdir(t)
	m.cfg.Workdirs = []WorkdirEntry{{Name: "code", Path: repo, BoardID: "board1", Kind: WorkdirGit, BaseBranch: "main"}}
	return m, repo
}

// A card is one piece of work: every stage of its route, and every terminal
// somebody opens beside them, work on the same branch in the same directory.
// Each run used to make its own, so a card that travelled a three-stage route
// left three branches — and the conversation about it sat in a copy the agent
// working on it never saw.
func TestOneCardIsOneWorkspace(t *testing.T) {
	m, repo := workspaceManager(t)
	spec := WorkSpec{Workdir: repo, Owner: "card-1", BoardID: "board1", Title: "Логин через SSO"}

	first, err := m.ClaimWorkspace(spec)
	if err != nil {
		t.Fatal(err)
	}
	if first.Mode != WorkModeWorktree || first.Branch == "" || !first.Fresh {
		t.Fatalf("the first claim gave %+v", first)
	}
	if first.Base != "main" {
		t.Errorf("branched from %q, want the folder's own base branch", first.Base)
	}

	// The next stage, and the terminal beside it.
	for _, again := range []string{"stage two", "the terminal"} {
		got, err := m.ClaimWorkspace(spec)
		if err != nil {
			t.Fatalf("%s: %v", again, err)
		}
		if got.Branch != first.Branch || got.Cwd != first.Cwd {
			t.Errorf("%s got %+v, want the card's own workspace %+v", again, got, first)
		}
		if got.Fresh {
			t.Errorf("%s made a second workspace", again)
		}
	}

	// And the card can say which arrangement it is in — the stamp names its
	// line after this, so the word on the card matches the setting.
	if got, _, _ := m.WorkspaceModeForCard("card-1"); got != WorkModeWorktree {
		t.Errorf("the card's workspace reads as %q, want %q", got, WorkModeWorktree)
	}

	// Another card of the same folder gets its own, which is the whole point
	// of a copy per card.
	other, err := m.ClaimWorkspace(WorkSpec{Workdir: repo, Owner: "card-2", BoardID: "board1", Title: "Другая"})
	if err != nil {
		t.Fatal(err)
	}
	if other.Branch == first.Branch || other.Cwd == first.Cwd {
		t.Errorf("two cards share one workspace: %+v and %+v", first, other)
	}
}

// The branch is the product and the copy is the workshop: once the work is
// committed the directory can be put away, and asking for the workspace again
// puts it back on the same branch.
func TestAFoldedCopyComesBackOnItsOwnBranch(t *testing.T) {
	m, repo := workspaceManager(t)
	spec := WorkSpec{Workdir: repo, Owner: "card-1", BoardID: "board1", Title: "Фича"}

	made, err := m.ClaimWorkspace(spec)
	if err != nil {
		t.Fatal(err)
	}
	folded, err := FoldWorktree(context.Background(), repo, WorktreeInfo{Path: made.Cwd, Branch: made.Branch, BaseRef: made.Base})
	if err != nil || !folded {
		t.Fatalf("a clean copy should fold away: folded=%v err=%v", folded, err)
	}
	if _, err := os.Stat(made.Cwd); err == nil {
		t.Fatal("the copy is still on disk")
	}

	back, err := m.ClaimWorkspace(spec)
	if err != nil {
		t.Fatal(err)
	}
	if back.Branch != made.Branch {
		t.Errorf("came back on %q, want the card's own branch %q", back.Branch, made.Branch)
	}
	if _, err := os.Stat(filepath.Join(back.Cwd, "README.md")); err != nil {
		t.Errorf("the copy was not put back: %v", err)
	}
}

// The other way to work in a repository: a branch in the folder itself. One
// card holds the folder, the next waits, and a merge is what hands it over.
func TestABranchInTheFolderIsHeldUntilItIsMerged(t *testing.T) {
	m, repo := workspaceManager(t)
	if _, err := m.SetWorkdirMode("code", "board1", WorkModeBranch); err != nil {
		t.Fatal(err)
	}

	first, err := m.ClaimWorkspace(WorkSpec{Workdir: repo, Owner: "card-1", BoardID: "board1", Title: "Первая"})
	if err != nil {
		t.Fatal(err)
	}
	if first.Mode != WorkModeBranch || first.Cwd != repo || first.Branch == "" {
		t.Fatalf("branch mode gave %+v", first)
	}
	// The folder's own checkout moved onto it — that is the whole difference
	// from a copy, and what the person sees in their editor.
	if got := DefaultBaseBranch(context.Background(), repo); got != first.Branch {
		t.Errorf("the folder is on %q, want the card's branch %q", got, first.Branch)
	}

	_, err = m.ClaimWorkspace(WorkSpec{Workdir: repo, Owner: "card-2", BoardID: "board1", Title: "Вторая"})
	if !errors.Is(err, errWorkdirBusy) {
		t.Fatalf("the second card got %v, want the folder to be held", err)
	}

	// Merged: the work is over, so the folder is the next card's.
	m.ReleaseMergedBranch(repo, first.Branch)
	second, err := m.ClaimWorkspace(WorkSpec{Workdir: repo, Owner: "card-2", BoardID: "board1", Title: "Вторая"})
	if err != nil {
		t.Fatalf("the folder was not handed over: %v", err)
	}
	if second.Branch == first.Branch {
		t.Errorf("the second card took the first one's branch %q", second.Branch)
	}
}

// Somebody's unsaved work is never switched out from under them — but an
// untracked file is not that: git carries it across a branch switch untouched,
// and every real checkout has one (a build directory, a scratch clone, an
// .env). Counting them meant a repository with a single untracked folder in it
// could never start a card.
func TestABranchIsRefusedOnlyForUnsavedTrackedWork(t *testing.T) {
	m, repo := workspaceManager(t)
	if _, err := m.SetWorkdirMode("code", "board1", WorkModeBranch); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(repo, "notes.txt"), []byte("half a thought\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := m.ClaimWorkspace(WorkSpec{Workdir: repo, Owner: "card-1", BoardID: "board1", Title: "Задача"}); err != nil {
		t.Fatalf("an untracked file stopped the card: %v", err)
	}

	// A tracked file with unsaved changes in it is the real case, and it does
	// stop: the switch would carry them onto the card's branch. Its own folder,
	// because the first one is held by the card that just took it.
	other, repo2 := workspaceManager(t)
	if _, err := other.SetWorkdirMode("code", "board1", WorkModeBranch); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo2, "README.md"), []byte("half a thought\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := other.ClaimWorkspace(WorkSpec{Workdir: repo2, Owner: "card-2", BoardID: "board1", Title: "Вторая"})
	if !errors.Is(err, errWorkdirDirty) {
		t.Fatalf("got %v, want the folder's unsaved changes to stop it", err)
	}
}

// The branch goes on the card, because that is where it survives: the card can
// be carried to another board, or opened on another machine, and a machine's
// own database travels with neither.
func TestTheBranchIsWrittenOnTheCard(t *testing.T) {
	m, repo := workspaceManager(t)
	writer := m.writer.(*fakeWriter)
	m.SetBoardMeta(&fakeBoardMeta{props: map[string]any{BoardPropBranch: "prop-branch"}})

	ws, err := m.ClaimWorkspace(WorkSpec{Workdir: repo, Owner: "card-1", BoardID: "board1", Title: "Логин"})
	if err != nil {
		t.Fatal(err)
	}
	if got := writer.cardText("card-1", "prop-branch"); got != ws.Branch {
		t.Errorf("the card says %q, want the branch its work is on (%q)", got, ws.Branch)
	}

	// A conversation with no card has nowhere to write, and must not try.
	if _, err := m.ClaimWorkspace(WorkSpec{Workdir: repo, Owner: BoardOwner("board1"), BoardID: "board1", Title: "Планирование"}); err != nil {
		t.Fatal(err)
	}
	if got := writer.cardText(BoardOwner("board1"), "prop-branch"); got != "" {
		t.Errorf("a card-less conversation wrote %q somewhere", got)
	}
}

// An ordinary folder is worked in as it stands: nothing is created, and
// nothing is recorded about it.
func TestAnOrdinaryFolderIsItsOwnWorkspace(t *testing.T) {
	m, _ := workspaceManager(t)
	notes := t.TempDir()

	ws, err := m.ClaimWorkspace(WorkSpec{Workdir: notes, Owner: "card-1", BoardID: "board1", Title: "Заметка"})
	if err != nil {
		t.Fatal(err)
	}
	if ws.Mode != WorkModePlain || ws.Cwd != notes || ws.Branch != "" {
		t.Errorf("an ordinary folder gave %+v", ws)
	}
	if _, held, err := m.store.WorkspaceOf(notes, "card-1"); err != nil || held {
		t.Errorf("a folder that created nothing was recorded anyway (held=%v err=%v)", held, err)
	}
}

// A card that already has a workspace keeps it, whatever the folder decides
// afterwards: its work is in there. And a card working in a copy of its own
// holds nothing, so it can never keep another card out of the folder — which is
// what "папка занята другой карточкой" said about a card that had finished.
func TestChangingTheFoldersModeLeavesRunningCardsAlone(t *testing.T) {
	m, repo := workspaceManager(t)
	if _, err := m.SetWorkdirMode("code", "board1", WorkModeWorktree); err != nil {
		t.Fatal(err)
	}

	first, err := m.ClaimWorkspace(WorkSpec{Workdir: repo, Owner: "card-1", BoardID: "board1", Title: "Первая"})
	if err != nil {
		t.Fatal(err)
	}

	// The folder is switched to a branch in itself.
	if _, err := m.SetWorkdirMode("code", "board1", WorkModeBranch); err != nil {
		t.Fatal(err)
	}

	again, err := m.ClaimWorkspace(WorkSpec{Workdir: repo, Owner: "card-1", BoardID: "board1", Title: "Первая"})
	if err != nil {
		t.Fatal(err)
	}
	if again.Branch != first.Branch || again.Cwd != first.Cwd {
		t.Errorf("the card was moved to %+v, want the workspace its work is in %+v", again, first)
	}

	// And the next card gets what the board now says, without being told the
	// folder is held by a card sitting in a copy of its own.
	second, err := m.ClaimWorkspace(WorkSpec{Workdir: repo, Owner: "card-2", BoardID: "board1", Title: "Вторая"})
	if err != nil {
		t.Fatalf("the next card was refused: %v", err)
	}
	if second.Mode != WorkModeBranch || second.Cwd != repo {
		t.Errorf("the next card got %+v, want a branch in the folder itself", second)
	}
}

// Where a card's work is used to have two answers, and every reader picked one
// of them and was wrong somewhere. A card worked on another machine carries its
// branch and nothing else — no claim here — and it still counts as started,
// which is what the folder field is locked on.
func TestWorkOnACardIsOneAnswerFromTwoPlaces(t *testing.T) {
	m := registryManager(t, "")
	m.SetBoardMeta(&fakeBoardMeta{props: map[string]any{BoardPropBranch: "prop-branch"}})
	m.SetBoardReader(&fakeReader{ev: CardMoved{
		BoardID: "board1",
		Values:  map[string]string{"prop-branch": "pochini-login-1a2b"},
	}})

	work := m.CardWork("card-travelled")
	if !work.Started {
		t.Error("a card carrying a branch does not count as worked")
	}
	if work.Here {
		t.Error("a card with no claim here says this machine holds its workspace")
	}
	if work.Branch != "pochini-login-1a2b" {
		t.Errorf("the branch is %q, and the card says pochini-login-1a2b", work.Branch)
	}

	// A card that says nothing, on a machine that holds nothing, has no work.
	m.SetBoardReader(&fakeReader{ev: CardMoved{BoardID: "board1"}})
	if quiet := m.CardWork("card-fresh"); quiet.Started {
		t.Errorf("a card nobody has worked reads as started: %+v", quiet)
	}
}
