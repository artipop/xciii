// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func named(name string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(name))
	})
}

func request(t *testing.T, h http.Handler, path string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Host = "127.0.0.1:9000"
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// The split is the whole design: Wails owns /wails/ and the board owns
// everything else, /ws included — which is what lets the socket live on the
// page's own origin instead of being told a second address.
func TestFrontDoorSendsWailsToWailsAndTheRestToTheBoard(t *testing.T) {
	door := newFrontDoor(named("wails"), named("acp"), named("board"), "127.0.0.1:9000")

	for path, want := range map[string]string{
		"/wails/runtime.js":    "wails",
		"/wails/runtime":       "wails",
		"/acp/terminal/abc/ws": "acp",
		"/acp/events/ws":       "acp",
		"/":                    "board",
		"/ws":                  "board",
		"/api/v2/teams":        "board",
	} {
		if got := request(t, door, path, nil).Body.String(); got != want {
			t.Errorf("%s went to %q, want %q", path, got, want)
		}
	}
}

// The bound methods start agents and read the filesystem, and the runtime
// endpoint carries no credential of its own. Any page in any browser can reach
// a loopback port, so a call whose Origin is somebody else's page is refused —
// the response would be unreadable to them, the side effect would not.
func TestFrontDoorRefusesCrossOriginRuntimeCalls(t *testing.T) {
	door := newFrontDoor(named("wails"), named("acp"), named("board"), "127.0.0.1:9000")

	cases := []struct {
		name    string
		headers map[string]string
		want    int
	}{
		{"no origin (a plain GET from our own page)", nil, http.StatusOK},
		{"our own origin", map[string]string{"Origin": "http://127.0.0.1:9000"}, http.StatusOK},
		{"same-origin fetch metadata", map[string]string{"Sec-Fetch-Site": "same-origin"}, http.StatusOK},
		{"another site", map[string]string{"Origin": "https://evil.example"}, http.StatusForbidden},
		{"another site by fetch metadata", map[string]string{"Sec-Fetch-Site": "cross-site"}, http.StatusForbidden},
	}
	for _, c := range cases {
		if got := request(t, door, "/wails/runtime", c.headers).Code; got != c.want {
			t.Errorf("%s: status %d, want %d", c.name, got, c.want)
		}
	}
}

// The tailnet door serves the same handler over TLS (tsnetdoor.go), so the
// page's own origin is https there. Without this the phone's every binding call
// and both sockets would be refused as somebody else's site — and the board
// would look broken in a way nothing in the page could explain.
func TestFrontDoorAcceptsItsOwnOriginOverTLS(t *testing.T) {
	door := newFrontDoor(named("wails"), named("acp"), named("board"), "board.tail1234.ts.net")

	for _, path := range []string{"/wails/runtime", "/acp/events/ws", "/acp/terminal/abc/ws"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Host = "board.tail1234.ts.net"
		req.Header.Set("Origin", "https://board.tail1234.ts.net")
		rec := httptest.NewRecorder()
		door.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("%s: status %d, want 200", path, rec.Code)
		}
	}
}

// A name the attacker controls, repointed at 127.0.0.1, would otherwise be
// same-origin with the app for as long as it is running.
func TestFrontDoorRefusesAnUnexpectedHost(t *testing.T) {
	door := newFrontDoor(named("wails"), named("acp"), named("board"), "127.0.0.1:9000")

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Host = "rebind.example:9000"
	rec := httptest.NewRecorder()
	door.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("status %d, want %d", rec.Code, http.StatusForbidden)
	}

	// localhost and 127.0.0.1 are the same machine on the same port, and the
	// user may well type either.
	for _, host := range []string{"localhost:9000", "127.0.0.1:9000", "[::1]:9000"} {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Host = host
		rec := httptest.NewRecorder()
		door.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("Host %s: status %d, want 200", host, rec.Code)
		}
	}
}

// A server build published on every interface is reached by whatever name the
// user's DNS gives it, so there is no authority left to check — only the port.
// Without this, `XCIII_SERVER_HOST=0.0.0.0` would answer 403 to everyone
// but localhost, which is the opposite of what asking for it means.
func TestFrontDoorPublishedOnEveryInterfaceAcceptsAnyName(t *testing.T) {
	door := newFrontDoor(named("wails"), named("acp"), named("board"), "0.0.0.0:8080")

	for host, want := range map[string]int{
		"boards.internal:8080": http.StatusOK,
		"192.168.1.10:8080":    http.StatusOK,
		"boards.internal:9999": http.StatusForbidden, // a different port is a different server
	} {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Host = host
		rec := httptest.NewRecorder()
		door.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Errorf("Host %s: status %d, want %d", host, rec.Code, want)
		}
	}
}
