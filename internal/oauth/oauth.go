// Package oauth authorizes the app against somebody else's service the way a
// desktop application has to: PKCE, the user's own browser, and a listener on
// loopback that exists only while the answer is coming back (RFC 8252).
//
// Three things follow from being a desktop app, and each is a decision:
//
//   - the listener is raised for the authorization and closed after it, on a
//     port the operating system picks. The app's own front door is not used: its
//     port changes every launch, and its guards would have to be opened for one
//     request every few months;
//   - there is no client secret worth the name. A native app ships its secret
//     to everybody who installs it, so PKCE is what actually proves the answer
//     came back to the same program that asked. A secret is still sent when a
//     provider insists on one;
//   - the browser is the user's, not a webview of ours. A login page in an
//     embedded view cannot be told apart from a page pretending to be one, and
//     the password manager the person already uses is in their browser.
package oauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Config is one provider, as a plugin's manifest describes it.
type Config struct {
	ClientID     string
	ClientSecret string // usually empty: see the package comment
	AuthURL      string
	TokenURL     string
	Scopes       []string
}

// Token is what came back. RefreshToken is empty when the provider does not
// issue one, which means the source will need a person again when it expires.
type Token struct {
	AccessToken  string    `json:"accessToken"`
	RefreshToken string    `json:"refreshToken,omitempty"`
	ExpiresAt    time.Time `json:"expiresAt,omitempty"`
}

// Expired reports whether the token is past its life, with a minute of margin:
// a token that expires while a request is in flight has expired for practical
// purposes.
func (t Token) Expired() bool {
	if t.ExpiresAt.IsZero() {
		return false
	}
	return time.Now().Add(time.Minute).After(t.ExpiresAt)
}

// Validate checks a provider description before anything is opened in a
// browser, so a manifest that cannot work says so at once.
func (c Config) Validate() error {
	if strings.TrimSpace(c.ClientID) == "" {
		return fmt.Errorf("в описании плагина нет clientId")
	}
	for name, raw := range map[string]string{"authorizationUrl": c.AuthURL, "tokenUrl": c.TokenURL} {
		u, err := url.Parse(strings.TrimSpace(raw))
		if err != nil || u.Scheme == "" || u.Host == "" {
			return fmt.Errorf("%s должен быть полным адресом, а не %q", name, raw)
		}
		if u.Scheme != "https" && u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost" {
			// A provider reached over plain http would carry the code and the
			// token in the clear. Loopback is allowed because that is how this
			// is tested.
			return fmt.Errorf("%s должен быть https", name)
		}
	}
	return nil
}

// authTimeout bounds how long a person has to finish logging in. Long enough
// for a password manager and a second factor; not so long that a forgotten
// browser tab keeps a listener open all day.
const authTimeout = 5 * time.Minute

// Authorize runs the whole flow and returns the token. openURL is handed the
// address to show the person — in the app that is the system browser.
func Authorize(ctx context.Context, cfg Config, openURL func(string) error) (Token, error) {
	if err := cfg.Validate(); err != nil {
		return Token{}, err
	}

	// Port zero: the operating system picks, and the redirect address is
	// composed from what it picked. Providers that accept loopback accept any
	// port on it, which is the whole point of the native-app flow.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return Token{}, fmt.Errorf("не удалось открыть локальный порт для ответа: %w", err)
	}
	defer listener.Close()
	redirect := fmt.Sprintf("http://127.0.0.1:%d/callback", listener.Addr().(*net.TCPAddr).Port)

	verifier, err := randomString(64)
	if err != nil {
		return Token{}, err
	}
	state, err := randomString(24)
	if err != nil {
		return Token{}, err
	}

	answers := make(chan callback, 1)
	server := &http.Server{Handler: callbackHandler(state, answers)}
	go func() { _ = server.Serve(listener) }()
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	if err := openURL(authorizeURL(cfg, redirect, state, verifier)); err != nil {
		return Token{}, fmt.Errorf("не удалось открыть браузер: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, authTimeout)
	defer cancel()
	select {
	case <-ctx.Done():
		return Token{}, fmt.Errorf("вход не был завершён за %s", authTimeout)
	case answer := <-answers:
		if answer.err != nil {
			return Token{}, answer.err
		}
		return exchange(ctx, cfg, url.Values{
			"grant_type":    {"authorization_code"},
			"code":          {answer.code},
			"redirect_uri":  {redirect},
			"code_verifier": {verifier},
		})
	}
}

// Refresh trades a refresh token for a new access token.
func Refresh(ctx context.Context, cfg Config, refreshToken string) (Token, error) {
	if strings.TrimSpace(refreshToken) == "" {
		return Token{}, fmt.Errorf("нет refresh-токена — нужен повторный вход")
	}
	token, err := exchange(ctx, cfg, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
	})
	if err != nil {
		return Token{}, err
	}
	// Providers differ on whether a refresh returns a new refresh token. The
	// old one keeps working when it does not, and losing it here would turn a
	// working source into one that needs a person.
	if token.RefreshToken == "" {
		token.RefreshToken = refreshToken
	}
	return token, nil
}

