package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// What the install remembers about its own UI — the language and theme a
// person picked, where they were last, every «больше не показывать». It lives
// here, in the app's own data, rather than in the browser: the desktop window
// opens on a loopback origin the browser has no lasting memory for (a random
// port per launch — docs/deferred.md, «Уйти из localStorage»), and a
// preference a person set is the install's to keep, the way any desktop app
// keeps one. The page hydrates its localStorage from this before the first
// render (userSettings.ts) and writes back through SetUIPreference; in a
// plain browser or as a Mattermost plugin there is no Go side, and
// localStorage stays the whole memory there.
type uiSettings struct {
	// Language predates Preferences by one release; it is folded into the map
	// on read and never written again.
	Language    string            `json:"language,omitempty"`
	Preferences map[string]string `json:"preferences,omitempty"`
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
	var s uiSettings
	path, err := uiSettingsPath()
	if err != nil {
		return s
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return s
	}
	if err := json.Unmarshal(b, &s); err != nil {
		return uiSettings{}
	}
	if s.Language != "" {
		if s.Preferences == nil {
			s.Preferences = map[string]string{}
		}
		if s.Preferences["language"] == "" {
			s.Preferences["language"] = s.Language
		}
		s.Language = ""
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

// GetUIPreferences returns everything the install keeps for its UI, as a JSON
// object of key → value. Empty object when nothing was ever picked.
func (a *App) GetUIPreferences() (string, error) {
	uiSettingsMu.Lock()
	defer uiSettingsMu.Unlock()
	prefs := readUISettings().Preferences
	if prefs == nil {
		prefs = map[string]string{}
	}
	out, err := json.Marshal(prefs)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// agentNotificationsEnabled is «Уведомлять, когда агент ждёт», read from the
// same place the page keeps it — there is one switch for one question, and the
// OS notification the Go side posts (alerts.go) is the same "tell me" the page's
// own notification answers. On unless it has been turned off, which is the rule
// UserSettings.agentNotifications states on the other side (userSettings.ts);
// the value stored is JSON, so it is the string "false" that means no.
//
// The dot in the menu bar deliberately does not consult this: it is an
// indicator and it interrupts nobody.
func agentNotificationsEnabled() bool {
	uiSettingsMu.Lock()
	defer uiSettingsMu.Unlock()
	return readUISettings().Preferences["agentNotifications"] != "false"
}

// SetUIPreference remembers one preference; an empty value forgets it. The
// page sends only the keys it deliberately keeps with the install
// (userSettings.ts names them); the caps below are a backstop, not a schema —
// a runaway value must not grow the settings file without bound.
func (a *App) SetUIPreference(key, value string) error {
	key = strings.TrimSpace(key)
	if key == "" || len(key) > 64 {
		return fmt.Errorf("некорректный ключ настройки")
	}
	if len(value) > 16*1024 {
		return fmt.Errorf("значение настройки слишком велико")
	}
	uiSettingsMu.Lock()
	defer uiSettingsMu.Unlock()
	s := readUISettings()
	if s.Preferences == nil {
		s.Preferences = map[string]string{}
	}
	if value == "" {
		delete(s.Preferences, key)
	} else {
		s.Preferences[key] = value
	}
	return writeUISettings(s)
}
