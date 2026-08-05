// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
)

// The front door is the origin the page actually talks to — the webview in a
// desktop build, the browser in a server build. Everything behind it is one
// host and port: the board itself (HTML, /api, /files and the /ws socket) and
// the Wails runtime (/wails/runtime.js, the IPC endpoint, and in a server build
// the event socket).
//
// That single origin is what removes window.webSocketBaseURL. Wails' asset
// server answers a WebSocket upgrade with 501 Not Implemented, and its response
// writer cannot be hijacked, so /ws can never be served through it — which is
// why the desktop app used to send the socket to the board server on a second
// port and had to tell the webapp that port's address. Routing /wails/ to Wails
// and everything else to the board leaves the socket on a plain net/http server
// of ours, where an upgrade is ordinary.

// newFrontDoor routes /wails/ to the Wails runtime, /acp/ to our own sockets
// (the terminal windows) and everything else to the board. allowedHost is the
// authority the page is served under; a request for any other Host is refused,
// since a name that resolves to this listener but isn't the one we handed out
// is somebody else's DNS entry pointing here.
func newFrontDoor(wails, acp, board http.Handler, allowedHost string) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/wails/", sameOrigin(wails, allowedHost))
	// Only the socket, not the path around it: /acp/terminal/{id} is the page
	// that draws the terminal, and that is the webapp, which the board serves
	// like any other of its routes. A terminal socket is a shell in the user's
	// repository, so it is guarded exactly as the runtime is — more so, if
	// anything.
	mux.Handle("/acp/terminal/{id}/ws", sameOrigin(acp, allowedHost))
	mux.Handle("/", board)
	return hostGuard(requestLog(mux), allowedHost)
}

// requestLog prints every request the front door serves when
// XCIII_FRONTDOOR_DEBUG is set. A window that shows nothing is otherwise
// silent — the webview has a console nobody can read — and the first question
// is always which of these three the page actually asked for.
func requestLog(next http.Handler) http.Handler {
	if os.Getenv("XCIII_FRONTDOOR_DEBUG") == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("front door: %s %s (origin %q)", r.Method, r.URL.Path, r.Header.Get("Origin"))
		next.ServeHTTP(w, r)
	})
}

// sameOrigin refuses a cross-site request to the Wails runtime. The bound
// methods start agents and read the filesystem, and the runtime endpoint
// carries no credential of its own, so without this any page open in any
// browser could POST to the front door while the app is running and have the
// call go through — the response would be unreadable to it, the side effect
// would not.
//
// A same-origin fetch either sends no Origin header at all (a GET) or sends
// ours; anything else is somebody else's page.
func sameOrigin(next http.Handler, allowedHost string) http.Handler {
	allowed := map[string]bool{
		"http://" + allowedHost: true,
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
