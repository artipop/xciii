package acp

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func registryManager(t *testing.T, cfgPath string, projects ...WorkdirEntry) *Manager {
	t.Helper()
	cfg := DefaultConfig(t.TempDir())
	cfg.Workdirs = projects
	return NewManager(cfg, cfgPath, nil, newFakeWriter(), &fakeEmitter{}, nil)
}

func TestAddRemoveProjectPersists(t *testing.T) {
	project := initTestWorkdir(t)
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	m := registryManager(t, cfgPath)

	entry, err := m.AddWorkdir("", project, "board1", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Name != filepath.Base(project) {
		t.Errorf("default name should be basename, got %q", entry.Name)
	}

	// Duplicates by name and by path are rejected.
	if _, err := m.AddWorkdir(entry.Name, t.TempDir(), "board1", "", false); err == nil {
		t.Error("duplicate name accepted")
	}
	if _, err := m.AddWorkdir("other", project, "board1", "", false); err == nil {
		t.Error("duplicate path accepted")
	}
	// A folder that is not under git is a folder too: what git buys is
	// worktrees and branch-driven transitions, and a board of personal tasks
	// wants neither. Which board needs it is asked by the setup plan
	// (setupRequirements), not by the registry.
	notes := t.TempDir()
	if _, err := m.AddWorkdir("notes", notes, "board1", "", false); err != nil {
		t.Errorf("an ordinary folder was refused: %v", err)
	}
	if IsGitWorkdir(context.Background(), notes) {
		t.Error("the fixture is under git, so this proves nothing")
	}
	// A folder asked for as a repository is refused when it has no git: the
	// board's setup step demanded one, and answering it with a folder that
	// cannot carry a branch is a mistake worth catching where it is made.
	if _, err := m.AddWorkdir("notes-as-repo", notes, "board1", WorkdirGit, false); err == nil {
		t.Error("a folder declared a repository was accepted without git")
	}

	// Persisted and reloadable.
	loaded, err := LoadConfig(cfgPath, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Workdirs) != 2 || loaded.Workdirs[0].Path != project {
		t.Fatalf("registry not persisted: %+v", loaded.Workdirs)
	}

	if err := m.RemoveWorkdir(entry.Name); err != nil {
		t.Fatal(err)
	}
	if err := m.RemoveWorkdir(entry.Name); err == nil {
		t.Error("removing missing entry should fail")
	}
	loaded, _ = LoadConfig(cfgPath, t.TempDir())
	if len(loaded.Workdirs) != 1 {
		t.Fatalf("removal not persisted: %+v", loaded.Workdirs)
	}
}

// What a folder branches from is a setting, and it starts out filled in: a
// person who wants `develop` says so, and everybody else says nothing.
func TestBaseBranchIsASettingPrefilledFromTheRepository(t *testing.T) {
	repo := initTestWorkdir(t)
	m := registryManager(t, filepath.Join(t.TempDir(), "config.json"))

	entry, err := m.AddWorkdir("repo", repo, "board1", WorkdirGit, false)
	if err != nil {
		t.Fatal(err)
	}
	if entry.BaseBranch != "main" {
		t.Errorf("base branch %q, want the repository's own (main)", entry.BaseBranch)
	}

	if _, err := m.SetWorkdirBase("repo", "develop"); err != nil {
		t.Fatal(err)
	}
	if got := m.BaseBranchOf(m.Workdirs()[0]); got != "develop" {
		t.Errorf("base branch %q after the setting was changed, want develop", got)
	}

	// Cleared, the folder falls back to what git says — an entry written
	// before the setting existed carries nothing and must still work.
	if _, err := m.SetWorkdirBase("repo", ""); err != nil {
		t.Fatal(err)
	}
	if got := m.BaseBranchOf(m.Workdirs()[0]); got != "main" {
		t.Errorf("base branch %q after clearing, want the repository's own", got)
	}
}

// The screen shows what a folder *is*, and asks git for it every time: a
// folder somebody ran `git init` in became a repository without the registry
// hearing about it.
func TestWorkdirStatusAsksGitRatherThanTheEntry(t *testing.T) {
	repo := initTestWorkdir(t)
	notes := t.TempDir()
	m := registryManager(t, filepath.Join(t.TempDir(), "config.json"))
	if _, err := m.AddWorkdir("repo", repo, "b", WorkdirGit, false); err != nil {
		t.Fatal(err)
	}
	if _, err := m.AddWorkdir("notes", notes, "b", "", false); err != nil {
		t.Fatal(err)
	}

	byName := map[string]WorkdirStatus{}
	for _, st := range m.WorkdirStatusesForBoard("b") {
		byName[st.Name] = st
	}
	if !byName["repo"].Git || byName["repo"].Base != "main" || byName["repo"].Broken {
		t.Errorf("the repository reads as %+v", byName["repo"])
	}
	if byName["notes"].Git || byName["notes"].Base != "" {
		t.Errorf("the ordinary folder reads as %+v", byName["notes"])
	}

	// A folder added as a repository whose git has gone says so, rather than
	// quietly becoming an ordinary folder: the person meant a repository.
	if err := os.RemoveAll(filepath.Join(repo, ".git")); err != nil {
		t.Fatal(err)
	}
	for _, st := range m.WorkdirStatusesForBoard("b") {
		if st.Name == "repo" && !st.Broken {
			t.Errorf("a declared repository with no git reads as %+v", st)
		}
	}
}

// A board that says which of its fields holds the folder is read there and
// nowhere else. Recognising a folder by name — among every option selected on
// the card, and then among the columns it came from — is what this replaced:
// a label named after a repository decided where an agent worked, and, since
// the names were collected by ranging over the property schema, which label
// won changed from event to event.
func TestTheCardsFolderFieldIsWhereTheFolderIsRead(t *testing.T) {
	project := initTestWorkdir(t)
	m := registryManager(t, "", WorkdirEntry{Name: "MyRepo", Path: project, BoardID: "board1"})
	m.SetBoardMeta(&fakeBoardMeta{props: map[string]any{BoardPropProject: "prop-folder"}})

	ev := CardMoved{
		BoardID: "board1",
		Props:   map[string]string{},
		// A label that happens to be spelled like the folder, and the folder
		// field itself, which says something else entirely.
		OptionNames:     []string{"MyRepo"},
		SelectedOptions: []Column{{PropertyID: "prop-tags", OptionID: "o1", Name: "MyRepo"}},
	}
	if _, err := m.resolveWorkdir(ev); err == nil {
		t.Error("a label spelled like a folder still decided where the agent works")
	}

	ev.SelectedOptions = append(ev.SelectedOptions, Column{PropertyID: "prop-folder", OptionID: "o2", Name: "MyRepo"})
	got, err := m.resolveWorkdir(ev)
	if err != nil || got != project {
		t.Fatalf("the card's folder field was not read: got=%q err=%v", got, err)
	}

	// And the column the card came from is not a folder either.
	away := CardMoved{
		BoardID:    "board1",
		Props:      map[string]string{},
		FromColumn: Column{PropertyName: "Статус", Name: "MyRepo"},
	}
	if _, err := m.resolveWorkdir(away); err == nil {
		t.Error("the column a card came from still decided where the agent works")
	}
}

// The scan by name survives for a board that records no folder field, which is
// a board this app never made one for: it is that board's only way to say
// anything, and it cannot be the accident above, because there is no field for
// it to contradict.
func TestResolveRepoByTag(t *testing.T) {
	project := initTestWorkdir(t)
	m := registryManager(t, "", WorkdirEntry{Name: "MyRepo", Path: project})

	ev := CardMoved{OptionNames: []string{"urgent", "myrepo"}, Props: map[string]string{}}
	got, err := m.resolveWorkdir(ev)
	if err != nil || got != project {
		t.Fatalf("tag match failed: got=%q err=%v", got, err)
	}

	// No matching tag → error naming the registry entries.
	_, err = m.resolveWorkdir(CardMoved{OptionNames: []string{"urgent"}, Props: map[string]string{}})
	if err == nil || !strings.Contains(err.Error(), "MyRepo") {
		t.Errorf("expected mismatch error listing projects, got %v", err)
	}

	// A card dragged out of a column named after the folder matches too
	// (folder-lane boards: the trigger move erases the tag from the card).
	got, err = m.resolveWorkdir(CardMoved{
		Props:      map[string]string{},
		FromColumn: Column{PropertyName: "Status", Name: "myrepo"},
		ToColumn:   Column{PropertyName: "Status", Name: DefaultTriggerColumn},
	})
	if err != nil || got != project {
		t.Fatalf("from-column match failed: got=%q err=%v", got, err)
	}

	// Registered folder with a dead path → clear error.
	m2 := registryManager(t, "", WorkdirEntry{Name: "gone", Path: "/no/such/dir"})
	if _, err := m2.resolveWorkdir(CardMoved{OptionNames: []string{"gone"}}); err == nil {
		t.Error("dead registry path should error")
	}
}

func TestResolveRepoExplicitOverride(t *testing.T) {
	project := initTestWorkdir(t)
	other := initTestWorkdir(t)
	m := registryManager(t, "", WorkdirEntry{Name: "tagged", Path: other})

	// Explicit repo_path wins over tags, and registered paths are allowed
	// without being whitelisted.
	ev := CardMoved{
		Props:       map[string]string{"repo_path": project},
		OptionNames: []string{"tagged"},
	}
	if _, err := m.resolveWorkdir(ev); err == nil {
		t.Fatal("unregistered repo_path should be rejected (not whitelisted)")
	}

	ev.Props["repo_path"] = other
	got, err := m.resolveWorkdir(ev)
	if err != nil || got != other {
		t.Fatalf("registered repo_path should be allowed: got=%q err=%v", got, err)
	}
}

func TestTriggerSessionViaTag(t *testing.T) {
	m, writer, events, project := testManager(t, fakeClaudeHappy, nil)
	if _, err := m.AddWorkdir("boardrepo", project, "board1", "", false); err != nil {
		t.Fatal(err)
	}

	ev := moveEvent("card10", "", "opt-backlog", "opt-agent")
	delete(ev.Props, "repo_path")
	ev.Props["repo_path"] = ""             // no explicit path
	ev.OptionNames = []string{"BoardRepo"} // tag, case-insensitive
	events.ch <- ev

	waitFor(t, 15*time.Second, "tag-mapped session done", func() bool {
		sessions, _, err := m.store.SessionsForCard("card10")
		return err == nil && len(sessions) == 1 && sessions[0].Status == StatusDone
	})
	// The tag picked the folder; the session runs in that folder's
	// worktree, which is named after it.
	sessions, _, _ := m.store.SessionsForCard("card10")
	if wt := sessions[0].WorktreePath; !strings.Contains(filepath.Base(wt), filepath.Base(project)) {
		t.Errorf("expected a worktree of %q, got %q", project, wt)
	}
	// One comment, and it is what the session did. The card is not a log of
	// the machinery that ran it.
	if got := writer.cardComments("card10"); len(got) != 1 || !strings.Contains(got[0], "Агент завершил работу") {
		t.Errorf("expected one closing comment, got %v", got)
	}
}

// The registry is per machine, but a folder is not: a folder of household
// notes added on the home board has no business being offered — or worked in —
// by the board about code.
func TestAProjectBelongsToTheBoardItWasAddedOn(t *testing.T) {
	home := initTestWorkdir(t)
	shared := initTestWorkdir(t)
	m := registryManager(t, filepath.Join(t.TempDir(), "config.json"))

	if _, err := m.AddWorkdir("notes", home, "board-home", "", false); err != nil {
		t.Fatal(err)
	}
	if _, err := m.AddWorkdir("everywhere", shared, "board-home", "", true); err != nil {
		t.Fatal(err)
	}
	// An entry from before folders had boards belongs to none of them: a
	// registry nobody scoped is exactly what made every board offer every
	// folder, so it is offered nowhere until somebody claims it.
	orphan := t.TempDir()
	m.cfg.Workdirs = append(m.cfg.Workdirs, WorkdirEntry{Name: "legacy", Path: orphan})

	offered := func(boardID string) string {
		names := make([]string, 0, 3)
		for _, p := range m.WorkdirsForBoard(boardID) {
			names = append(names, p.Name)
		}
		return strings.Join(names, ",")
	}
	if got := offered("board-home"); got != "notes,everywhere" {
		t.Errorf("the home board sees %q, want its own project and the global one", got)
	}
	if got := offered("board-code"); got != "everywhere" {
		t.Errorf("the code board sees %q, want only the global one", got)
	}

	// It is not lost, though — it is listed apart, and one click on a board
	// makes it that board's. Without this it would be invisible everywhere
	// while its path went on refusing to be added again.
	if unattached := m.UnattachedWorkdirs(); len(unattached) != 1 || unattached[0].Name != "legacy" {
		t.Fatalf("unattached %+v, want the entry no board has claimed", unattached)
	}
	if _, err := m.AttachWorkdir("legacy", "board-code"); err != nil {
		t.Fatal(err)
	}
	if got := offered("board-code"); got != "everywhere,legacy" {
		t.Errorf("the code board sees %q after claiming the legacy project", got)
	}
	if len(m.UnattachedWorkdirs()) != 0 {
		t.Error("a claimed project is still listed as belonging to nobody")
	}

	// And what a board cannot see, it cannot run in: a tag matching another
	// board's folder resolves to nothing rather than to that folder.
	ev := CardMoved{CardID: "c1", BoardID: "board-code", OptionNames: []string{"notes"}}
	if _, err := m.resolveWorkdir(ev); err == nil {
		t.Error("a card resolved a project belonging to another board")
	}
	ev.BoardID = "board-home"
	if got, err := m.resolveWorkdir(ev); err != nil || got != home {
		t.Errorf("its own board could not resolve it: got=%q err=%v", got, err)
	}
}

// A folder somebody has already added is not a mistake to refuse: one checkout
// worked from two boards is an ordinary arrangement, so the screens ask whether
// to use it here, and this is what the answer costs.
func TestAFolderAlreadyAddedCanBeUsedHere(t *testing.T) {
	repo := initTestWorkdir(t)
	m := registryManager(t, filepath.Join(t.TempDir(), "config.json"))
	if _, err := m.AddWorkdir("code", repo, "board-a", "", false); err != nil {
		t.Fatal(err)
	}

	// Found by path, whichever board owns it — that is what lets the question
	// be asked before the add is attempted.
	entry, ok := m.WorkdirAt(repo + "/")
	if !ok || entry.Name != "code" {
		t.Fatalf("the folder was not found by its path: %+v ok=%v", entry, ok)
	}
	if _, ok := m.WorkdirAt(t.TempDir()); ok {
		t.Error("a folder nobody added was found anyway")
	}

	// Another board asks for it, and gets it without a second entry.
	if got := m.WorkdirsForBoard("board-b"); len(got) != 0 {
		t.Fatalf("board-b already sees %+v", got)
	}
	if _, err := m.ShareWorkdir("code"); err != nil {
		t.Fatal(err)
	}
	if got := m.WorkdirsForBoard("board-b"); len(got) != 1 || got[0].Name != "code" {
		t.Errorf("board-b sees %+v after the folder was shared", got)
	}
	if len(m.Workdirs()) != 1 {
		t.Errorf("sharing made a second entry: %+v", m.Workdirs())
	}
}
