package main

import (
	"path/filepath"
	"testing"
)

// The language a person picked is the install's to keep: the desktop window's
// localStorage is keyed to a loopback origin with a random port, so anything
// left there is gone by the next launch.
func TestUILanguageSurvivesInTheAppsOwnData(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))

	app := &App{}
	if lang, err := app.GetUILanguage(); err != nil || lang != "" {
		t.Fatalf("a fresh install answered %q, %v — want empty, meaning «use the OS language»", lang, err)
	}

	if err := app.SetUILanguage("ru"); err != nil {
		t.Fatal(err)
	}
	if lang, _ := app.GetUILanguage(); lang != "ru" {
		t.Fatalf("kept %q, want ru", lang)
	}

	// Empty forgets the choice, handing it back to the OS.
	if err := app.SetUILanguage(""); err != nil {
		t.Fatal(err)
	}
	if lang, _ := app.GetUILanguage(); lang != "" {
		t.Fatalf("forgetting left %q behind", lang)
	}
}
