package sources

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/artipop/xciii/internal/secrets"
	"github.com/artipop/xciii/internal/sources/plugin"
)

// Connecting a source is the app's business and not the plugin's: what these
// pin is that the credential ends up somewhere the plugin can be handed one
// from, and that the plugin is never handed the rest of it.

func oauthProvider(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/auth", func(w http.ResponseWriter, r *http.Request) {
		back, _ := url.Parse(r.URL.Query().Get("redirect_uri"))
		back.RawQuery = url.Values{
			"state": {r.URL.Query().Get("state")},
			"code":  {"код-1"},
		}.Encode()
		http.Redirect(w, r, back.String(), http.StatusFound)
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		w.Header().Set("Content-Type", "application/json")
		if r.Form.Get("grant_type") == "refresh_token" {
			fmt.Fprint(w, `{"access_token":"обновлённый","expires_in":3600}`)
			return
		}
		fmt.Fprint(w, `{"access_token":"t0k","refresh_token":"r0k","expires_in":3600}`)
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func connectManager(t *testing.T, provider *httptest.Server) (*Manager, secrets.Store) {
	t.Helper()
	dir := t.TempDir()
	store, err := OpenStore(filepath.Join(dir, "sources.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })

	vault := secrets.NewFileStore(filepath.Join(dir, "secrets.json"))
	m := NewManager(Config{
		Sources: []SourceEntry{{
			Name: "почта", Plugin: "почта-плагин", BoardID: "board1", Enabled: true,
		}},
		Plugins: []Manifest{{
			Name: "почта-плагин", Command: "/bin/true",
			Auth: &AuthSpec{
				Type: "oauth2", ClientID: "клиент",
				AuthorizationURL: provider.URL + "/auth",
				TokenURL:         provider.URL + "/token",
			},
		}},
	}, "", store, &fakeBoard{}, nil)
	m.SetSecrets(vault)
	return m, vault
}

// The browser: whatever address it is given, it follows it, which is what a
// person's browser does with a login page.
func openInFakeBrowser(address string) error {
	go func() {
		resp, err := http.Get(address)
		if err == nil {
			resp.Body.Close()
		}
	}()
	return nil
}

func TestConnectingASourcePutsItsTokenWhereThePluginCanBeGivenOne(t *testing.T) {
	m, vault := connectManager(t, oauthProvider(t))

	if err := m.Connect(context.Background(), "почта", openInFakeBrowser); err != nil {
		t.Fatal(err)
	}

	entry, _ := m.Source("почта")
	if entry.SecretRef == "" {
		t.Fatal("the entry does not say where its credential is")
	}
	// The entry names the secret and never carries it: that is what keeps the
	// registry file safe to show.
	encoded, _ := json.Marshal(entry)
	if strings.Contains(string(encoded), "t0k") || strings.Contains(string(encoded), "r0k") {
		t.Fatalf("the entry carries the credential itself: %s", encoded)
	}

	raw, err := vault.Get(entry.SecretRef)
	if err != nil {
		t.Fatal(err)
	}
	var stored storedToken
	if err := json.Unmarshal([]byte(raw), &stored); err != nil {
		t.Fatal(err)
	}
	if stored.Access != "t0k" || stored.Refresh != "r0k" {
		t.Fatalf("stored: %+v", stored)
	}
}

// The plugin gets the access token and nothing else: a refresh token is the
// app's to keep, and a plugin nobody audited must not be able to walk off with
// one.
func TestThePluginIsHandedTheAccessTokenAndNothingElse(t *testing.T) {
	m, _ := connectManager(t, oauthProvider(t))
	if err := m.Connect(context.Background(), "почта", openInFakeBrowser); err != nil {
		t.Fatal(err)
	}

	given := make(chan plugin.Credentials, 1)
	m.SetDialer(func(_ context.Context, _ SourceEntry, _ Manifest, cred plugin.Credentials, _ plugin.Handler) (conn, error) {
		given <- cred
		return &fakePlugin{caps: plugin.Capabilities{Push: true}}, nil
	})
	m.Start(context.Background())
	defer m.Stop(time.Second)

	cred := <-given
	if cred.AccessToken != "t0k" {
		t.Fatalf("credentials: %+v", cred)
	}
	if cred.ExpiresAt == "" {
		t.Fatal("the plugin was not told when its token dies")
	}
}

// An expired token is renewed by the app before the plugin is started, so a
// plugin never has to know what a refresh token is.
func TestAnExpiredTokenIsRenewedBeforeThePluginSeesIt(t *testing.T) {
	provider := oauthProvider(t)
	m, vault := connectManager(t, provider)
	entry, _ := m.Source("почта")
	entry.SecretRef = secretRefFor(entry.Name)
	if _, err := m.UpdateSource(entry); err != nil {
		t.Fatal(err)
	}
	expired, _ := json.Marshal(storedToken{
		Access: "просроченный", Refresh: "r0k", Expires: time.Now().Add(-time.Hour),
	})
	if err := vault.Set(entry.SecretRef, string(expired)); err != nil {
		t.Fatal(err)
	}

	cred := m.credentialsFor(context.Background(), entry)
	if cred.AccessToken != "обновлённый" {
		t.Fatalf("credentials: %+v", cred)
	}
	// And the new one is kept, so the next launch does not repeat the exchange.
	raw, _ := vault.Get(entry.SecretRef)
	var stored storedToken
	_ = json.Unmarshal([]byte(raw), &stored)
	if stored.Access != "обновлённый" || stored.Refresh != "r0k" {
		t.Fatalf("stored: %+v", stored)
	}
}

// A token somebody put in by hand is a bare string, not our JSON, and refusing
// it would be pedantry.
func TestATokenPutInByHandStillWorks(t *testing.T) {
	m, vault := connectManager(t, oauthProvider(t))
	entry, _ := m.Source("почта")
	entry.SecretRef = "source/почта"
	if _, err := m.UpdateSource(entry); err != nil {
		t.Fatal(err)
	}
	if err := vault.Set(entry.SecretRef, "просто-токен"); err != nil {
		t.Fatal(err)
	}

	if got := m.credentialsFor(context.Background(), entry); got.AccessToken != "просто-токен" {
		t.Fatalf("credentials: %+v", got)
	}
}

func TestDisconnectingForgetsTheCredentialAndKeepsTheSource(t *testing.T) {
	m, vault := connectManager(t, oauthProvider(t))
	if err := m.Connect(context.Background(), "почта", openInFakeBrowser); err != nil {
		t.Fatal(err)
	}
	entry, _ := m.Source("почта")

	if err := m.Disconnect("почта"); err != nil {
		t.Fatal(err)
	}
	if _, err := vault.Get(entry.SecretRef); err != secrets.ErrNotFound {
		t.Fatalf("the credential survived: %v", err)
	}
	if _, ok := m.Source("почта"); !ok {
		t.Fatal("the source went with it")
	}
	if got := m.Status("почта").State; got != StateNeedsReauth {
		t.Fatalf("state: %q", got)
	}
}

func TestConnectingWhatDoesNotNeedConnectingIsRefused(t *testing.T) {
	m, _ := connectManager(t, oauthProvider(t))
	if _, err := m.AddPlugin(Manifest{Name: "простой", Command: "/bin/true"}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.AddSource(SourceEntry{
		Name: "локальный", Plugin: "простой", BoardID: "board1", Enabled: true,
	}); err != nil {
		t.Fatal(err)
	}

	err := m.Connect(context.Background(), "локальный", openInFakeBrowser)
	if err == nil {
		t.Fatal("a plugin that needs no login was sent to one")
	}
	if err := m.Connect(context.Background(), "нет такого", openInFakeBrowser); err == nil {
		t.Fatal("an unknown source was connected")
	}
}
