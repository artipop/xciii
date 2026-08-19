package main

import (
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/artipop/xciii/internal/acp"
)

// The front door is the origin the page actually talks to — the webview in a
// desktop build, the browser in a server build. Everything behind it is one
// host and port: the board itself (HTML, /api, /files and the /ws socket) and
// the Wails runtime (/wails/runtime.js, the IPC endpoint, and in a server build
// the event socket).
//
// One origin is what removes window.webSocketBaseURL. Wails' asset server
// answers a WebSocket upgrade with 501 and its response writer cannot be
// hijacked, so /ws can never be served through it; routing /wails/ to Wails and
// everything else to the board leaves the socket on a plain net/http server of
// ours, where an upgrade is ordinary.

// newFrontDoor routes /wails/ to the Wails runtime, /acp/ to our own sockets
// (the terminal windows), /sources/ to the ingest endpoint and everything else
// to the board. allowedHost is the authority the page is served under; a
// request for any other Host is refused, since a name that resolves to this
// listener but isn't the one we handed out is somebody else's DNS entry
// pointing here.
//
// session says whether a request carries a live board session, and is nil in
// single-user mode, where there is nothing to carry: the routes that are about
// this machine rather than about a board — the bound methods, the terminal
// sockets — are then guarded by the origin and the Host alone. In team mode it
// is what stops a person who has not logged in from starting an agent
// (team.go).
func newFrontDoor(wails, acpRoutes, ingest, board http.Handler, allowedHost string, session func(string) bool) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/wails/", requireSession(sameOrigin(wails, allowedHost), session))
	// Only the socket, not the path around it: /acp/terminal/{id} is the page
	// that draws the terminal, and that is the webapp, which the board serves
	// like any other of its routes. A terminal socket is a shell in the user's
	// project, so it is guarded exactly as the runtime is — more so, if
	// anything.
	mux.Handle("/acp/terminal/{id}/ws", requireSession(sameOrigin(acpRoutes, allowedHost), session))
	// The UI event socket is guarded the same way and for the same reason: it
	// says what the agents are doing on this machine.
	mux.Handle("/acp/events/ws", requireSession(sameOrigin(acpRoutes, allowedHost), session))
	// The board tools an agent calls (boardapi.go). Same origin guard — a page
	// has no business calling these — on top of the grant token they actually
	// authenticate with: the caller is a local process, and a local process
	// sends no Origin, so the guard costs it nothing and still keeps a browser
	// out.
	mux.Handle("/acp/board/", sameOrigin(acpRoutes, allowedHost))
	// The permission hook an agent CLI calls (internal/acp/toolhook.go). Same
	// bargain as the tools above: a grant token is the authentication, and the
	// origin guard is free because the caller is a local process with no Origin.
	mux.Handle(acp.HookPath, sameOrigin(acpRoutes, allowedHost))
	// The one route here that is *not* same-origin, and it cannot be: what
	// posts to it is a script, a webhook or a phone, so its Origin is somebody
	// else's or absent. Its own token is what stands in for the check — see
	// ingest.go.
	mux.Handle("/sources/ingest/{name}", ingest)
	mux.Handle("/", board)
	return hostGuard(requestLog(mux), allowedHost)
}

// requestLog prints every request the front door serves when
// FRONTDOOR_DEBUG is set. A window that shows nothing is otherwise
// silent — the webview has a console nobody can read — and the first question
// is always which of these three the page actually asked for.
func requestLog(next http.Handler) http.Handler {
	if os.Getenv("FRONTDOOR_DEBUG") == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("front door: %s %s (origin %q)", r.Method, r.URL.Path, r.Header.Get("Origin"))
		next.ServeHTTP(w, r)
	})
}

// sameOrigin refuses a cross-site request to the Wails runtime. The bound
// methods start agents and read the filesystem, and the endpoint carries no
// credential of its own: without this any page in any browser could POST to the
// front door and have the call go through — unreadable to it, but done.
//
// A same-origin fetch sends no Origin header (a GET) or sends ours.
//
// Both schemes count, because the same handler is published twice: HTTP on
// loopback for the window, TLS on the tailnet for a phone. The guard is about
// which *site* is calling, and that is the host.
func sameOrigin(next http.Handler, allowedHost string) http.Handler {
	allowed := map[string]bool{
		"http://" + allowedHost:  true,
		"https://" + allowedHost: true,
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" && !allowed[origin] {
			http.Error(w, "cross-origin request refused", http.StatusForbidden)
			return
		}
		if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
			http.Error(w, "cross-site request refused", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// hostGuard refuses a request whose Host is not the authority the front door
// was published under — the standard defence against DNS rebinding, where a
// name the attacker controls is repointed at 127.0.0.1 so their page becomes
// same-origin with ours.
func hostGuard(next http.Handler, allowedHost string) http.Handler {
	allowedPort := portOf(allowedHost)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !hostAllowed(r.Host, allowedHost, allowedPort) {
			http.Error(w, "unexpected Host header", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// hostAllowed accepts the published authority and the loopback names that mean
// the same machine on the same port, so http://localhost:port works when the
// front door was published as 127.0.0.1:port and the other way round.
//
// A front door bound to every interface has no authority to check against — the
// name it is reached by is whatever DNS the user has — so it accepts any Host
// on its port. Binding to 0.0.0.0 is already the deliberate act of publishing
// this to a network, where the guard would be the wrong layer anyway.
func hostAllowed(host, allowedHost, allowedPort string) bool {
	if host == allowedHost {
		return true
	}
	name, port, err := net.SplitHostPort(host)
	if err != nil {
		return false
	}
	if port != allowedPort {
		return false
	}
	if boundHost := strings.TrimSuffix(allowedHost, ":"+allowedPort); isWildcardHost(boundHost) {
		return true
	}
	switch strings.ToLower(name) {
	case "localhost", "127.0.0.1", "[::1]", "::1":
		return true
	}
	return false
}

func isWildcardHost(host string) bool {
	switch host {
	case "", "0.0.0.0", "[::]", "::", "[::0]":
		return true
	}
	return false
}

func portOf(hostport string) string {
	if _, port, err := net.SplitHostPort(hostport); err == nil {
		return port
	}
	return ""
}

// listenLoopback binds a listener on the loopback interface. A port of 0 asks
// the kernel for a free one, which is what a desktop build wants: the front
// door is private to this process and its window.
func listenLoopback(port int) (net.Listener, error) {
	return net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
}
