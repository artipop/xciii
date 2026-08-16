package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/artipop/xciii/internal/edition"
)

// A fresh install looks for updates without being asked. Anything else means a
// person who never opens the settings never learns that a new version exists,
// which is the whole point of the feature.
func TestUpdatesAreCheckedForByDefault(t *testing.T) {
	path := filepath.Join(t.TempDir(), "updates.json")
	if got := readUpdateSettings(path); !got.enabled() {
		t.Fatal("with no settings file the automatic check should be on")
	}
}

// Turning it off has to mean off. The field is a pointer precisely so that
// "false" and "the file predates this setting" are different answers.
func TestTurningTheAutomaticCheckOffIsRemembered(t *testing.T) {
	path := filepath.Join(t.TempDir(), "updates.json")
	off := false
	if err := writeUpdateSettings(path, updateSettings{Enabled: &off}); err != nil {
		t.Fatalf("writing: %v", err)
	}
	if readUpdateSettings(path).enabled() {
		t.Fatal("the automatic check should stay off across a restart")
	}
}

// The version a person skipped is the one thing the framework does not keep:
// its Updater holds it in a field that dies with the process. If this does not
// survive, «Пропустить эту версию» silently means «до перезапуска».
func TestTheSkippedVersionSurvivesARestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "updates.json")
	if err := writeUpdateSettings(path, updateSettings{SkippedVersion: "2.0.0", LastCheckedAt: "2026-08-13T10:00:00Z"}); err != nil {
		t.Fatalf("writing: %v", err)
	}
	got := readUpdateSettings(path)
	if got.SkippedVersion != "2.0.0" {
		t.Errorf("skipped version = %q, want 2.0.0", got.SkippedVersion)
	}
	if got.LastCheckedAt != "2026-08-13T10:00:00Z" {
		t.Errorf("last checked = %q, want the time it was written", got.LastCheckedAt)
	}
}

// A settings file somebody has broken must not take the app with it. Losing a
// preference is a smaller failure than refusing to start.
func TestABrokenSettingsFileFallsBackToTheDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "updates.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatalf("writing: %v", err)
	}
	got := readUpdateSettings(path)
	if !got.enabled() || got.SkippedVersion != "" {
		t.Fatalf("a broken file should read as the defaults, got %+v", got)
	}
}

// A build that cannot update itself — the headless server, or any deployment
// where the page has no Go side — has to say so rather than draw a panel whose
// buttons do nothing. The settings dialog leaves the section out on this
// answer.
func TestABuildWithoutUpdatingSaysSo(t *testing.T) {
	app := &App{}
	out, err := app.GetUpdateState()
	if err != nil {
		t.Fatalf("GetUpdateState: %v", err)
	}
	var state updateState
	if err := json.Unmarshal([]byte(out), &state); err != nil {
		t.Fatalf("decoding: %v", err)
	}
	if state.Supported {
		t.Error("a build with no updater should report supported=false")
	}
	if state.CurrentVersion != appVersion {
		t.Errorf("current version = %q, want %q — the panel names it even when it cannot update", state.CurrentVersion, appVersion)
	}
	if err := app.CheckForUpdate(); err == nil {
		t.Error("checking for updates should fail rather than quietly do nothing")
	}
}

// Two editions are two installers under one app name, so the panel is where
// «какое у меня стоит» gets answered — including in a build that cannot update
// itself, which is still one edition or the other.
func TestTheUpdateStateNamesTheEdition(t *testing.T) {
	app := &App{}
	out, err := app.GetUpdateState()
	if err != nil {
		t.Fatalf("GetUpdateState: %v", err)
	}
	var state updateState
	if err := json.Unmarshal([]byte(out), &state); err != nil {
		t.Fatalf("decoding: %v", err)
	}
	if state.Edition != edition.Name {
		t.Errorf("edition = %q, want %q", state.Edition, edition.Name)
	}
	// The raw name, not a word for a person: the page owns the words, and a
	// Russian label crossing this boundary would be a label nothing could
	// translate.
	if state.Edition != edition.Base && state.Edition != edition.Lifetime {
		t.Errorf("edition = %q, which is neither of the two this repository builds", state.Edition)
	}
}
