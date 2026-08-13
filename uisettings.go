package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// What the install remembers about its own UI — today the language a person
// picked in the settings. It lives here, in the app's own data, rather than in
// the browser: the desktop window opens on a loopback origin the browser has
// no lasting memory for (a random port per launch — docs/deferred.md, «Уйти из
// localStorage»), and a preference a person set is the install's to keep, the
// way any desktop app keeps one. The page still falls back to localStorage
// when there is no Go side — the same bundle runs in a plain browser and as a
// Mattermost plugin — and to the OS language when nothing was ever picked.
type uiSettings struct {
	Language string `json:"language,omitempty"`
}

// One writer at a time: two bindings racing the read-modify-write would drop
// one of the edits.
var uiSettingsMu sync.Mutex

func uiSettingsPath() (string, error) {
	dir, err := appDataDir("", 0o755)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "ui-settings.json"), nil
}

func readUISettings() uiSettings {
	path, err := uiSettingsPath()
	if err != nil {
		return uiSettings{}
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return uiSettings{}
	}
	var s uiSettings
	if err := json.Unmarshal(b, &s); err != nil {
		return uiSettings{}
	}
	return s
}

func writeUISettings(s uiSettings) error {
	path, err := uiSettingsPath()
	if err != nil {
		return err
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(b, '\n'), 0o644)
}

// GetUILanguage returns the language this install keeps for its UI — "" when
// nobody ever picked one, which the page reads as "use the OS language".
func (a *App) GetUILanguage() (string, error) {
	uiSettingsMu.Lock()
	defer uiSettingsMu.Unlock()
	return readUISettings().Language, nil
}

// SetUILanguage remembers the language picked in the settings. Empty forgets
// it, handing the choice back to the OS.
func (a *App) SetUILanguage(lang string) error {
	uiSettingsMu.Lock()
	defer uiSettingsMu.Unlock()
	s := readUISettings()
	s.Language = strings.TrimSpace(lang)
	return writeUISettings(s)
}
