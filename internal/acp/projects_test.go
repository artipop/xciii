package acp

import (
	"os"
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

	entry, err := m.AddProject("", project)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Name != filepath.Base(project) {
		t.Errorf("default name should be basename, got %q", entry.Name)
	}

	// Duplicates by name and by path are rejected.
	if _, err := m.AddProject(entry.Name, t.TempDir()); err == nil {
		t.Error("duplicate name accepted")
	}
	if _, err := m.AddProject("other", project); err == nil {
		t.Error("duplicate path accepted")
	}
	// Non-git directories are rejected.
	if _, err := m.AddProject("notgit", t.TempDir()); err == nil {
		t.Error("non-git dir accepted")
	}

	// Persisted and reloadable.
	loaded, err := LoadConfig(cfgPath, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Projects) != 1 || loaded.Projects[0].Path != project {
		t.Fatalf("registry not persisted: %+v", loaded.Projects)
	}

	if err := m.RemoveProject(entry.Name); err != nil {
		t.Fatal(err)
	}
	if err := m.RemoveProject(entry.Name); err == nil {
		t.Error("removing missing entry should fail")
	}
	loaded, _ = LoadConfig(cfgPath, t.TempDir())
	if len(loaded.Projects) != 0 {
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
	if _, err := m.AddProject("boardrepo", project); err != nil {
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
	if got := writer.cardComments("card10"); len(got) < 2 {
		t.Errorf("expected comments, got %v", got)
	}
}

// A config written before projects were called projects still names them
// "repos". Reading only the new key would have emptied the registry of every
// install that had one, and an agent with no project quietly finds nowhere to
// work — the kind of breakage that looks like the feature never worked.
func TestConfigWrittenBeforeTheRenameStillHasItsProjects(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	legacy := `{"repos":[{"name":"app","path":"/tmp/app"}],"repoWhitelist":["/tmp"]}`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, err := LoadConfig(path, dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Projects) != 1 || cfg.Projects[0].Name != "app" || cfg.Projects[0].Path != "/tmp/app" {
		t.Fatalf("the old registry was not adopted: %+v", cfg.Projects)
	}
	if len(cfg.ProjectWhitelist) != 1 || cfg.ProjectWhitelist[0] != "/tmp" {
		t.Fatalf("the old whitelist was not adopted: %+v", cfg.ProjectWhitelist)
	}
}

// And a config written since the rename is never second-guessed: an emptied
// registry is a decision, not an invitation to go looking for the old key.
func TestAnEmptiedProjectRegistryIsNotRefilledFromTheOldKey(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	both := `{"projects":[],"repos":[{"name":"app","path":"/tmp/app"}]}`
	if err := os.WriteFile(path, []byte(both), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, err := LoadConfig(path, dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Projects) != 0 {
		t.Fatalf("the new key was overridden by the old one: %+v", cfg.Projects)
	}
}
