package acp

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func registryManager(t *testing.T, cfgPath string, projects ...ProjectEntry) *Manager {
	t.Helper()
	cfg := DefaultConfig(t.TempDir())
	cfg.Projects = projects
	return NewManager(cfg, cfgPath, nil, newFakeWriter(), &fakeEmitter{}, nil)
}

func TestAddRemoveProjectPersists(t *testing.T) {
	project := initTestProject(t)
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	m := registryManager(t, cfgPath)

	entry, err := m.AddProject("", project, "board1", false)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Name != filepath.Base(project) {
		t.Errorf("default name should be basename, got %q", entry.Name)
	}

	// Duplicates by name and by path are rejected.
	if _, err := m.AddProject(entry.Name, t.TempDir(), "board1", false); err == nil {
		t.Error("duplicate name accepted")
	}
	if _, err := m.AddProject("other", project, "board1", false); err == nil {
		t.Error("duplicate path accepted")
	}
	// A folder that is not under git is a project too: what git buys is
	// worktrees and branch-driven transitions, and a board of personal tasks
	// wants neither. Which board needs it is asked by the setup plan
	// (setupRequirements), not by the registry.
	notes := t.TempDir()
	if _, err := m.AddProject("notes", notes, "board1", false); err != nil {
		t.Errorf("an ordinary folder was refused: %v", err)
	}
	if IsGitProject(context.Background(), notes) {
		t.Error("the fixture is under git, so this proves nothing")
	}

	// Persisted and reloadable.
	loaded, err := LoadConfig(cfgPath, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Projects) != 2 || loaded.Projects[0].Path != project {
		t.Fatalf("registry not persisted: %+v", loaded.Projects)
	}

	if err := m.RemoveProject(entry.Name); err != nil {
		t.Fatal(err)
	}
	if err := m.RemoveProject(entry.Name); err == nil {
		t.Error("removing missing entry should fail")
	}
	loaded, _ = LoadConfig(cfgPath, t.TempDir())
	if len(loaded.Projects) != 1 {
		t.Fatalf("removal not persisted: %+v", loaded.Projects)
	}
}

func TestResolveRepoByTag(t *testing.T) {
	project := initTestProject(t)
	m := registryManager(t, "", ProjectEntry{Name: "MyRepo", Path: project})

	ev := CardMoved{OptionNames: []string{"urgent", "myrepo"}, Props: map[string]string{}}
	got, err := m.resolveProject(ev)
	if err != nil || got != project {
		t.Fatalf("tag match failed: got=%q err=%v", got, err)
	}

	// No matching tag → error naming the registry entries.
	_, err = m.resolveProject(CardMoved{OptionNames: []string{"urgent"}, Props: map[string]string{}})
	if err == nil || !strings.Contains(err.Error(), "MyRepo") {
		t.Errorf("expected mismatch error listing projects, got %v", err)
	}

	// A card dragged out of a column named after the project matches too
	// (project-lane boards: the trigger move erases the tag from the card).
	got, err = m.resolveProject(CardMoved{
		Props:      map[string]string{},
		FromColumn: Column{PropertyName: "Status", Name: "myrepo"},
		ToColumn:   Column{PropertyName: "Status", Name: DefaultTriggerColumn},
	})
	if err != nil || got != project {
		t.Fatalf("from-column match failed: got=%q err=%v", got, err)
	}

	// Registered project with a dead path → clear error.
	m2 := registryManager(t, "", ProjectEntry{Name: "gone", Path: "/no/such/dir"})
	if _, err := m2.resolveProject(CardMoved{OptionNames: []string{"gone"}}); err == nil {
		t.Error("dead registry path should error")
	}
}

func TestResolveRepoExplicitOverride(t *testing.T) {
	project := initTestProject(t)
	other := initTestProject(t)
	m := registryManager(t, "", ProjectEntry{Name: "tagged", Path: other})

	// Explicit repo_path wins over tags, and registered paths are allowed
	// without being whitelisted.
	ev := CardMoved{
		Props:       map[string]string{"repo_path": project},
		OptionNames: []string{"tagged"},
	}
	if _, err := m.resolveProject(ev); err == nil {
		t.Fatal("unregistered repo_path should be rejected (not whitelisted)")
	}

	ev.Props["repo_path"] = other
	got, err := m.resolveProject(ev)
	if err != nil || got != other {
		t.Fatalf("registered repo_path should be allowed: got=%q err=%v", got, err)
	}
}

func TestTriggerSessionViaTag(t *testing.T) {
	m, writer, events, project := testManager(t, fakeClaudeHappy, nil)
	if _, err := m.AddProject("boardrepo", project, "board1", false); err != nil {
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
	// The tag picked the project; the session runs in that project's
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

// The registry is per machine, but a project is not: a folder of household
// notes added on the home board has no business being offered — or worked in —
// by the board about code.
func TestAProjectBelongsToTheBoardItWasAddedOn(t *testing.T) {
	home := initTestProject(t)
	shared := initTestProject(t)
	m := registryManager(t, filepath.Join(t.TempDir(), "config.json"))

	if _, err := m.AddProject("notes", home, "board-home", false); err != nil {
		t.Fatal(err)
	}
	if _, err := m.AddProject("everywhere", shared, "board-home", true); err != nil {
		t.Fatal(err)
	}
	// An entry from before projects had boards belongs to none of them: a
	// registry nobody scoped is exactly what made every board offer every
	// folder, so it is offered nowhere until somebody claims it.
	orphan := t.TempDir()
	m.cfg.Projects = append(m.cfg.Projects, ProjectEntry{Name: "legacy", Path: orphan})

	offered := func(boardID string) string {
		names := make([]string, 0, 3)
		for _, p := range m.ProjectsForBoard(boardID) {
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
	if unattached := m.UnattachedProjects(); len(unattached) != 1 || unattached[0].Name != "legacy" {
		t.Fatalf("unattached %+v, want the entry no board has claimed", unattached)
	}
	if _, err := m.AttachProject("legacy", "board-code"); err != nil {
		t.Fatal(err)
	}
	if got := offered("board-code"); got != "everywhere,legacy" {
		t.Errorf("the code board sees %q after claiming the legacy project", got)
	}
	if len(m.UnattachedProjects()) != 0 {
		t.Error("a claimed project is still listed as belonging to nobody")
	}

	// And what a board cannot see, it cannot run in: a tag matching another
	// board's project resolves to nothing rather than to that folder.
	ev := CardMoved{CardID: "c1", BoardID: "board-code", OptionNames: []string{"notes"}}
	if _, err := m.resolveProject(ev); err == nil {
		t.Error("a card resolved a project belonging to another board")
	}
	ev.BoardID = "board-home"
	if got, err := m.resolveProject(ev); err != nil || got != home {
		t.Errorf("its own board could not resolve it: got=%q err=%v", got, err)
	}
}
