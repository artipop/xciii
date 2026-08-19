package acp

import (
	"context"
	"path/filepath"
	"testing"
)

// managerOn builds a manager over a store somebody else opened — a second
// launch on the same database, which is what a restart is.
func managerOn(t *testing.T, store *Store, dir string) *Manager {
	t.Helper()
	m := NewManager(DefaultConfig(dir), "", store, newFakeWriter(), &fakeEmitter{}, nil)
	m.cfg.Columns = nil
	m.cfg.Flows = nil
	m.rootCtx = context.Background()
	m.SetBoardMeta(&fakeBoardMeta{})
	return m
}

// The registries are the machine's, and where they live is now the database
// rather than the settings file. What that has to buy is this: a folder and an
// agent registered in one launch are there in the next one, with the same ids,
// even where there is no settings file at all.
func TestTheRegistriesAreThereAfterARestart(t *testing.T) {
	dir := t.TempDir()
	store, err := newTestStore(t, filepath.Join(dir, "xciii.db"))
	if err != nil {
		t.Fatal(err)
	}

	first := managerOn(t, store, dir)
	folder, err := first.AddWorkdir("рабочая", dir, "board1", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if folder.ID == "" {
		t.Fatal("a folder was registered without an id")
	}
	if _, err := first.AddAgent(AgentEntry{Name: "клаус", Kind: "claude"}); err != nil {
		t.Fatal(err)
	}

	// The next launch, reading the same database and nothing else: a fresh
	// config with nothing in it, exactly as a person who deleted config.json
	// would have.
	second := managerOn(t, store, dir)
	second.cfg.Workdirs = nil
	second.cfg.Agents = nil
	second.cfgMu.Lock()
	if err := second.loadRegistriesLocked(); err != nil {
		second.cfgMu.Unlock()
		t.Fatal(err)
	}
	second.cfgMu.Unlock()

	folders := second.Workdirs()
	if len(folders) != 1 || folders[0].Name != "рабочая" {
		t.Fatalf("the folder registry did not survive: %+v", folders)
	}
	if folders[0].ID != folder.ID {
		t.Errorf("the folder came back under another id: %q, was %q", folders[0].ID, folder.ID)
	}
	if folders[0].BoardID != "board1" {
		t.Errorf("the folder forgot which board offers it: %+v", folders[0])
	}
	agents := second.Agents()
	if len(agents) != 1 || agents[0].Name != "клаус" || agents[0].ID == "" {
		t.Fatalf("the agent registry did not survive: %+v", agents)
	}
}

// An entry read, then handed back after something else has saved, must not
// become a second entry. While the name was the key this cost nothing and
// nobody noticed; with the name unique in the database it is a refused write,
// and with a crew pointing at ids it would be a crew pointing at nothing.
func TestUpdatingAnAgentKeepsItTheSameAgent(t *testing.T) {
	dir := t.TempDir()
	store, err := newTestStore(t, filepath.Join(dir, "xciii.db"))
	if err != nil {
		t.Fatal(err)
	}
	m := managerOn(t, store, dir)

	registered, err := m.AddAgent(AgentEntry{Name: "клаус", Kind: "claude", Model: "opus"})
	if err != nil {
		t.Fatal(err)
	}

	// The caller's copy, taken before the update and carrying no id — which is
	// what every path that rebuilds an entry from its fields hands back.
	stale := AgentEntry{Name: "клаус", Kind: "claude", Model: "sonnet"}
	if _, err := m.UpdateAgent(stale); err != nil {
		t.Fatal(err)
	}

	agents := m.Agents()
	if len(agents) != 1 {
		t.Fatalf("updating an agent made %d of them", len(agents))
	}
	if agents[0].ID != registered.ID {
		t.Errorf("the agent changed identity on an edit: %q, was %q", agents[0].ID, registered.ID)
	}
	if agents[0].Model != "sonnet" {
		t.Errorf("the edit was lost: %+v", agents[0])
	}
}

// config.json is hand-edited on purpose and never validated, so it can hold
// what the editor would have refused. One bad line must not be the reason an
// app will not start — the worst possible place to find a typo.
func TestABadlyEditedRegistryIsSkippedRatherThanFatal(t *testing.T) {
	dir := t.TempDir()
	store, err := newTestStore(t, filepath.Join(dir, "xciii.db"))
	if err != nil {
		t.Fatal(err)
	}
	m := managerOn(t, store, dir)
	m.cfg.Agents = []AgentEntry{
		{Name: "клаус", Kind: "claude"},
		{Name: "клаус", Kind: "codex"}, // the same name twice
		{Name: "", Kind: "claude"},     // and one nobody could ever pick
	}

	m.cfgMu.Lock()
	err = m.persistRegistriesLocked()
	m.cfgMu.Unlock()
	if err != nil {
		t.Fatalf("a hand-edited registry stopped the app: %v", err)
	}

	saved, err := store.Agents()
	if err != nil {
		t.Fatal(err)
	}
	if len(saved) != 1 || saved[0].Kind != "claude" {
		t.Fatalf("expected the first of the two and neither of the rest: %+v", saved)
	}
}

// Removing a folder in the dialog has to remove it from the table too, or the
// next launch brings it back.
func TestAFolderTakenOffTheRegistryStaysOff(t *testing.T) {
	dir := t.TempDir()
	store, err := newTestStore(t, filepath.Join(dir, "xciii.db"))
	if err != nil {
		t.Fatal(err)
	}
	m := managerOn(t, store, dir)
	if _, err := m.AddWorkdir("одна", dir, "board1", "", false); err != nil {
		t.Fatal(err)
	}

	m.cfgMu.Lock()
	m.cfg.Workdirs = nil
	err = m.persistRegistriesLocked()
	m.cfgMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}

	left, err := store.Workspaces()
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 0 {
		t.Errorf("the folder is still registered: %+v", left)
	}
}
