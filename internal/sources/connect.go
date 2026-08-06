package sources

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/artipop/xciii/internal/oauth"
	"github.com/artipop/xciii/internal/secrets"
)

// Connecting a source to the service behind it. The app performs the
// authorization and keeps what comes back; the plugin is handed an access token
// and never sees the rest. That split is the reason a plugin needs no browser,
// no listener and no keychain of its own — and the reason a plugin nobody
// audited cannot walk off with a refresh token.

// SetSecrets supplies where the credentials a plugin has to present are kept.
// Optional: without it a source that needs one starts with an empty token and
// says so through the plugin, which is what a plugin should do anyway.
func (m *Manager) SetSecrets(store secrets.Store) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.secrets = store
}

// storedToken is what is kept under a source's secretRef. It is JSON rather
// than the bare access token because a refresh token has to live somewhere too,
// and one entry that holds both is one thing to revoke.
type storedToken struct {
	Access  string    `json:"access"`
	Refresh string    `json:"refresh,omitempty"`
	Expires time.Time `json:"expires,omitempty"`
}

// secretRefFor is where a source's credentials are kept. Derived from the name
// rather than typed by anybody: two sources must not share an entry, and a name
// somebody chose is what they will look for when revoking it.
func secretRefFor(name string) string { return "source/" + name }

// Connect authorizes a source and stores what came back. openURL is handed the
// address to show the person; in the app that is the system browser.
func (m *Manager) Connect(ctx context.Context, name string, openURL func(string) error) error {
	entry, ok := m.Source(name)
	if !ok {
		return fmt.Errorf("источник %q не найден", name)
	}
	manifest, ok := m.Plugin(entry.Plugin)
	if !ok {
		return fmt.Errorf("плагин %q не зарегистрирован", entry.Plugin)
	}
	if manifest.Auth == nil || !strings.EqualFold(manifest.Auth.Type, "oauth2") {
		return fmt.Errorf("плагину %q не нужен вход через сервис", manifest.Name)
	}
	store := m.secretStore()
	if store == nil {
		return fmt.Errorf("негде хранить токен")
	}

	token, err := oauth.Authorize(ctx, oauth.Config{
		ClientID:     manifest.Auth.ClientID,
		ClientSecret: manifest.Auth.ClientSecret,
		AuthURL:      manifest.Auth.AuthorizationURL,
		TokenURL:     manifest.Auth.TokenURL,
		Scopes:       manifest.Auth.Scopes,
	}, openURL)
	if err != nil {
		return err
	}

	ref := secretRefFor(entry.Name)
	if err := saveToken(store, ref, token); err != nil {
		return err
	}
	// The entry only ever holds the name of the secret, never the secret.
	entry.SecretRef = ref
	if _, err := m.UpdateSource(entry); err != nil {
		return err
	}
	m.setStatus(entry.Name, func(s *Status) {
		s.State = StateOff
		s.Error = ""
	})
	m.record(EventRecord{Source: entry.Name, Outcome: OutcomeCommented,
		Detail: "источник подключён к сервису"})
	return nil
}

// Disconnect forgets a source's credentials. The source itself stays: what it
// has already brought is worth keeping, and reconnecting is one click.
func (m *Manager) Disconnect(name string) error {
	entry, ok := m.Source(name)
	if !ok {
		return fmt.Errorf("источник %q не найден", name)
	}
	if store := m.secretStore(); store != nil && entry.SecretRef != "" {
		if err := store.Delete(entry.SecretRef); err != nil {
			return err
		}
	}
	m.setStatus(entry.Name, func(s *Status) {
		s.State = StateNeedsReauth
		s.Error = "источник отключён от сервиса"
	})
	return nil
}

// credentialsFor is where the runner asks for a token, and where an expired one
// is renewed: a refresh is the app's business, not the plugin's, so a plugin
// never sees a refresh token and never has to know what to do with one.
func (m *Manager) refreshedToken(ctx context.Context, entry SourceEntry) (storedToken, bool) {
	store := m.secretStore()
	if store == nil || strings.TrimSpace(entry.SecretRef) == "" {
		return storedToken{}, false
	}
	token, err := loadToken(store, entry.SecretRef)
	if err != nil {
		if err != secrets.ErrNotFound {
			m.log.Warn("sources: не удалось прочитать токен", "source", entry.Name, "err", err)
		}
		return storedToken{}, false
	}
	if !oauth.Token(token.oauth()).Expired() || token.Refresh == "" {
		return token, true
	}

	manifest, ok := m.Plugin(entry.Plugin)
	if !ok || manifest.Auth == nil {
		return token, true
	}
	renewed, err := oauth.Refresh(ctx, oauth.Config{
		ClientID:     manifest.Auth.ClientID,
		ClientSecret: manifest.Auth.ClientSecret,
		TokenURL:     manifest.Auth.TokenURL,
		AuthURL:      manifest.Auth.AuthorizationURL,
	}, token.Refresh)
	if err != nil {
		// The old token may still have a few minutes in it, so it is handed
		// over rather than withheld; the plugin will say so if it does not.
		m.log.Warn("sources: не удалось обновить токен", "source", entry.Name, "err", err)
		m.setStatus(entry.Name, func(s *Status) {
			s.State = StateNeedsReauth
			s.Error = "не удалось обновить токен: " + err.Error()
		})
		return token, true
	}
	renewedStored := storedToken{Access: renewed.AccessToken, Refresh: renewed.RefreshToken, Expires: renewed.ExpiresAt}
	if err := saveToken(store, entry.SecretRef, renewed); err != nil {
		m.log.Warn("sources: не удалось сохранить обновлённый токен", "source", entry.Name, "err", err)
	}
	return renewedStored, true
}

func (t storedToken) oauth() oauth.Token {
	return oauth.Token{AccessToken: t.Access, RefreshToken: t.Refresh, ExpiresAt: t.Expires}
}

func saveToken(store secrets.Store, ref string, token oauth.Token) error {
	encoded, err := json.Marshal(storedToken{
		Access: token.AccessToken, Refresh: token.RefreshToken, Expires: token.ExpiresAt,
	})
	if err != nil {
		return err
	}
	return store.Set(ref, string(encoded))
}

// loadToken reads what Connect stored. A value that is not JSON is taken as the
// token itself: that is what somebody puts in the environment by hand, and
// refusing it would be pedantry.
func loadToken(store secrets.Store, ref string) (storedToken, error) {
	raw, err := store.Get(ref)
	if err != nil {
		return storedToken{}, err
	}
	var token storedToken
	if err := json.Unmarshal([]byte(raw), &token); err != nil || token.Access == "" {
		return storedToken{Access: raw}, nil
	}
	return token, nil
}

func (m *Manager) secretStore() secrets.Store {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.secrets
}