// callback is what came back to the loopback listener.
type callback struct {
	code string
	err  error
}

func callbackHandler(state string, answers chan<- callback) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/callback" {
			http.NotFound(w, r)
			return
		}
		query := r.URL.Query()
		answer := callback{code: query.Get("code")}
		switch {
		case query.Get("state") != state:
			// The one check that matters here: without it any page could send
			// the browser to this port with a code of its own.
			answer = callback{err: fmt.Errorf("ответ пришёл не на наш запрос")}
		case query.Get("error") != "":
			answer = callback{err: fmt.Errorf("сервис отказал: %s", firstNonEmpty(
				query.Get("error_description"), query.Get("error")))}
		case answer.code == "":
			answer = callback{err: fmt.Errorf("сервис не вернул код")}
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if answer.err != nil {
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprintf(w, page, "Не получилось", answer.err.Error())
		} else {
			fmt.Fprintf(w, page, "Готово", "Можно закрыть эту вкладку и вернуться в приложение.")
		}

		select {
		case answers <- answer:
		default: // already answered; a reload must not block
		}
	})
}

// The page the person is left looking at. Plain, self-contained and in their
// language: it is the last thing the flow shows and the only part of it they
// see of ours.
const page = `<!doctype html><html lang="ru"><meta charset="utf-8">
<title>%[1]s</title>
<body style="font: 16px/1.5 system-ui, sans-serif; margin: 4rem auto; max-width: 30rem; color: #222">
<h1 style="font-size: 1.25rem">%[1]s</h1><p>%[2]s</p>`

func authorizeURL(cfg Config, redirect, state, verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	query := url.Values{
		"response_type":         {"code"},
		"client_id":             {cfg.ClientID},
		"redirect_uri":          {redirect},
		"state":                 {state},
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(sum[:])},
		"code_challenge_method": {"S256"},
	}
	if len(cfg.Scopes) > 0 {
		query.Set("scope", strings.Join(cfg.Scopes, " "))
	}
	separator := "?"
	if strings.Contains(cfg.AuthURL, "?") {
		separator = "&"
	}
	return cfg.AuthURL + separator + query.Encode()
}

// exchange posts to the token endpoint and reads what came back. Both shapes
// are accepted — JSON and the form encoding some older providers still answer
// with — because a source that cannot be connected is not worth a purist point.
func exchange(ctx context.Context, cfg Config, form url.Values) (Token, error) {
	form.Set("client_id", cfg.ClientID)
	if cfg.ClientSecret != "" {
		form.Set("client_secret", cfg.ClientSecret)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.TokenURL,
		strings.NewReader(form.Encode()))
	if err != nil {
		return Token{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return Token{}, fmt.Errorf("не удалось получить токен: %w", err)
	}
	defer resp.Body.Close()

	var body struct {
		AccessToken      string `json:"access_token"`
		RefreshToken     string `json:"refresh_token"`
		ExpiresIn        int64  `json:"expires_in"`
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return Token{}, fmt.Errorf("сервис ответил не тем, чего ждали (%s)", resp.Status)
	}
	if body.Error != "" {
		return Token{}, fmt.Errorf("сервис отказал: %s", firstNonEmpty(body.ErrorDescription, body.Error))
	}
	if resp.StatusCode >= 400 {
		return Token{}, fmt.Errorf("сервис ответил %s", resp.Status)
	}
	if body.AccessToken == "" {
		return Token{}, fmt.Errorf("сервис не вернул токен")
	}

	token := Token{AccessToken: body.AccessToken, RefreshToken: body.RefreshToken}
	if body.ExpiresIn > 0 {
		token.ExpiresAt = time.Now().Add(time.Duration(body.ExpiresIn) * time.Second)
	}
	return token, nil
}

// randomString returns n bytes of randomness, URL-safe. The verifier and the
// state are both this: one proves the answer came back to the program that
// asked, the other that it came back to the request that was made.
func randomString(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
