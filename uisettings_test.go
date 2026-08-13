package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// A preference a person set is the install's to keep: the desktop window's
// localStorage is keyed to a loopback origin with a random port, so anything
// left there is gone by the next launch.
func TestUIPreferencesSurviveInTheAppsOwnData(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))

	app := &App{}
	if prefs, err := app.GetUIPreferences(); err != nil || prefs != "{}" {
		t.Fatalf("a fresh install answered %q, %v — want an empty object", prefs, err)
	}

	if err := app.SetUIPreference("language", "ru"); err != nil {
		t.Fatal(err)
	}
	if err := app.SetUIPreference("theme", "dark"); err != nil {
		t.Fatal(err)
	}

	prefs, err := app.GetUIPreferences()
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]string
	if err := json.Unmarshal([]byte(prefs), &got); err != nil {
		t.Fatal(err)
	}
	if got["language"] != "ru" || got["theme"] != "dark" {
		t.Fatalf("kept %v, want language=ru theme=dark", got)
	}

	// Empty forgets the one preference, not the file.
	if err := app.SetUIPreference("theme", ""); err != nil {
		t.Fatal(err)
	}
	prefs, _ = app.GetUIPreferences()
	got = nil
	if err := json.Unmarshal([]byte(prefs), &got); err != nil {
		t.Fatal(err)
	}
	if _, there := got["theme"]; there || got["language"] != "ru" {
		t.Fatalf("forgetting the theme left %v", got)
	}
}

// The first release of this file kept only the language, in a field of its
// own. It reads back as the preference it since became.
func TestUISettingsFoldTheOldLanguageField(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))

	dir, err := appDataDir("", 0o755)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "ui-settings.json"), []byte(`{"language":"de"}`), 0o644); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	prefs, err := app.GetUIPreferences()
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]string
	if err := json.Unmarshal([]byte(prefs), &got); err != nil {
		t.Fatal(err)
	}
	if got["language"] != "de" {
		t.Fatalf("the old field read back as %v, want language=de", got)
	}
}

// The caps are a backstop, not a schema: a runaway key or value must not grow
// the settings file without bound.
func TestUIPreferenceRefusesTheUnreasonable(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))

	app := &App{}
	if err := app.SetUIPreference("", "x"); err == nil {
		t.Error("an empty key was accepted")
	}
	long := make([]byte, 20*1024)
	if err := app.SetUIPreference("theme", string(long)); err == nil {
		t.Error("a 20KB value was accepted")
	}
}
