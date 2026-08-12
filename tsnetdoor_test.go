package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func gateFor(t *testing.T, cfg tailnetSettings, self string, login string, whoIsErr error) http.Handler {
	t.Helper()
	whoIs := func(context.Context, string) (string, error) { return login, whoIsErr }
	return tailnetGate(named("board"), whoIs, allowedLogins(cfg, self))
}

// The board hands its session token to whoever fetches a page, and one of the
// paths behind this gate is a shell in the user's project. So a caller the
// settings do not name gets nothing at all — not a login form, not the page.
func TestTailnetDoorAnswersOnlyTheUserItWasLoggedInAs(t *testing.T) {
	cases := []struct {
		name  string
		cfg   tailnetSettings
		self  string
		login string
		err   error
		want  int
	}{
		{"the user this node belongs to", tailnetSettings{}, "alice@example.com", "alice@example.com", nil, http.StatusOK},
		{"somebody else on the same tailnet", tailnetSettings{}, "alice@example.com", "bob@example.com", nil, http.StatusForbidden},
		{"a guest the settings name", tailnetSettings{AllowedLogins: []string{"bob@example.com"}}, "alice@example.com", "bob@example.com", nil, http.StatusOK},
		// Naming anyone replaces the default rather than adding to it, so a
		// list that forgets the owner locks the owner out — deliberately, since
		// the alternative is a list that cannot express "only this guest".
		{"the owner, once the settings name somebody else", tailnetSettings{AllowedLogins: []string{"bob@example.com"}}, "alice@example.com", "alice@example.com", nil, http.StatusForbidden},
		{"a caller tailscale cannot identify", tailnetSettings{}, "alice@example.com", "", errors.New("no peer"), http.StatusForbidden},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		gateFor(t, c.cfg, c.self, c.login, c.err).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
		if rec.Code != c.want {
			t.Errorf("%s: status %d, want %d", c.name, rec.Code, c.want)
		}
	}
}

// Login names come from a directory, not from a person's typing, but the
// settings file is typed by hand.
func TestTailnetDoorIgnoresTheCaseOfALoginName(t *testing.T) {
	cfg := tailnetSettings{AllowedLogins: []string{"Alice@Example.com"}}
	rec := httptest.NewRecorder()
	gateFor(t, cfg, "", "alice@example.com", nil).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("status %d, want 200", rec.Code)
	}
}

// A node with no login of its own and no list would otherwise allow the empty
// login name that a failed lookup returns.
func TestTailnetDoorWithNobodyNamedAllowsNobody(t *testing.T) {
	rec := httptest.NewRecorder()
	gateFor(t, tailnetSettings{}, "", "", nil).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusForbidden {
		t.Errorf("status %d, want 403", rec.Code)
	}
}

// Publishing the board to a network is an explicit act: an install that has
// never heard of this feature must not acquire it by upgrading.
func TestTailnetIsOffUntilItsSettingsFileSaysOtherwise(t *testing.T) {
	dir := t.TempDir()
	missing := filepath.Join(dir, "settings.json")

	cfg, err := loadTailnetSettings(missing)
	if err != nil {
		t.Fatalf("missing settings file: %v", err)
	}
	if cfg.Enabled {
		t.Error("no settings file, yet the tailnet door is enabled")
	}

	if err := os.WriteFile(missing, []byte(`{"enabled":true,"hostname":"board"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err = loadTailnetSettings(missing)
	if err != nil {
		t.Fatalf("reading settings: %v", err)
	}
	if !cfg.Enabled || cfg.Hostname != "board" {
		t.Errorf("read %+v, want enabled with hostname board", cfg)
	}
}

// A controller that could not read its settings is nil, and a front door that
// asks a nil controller to publish must simply not publish.
func TestAFrontDoorPublishesNothingWithoutATailnetController(t *testing.T) {
	var controller *tailnetController
	controller.publish(func(string) http.Handler { return named("board") })
	if state := controller.status(); state.Status != "off" {
		t.Errorf("status %q, want off", state.Status)
	}
	controller.close()
}

// The switch in the settings panel writes the same file a person can edit, and
// the two must agree: what the panel saved is what the next launch reads.
func TestTheSwitchSavesWhatTheNextLaunchWillRead(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	controller, err := newTailnetController(path, t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}

	// Nothing is published until the front door hands over its builder, so this
	// exercises the settings half without bringing a node up.
	state, err := controller.update(tailnetSettings{Enabled: true, Hostname: "board"})
	if err != nil {
		t.Fatalf("turning it on: %v", err)
	}
	if !state.Enabled || state.Hostname != "board" {
		t.Errorf("state %+v, want enabled as board", state)
	}

	saved, err := loadTailnetSettings(path)
	if err != nil {
		t.Fatalf("reading back: %v", err)
	}
	if !saved.Enabled || saved.Hostname != "board" {
		t.Errorf("saved %+v, want enabled as board", saved)
	}
}

// An auth key and a guest login are edited by hand, and the panel knows about
// neither. Saving from the panel must not quietly drop them.
func TestTheSwitchKeepsWhatOnlyTheFileCanSay(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	if err := saveTailnetSettings(path, tailnetSettings{
		AuthKey:       "tskey-secret",
		AllowedLogins: []string{"bob@example.com"},
	}); err != nil {
		t.Fatal(err)
	}

	controller, err := newTailnetController(path, t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	next := controller.settingsCopy()
	next.Enabled = true
	next.Hostname = "board"
	if _, err := controller.update(next); err != nil {
		t.Fatalf("turning it on: %v", err)
	}

	saved, _ := loadTailnetSettings(path)
	if saved.AuthKey != "tskey-secret" || len(saved.AllowedLogins) != 1 {
		t.Errorf("saved %+v, want the auth key and the guest kept", saved)
	}
}

// A node with no name has no address, and the failure would otherwise arrive
// much later, from tsnet, in English, in a log nobody is reading.
func TestTurningItOnWithoutANameIsRefused(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	controller, err := newTailnetController(path, t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := controller.update(tailnetSettings{Enabled: true, Hostname: "  "}); err == nil {
		t.Error("a node with no name was accepted")
	}
	if _, err := os.Stat(path); err == nil {
		t.Error("the refused settings were written anyway")
	}
}
