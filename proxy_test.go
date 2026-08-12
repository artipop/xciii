package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
)

// upstream stands in for the in-process board server.
func upstream(t *testing.T, contentType, body string) int {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", contentType)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)

	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatal(err)
	}
	return port
}

func proxied(t *testing.T, port int) *http.Response {
	t.Helper()
	h, err := newServerProxy(port, "su-token")
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	return rec.Result()
}

func TestProxyInjectsTheBootstrapIntoHTML(t *testing.T) {
	res := proxied(t, upstream(t, "text/html; charset=utf-8", "<html><head><title>x</title></head><body>hi</body></html>"))
	body, _ := io.ReadAll(res.Body)
	page := string(body)

	if !strings.Contains(page, "su-token") || !strings.Contains(page, "window.go = ") {
		t.Fatalf("bootstrap missing from the page:\n%s", page)
	}
	// The page, the API and /ws share the front door's origin now, so nothing
	// has to tell the socket client where the board server lives.
	if strings.Contains(page, "webSocketBaseURL") {
		t.Error("bootstrap still overrides the WebSocket base URL")
	}
	// It has to land before the app's own scripts, which is what "right after
	// <head>" buys: the session token must exist by the time they run.
	if strings.Index(page, "xciiiSessionId") > strings.Index(page, "<title>") {
		t.Error("bootstrap injected after the head contents")
	}
	if got := res.Header.Get("Content-Length"); got != strconv.Itoa(len(body)) {
		t.Errorf("Content-Length %q does not match the rewritten body (%d)", got, len(body))
	}
}

func TestProxyLeavesNonHTMLAlone(t *testing.T) {
	res := proxied(t, upstream(t, "application/json", `{"ok":true}`))
	body, _ := io.ReadAll(res.Body)
	if string(body) != `{"ok":true}` {
		t.Errorf("json response was rewritten: %s", body)
	}
}

// v3 injects nothing into the page, so the bridge the webapp calls through —
// window.go.main.App and window.runtime — is ours to build on top of the v3
// runtime. Without it every ACP dialog silently decides it is not running in
// the desktop app.
func TestBootstrapBridgesTheWebappToTheV3Runtime(t *testing.T) {
	script := bootstrapScript("su-token")

	for _, want := range []string{
		`import('/wails/runtime.js')`,       // the runtime is loaded by the page itself
		`rt.Call.ByName('main.App.' + name`, // bound service methods, called by FQN
		`window.go = {main: {App: app}}`,    // the surface the webapp feature-detects
		`rt.Events.On(event`,                // window.runtime.EventsOn
		`callback(e && e.data)`,             // v3 passes an event object, v2 the payload
	} {
		if !strings.Contains(script, want) {
			t.Errorf("bootstrap does not contain %q:\n%s", want, script)
		}
	}
}

// The desktop webview cannot navigate to an outside origin, so every outward
// link has to be handed to the system browser. A previous version only caught
// target=_blank anchors carrying no inline onclick — which is exactly what a
// markdown link in a card comment is not, leaving such links dead on click.
func TestBootstrapSendsEveryOutwardLinkToTheBrowser(t *testing.T) {
	script := bootstrapScript("su-token")

	for _, want := range []string{
		`a[href]`, // every anchor, not only target=_blank ones
		`window.openInNewBrowser(href)`,
		`e.stopPropagation()`, // an inline onclick must not fire as well
		`, true)`,             // capture phase, so this runs first
	} {
		if !strings.Contains(script, want) {
			t.Errorf("bootstrap does not contain %q:\n%s", want, script)
		}
	}
	for _, unwanted := range []string{
		`a[target="_blank"]`,
		`getAttribute('onclick')`,
	} {
		if strings.Contains(script, unwanted) {
			t.Errorf("bootstrap still narrows the catch-all by %q", unwanted)
		}
	}
	// Same-origin navigation belongs to the app itself.
	if !strings.Contains(script, "window.location.origin") {
		t.Error("bootstrap does not keep in-app links inside the webview")
	}
}
