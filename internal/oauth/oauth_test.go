package oauth

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// The provider these tests talk to is an httptest server: the flow is worth
// pinning end to end — the browser is sent somewhere, something comes back to
// the loopback listener, a token is fetched — and none of that needs a real
// service to be exercised.

// fakeProvider stands in for the service being authorized against. It checks
// what a real one would check, so a mistake on our side fails here rather than
// against somebody's production login page.
type fakeProvider struct {
	server   *httptest.Server
	verifier string // the challenge it was given, to prove PKCE is real
	failWith string
}

func newProvider(t *testing.T) *fakeProvider {
	t.Helper()
	p := &fakeProvider{}
	mux := http.NewServeMux()

	// The browser: it goes to the authorization URL and is sent back to the
	// redirect with a code.
	mux.HandleFunc("/auth", func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		p.verifier = query.Get("code_challenge")
		back, _ := url.Parse(query.Get("redirect_uri"))
		answer := url.Values{"state": {query.Get("state")}}
		if p.failWith != "" {
			answer.Set("error", p.failWith)
		} else {
			answer.Set("code", "код-1")
		}
		back.RawQuery = answer.Encode()
		http.Redirect(w, r, back.String(), http.StatusFound)
	})

	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Form.Get("grant_type") == "refresh_token" {
			writeJSON(w, `{"access_token":"новый","expires_in":3600}`)
			return
		}
		if r.Form.Get("code_verifier") == "" {
			http.Error(w, `{"error":"invalid_request"}`, http.StatusBadRequest)
			return
		}
		writeJSON(w, `{"access_token":"t0k","refresh_token":"r0k","expires_in":3600}`)
	})

	p.server = httptest.NewServer(mux)
	t.Cleanup(p.server.Close)
	return p
}

func writeJSON(w http.ResponseWriter, body string) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprint(w, body)
}

func (p *fakeProvider) config() Config {
	return Config{
		ClientID: "клиент",
		AuthURL:  p.server.URL + "/auth",
		TokenURL: p.server.URL + "/token",
		Scopes:   []string{"read", "write"},
	}
}

// browser is what the app hands the address to. Here it is an HTTP client that
// follows the redirect, which is exactly what a browser does with it.
func browser(t *testing.T) func(string) error {
	t.Helper()
	return func(address string) error {
		go func() {
			resp, err := http.Get(address)
			if err == nil {
				resp.Body.Close()
			}
		}()
		return nil
	}
}

func TestTheWholeFlowEndsInAToken(t *testing.T) {
	provider := newProvider(t)

	token, err := Authorize(context.Background(), provider.config(), browser(t))
	if err != nil {
		t.Fatal(err)
	}
	if token.AccessToken != "t0k" || token.RefreshToken != "r0k" {
		t.Fatalf("token: %+v", token)
	}
	if token.ExpiresAt.IsZero() || token.Expired() {
		t.Fatalf("expiry: %+v", token.ExpiresAt)
	}
	// PKCE is what proves the answer came back to the program that asked, and a
	// flow that quietly stopped sending the challenge would still pass every
	// other assertion here.
	if provider.verifier == "" {
		t.Fatal("the provider was given no code challenge")
	}
}

// The listener exists for the authorization and not a moment longer: it is a
// port on this machine that anything could reach.
func TestTheLoopbackListenerIsClosedAfterwards(t *testing.T) {
	provider := newProvider(t)
	var redirect string
	open := func(address string) error {
		parsed, _ := url.Parse(address)
		redirect = parsed.Query().Get("redirect_uri")
		go func() {
			resp, err := http.Get(address)
			if err == nil {
				resp.Body.Close()
			}
		}()
		return nil
	}

	if _, err := Authorize(context.Background(), provider.config(), open); err != nil {
		t.Fatal(err)
	}
	if redirect == "" {
		t.Fatal("no redirect address was given to the browser")
	}
	if !strings.HasPrefix(redirect, "http://127.0.0.1:") {
		t.Fatalf("the redirect must be loopback: %q", redirect)
	}
	// Give the deferred shutdown a moment, then knock.
	time.Sleep(50 * time.Millisecond)
	if resp, err := http.Get(redirect); err == nil {
		resp.Body.Close()
		t.Fatal("the listener is still open after the flow finished")
	}
}

// Without this check any page in any browser could send a code to that port.
func TestAnAnswerToSomebodyElsesRequestIsRefused(t *testing.T) {
	provider := newProvider(t)
	open := func(address string) error {
		parsed, _ := url.Parse(address)
		back, _ := url.Parse(parsed.Query().Get("redirect_uri"))
		back.RawQuery = url.Values{"code": {"чужой"}, "state": {"не наш"}}.Encode()
		go func() {
			resp, err := http.Get(back.String())
			if err == nil {
				resp.Body.Close()
			}
		}()
		return nil
	}

	_, err := Authorize(context.Background(), provider.config(), open)
	if err == nil || !strings.Contains(err.Error(), "не на наш запрос") {
		t.Fatalf("err = %v", err)
	}
}

func TestARefusalFromTheServiceIsPassedOn(t *testing.T) {
	provider := newProvider(t)
	provider.failWith = "access_denied"

	_, err := Authorize(context.Background(), provider.config(), browser(t))
	if err == nil || !strings.Contains(err.Error(), "access_denied") {
		t.Fatalf("err = %v", err)
	}
}

// A person who closes the browser instead of logging in must not leave a
// listener open for the rest of the day.
func TestAnAbandonedLoginDoesNotWaitForEver(t *testing.T) {
	provider := newProvider(t)
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan error, 1)
	go func() {
		_, err := Authorize(ctx, provider.config(), func(string) error { return nil })
		done <- err
	}()
	cancel()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("an abandoned login returned a token")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the flow did not give up")
	}
}

// Providers differ on whether a refresh returns a new refresh token, and losing
// the old one would turn a working source into one that needs a person.
func TestRefreshKeepsTheRefreshTokenWhenNoneComesBack(t *testing.T) {
	provider := newProvider(t)

	token, err := Refresh(context.Background(), provider.config(), "r0k")
	if err != nil {
		t.Fatal(err)
	}
	if token.AccessToken != "новый" || token.RefreshToken != "r0k" {
		t.Fatalf("token: %+v", token)
	}
	if _, err := Refresh(context.Background(), provider.config(), ""); err == nil {
		t.Fatal("refreshing without a token should say a person is needed")
	}
}

// A manifest that cannot work says so before a browser is opened.
func TestAProviderIsCheckedBeforeAnybodyIsSentAnywhere(t *testing.T) {
	opened := false
	open := func(string) error { opened = true; return nil }

	cases := map[string]Config{
		"без clientId":   {AuthURL: "https://example.com/a", TokenURL: "https://example.com/t"},
		"не адрес":       {ClientID: "c", AuthURL: "почти", TokenURL: "https://example.com/t"},
		"не https":       {ClientID: "c", AuthURL: "http://example.com/a", TokenURL: "https://example.com/t"},
		"токен не https": {ClientID: "c", AuthURL: "https://example.com/a", TokenURL: "http://example.com/t"},
	}
	for name, cfg := range cases {
		if _, err := Authorize(context.Background(), cfg, open); err == nil {
			t.Errorf("%s: принято", name)
		}
	}
	if opened {
		t.Fatal("a browser was opened for a provider that cannot work")
	}
}

func TestAnExpiredTokenIsSeenAsExpiredBeforeItIs(t *testing.T) {
	// A token expiring in thirty seconds has expired for practical purposes: a
	// request made with it may well arrive after it has.
	soon := Token{AccessToken: "t", ExpiresAt: time.Now().Add(30 * time.Second)}
	if !soon.Expired() {
		t.Error("a token about to expire counts as valid")
	}
	later := Token{AccessToken: "t", ExpiresAt: time.Now().Add(time.Hour)}
	if later.Expired() {
		t.Error("a token good for an hour counts as expired")
	}
	// No expiry given means the provider did not say, not that it is dead.
	if (Token{AccessToken: "t"}).Expired() {
		t.Error("a token with no expiry counts as expired")
	}
}
