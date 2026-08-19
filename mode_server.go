//go:build server

package main

import (
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/artipop/xciii/internal/acp"
)

// origin is the front door of a server build. Here Wails runs an HTTP server of
// its own, so ours stands in front of it: Wails gets a private loopback port
// and the front door owns the address people actually open.
//
// It exists for the same reason as in a desktop build — one origin for the
// page, the API and the socket. Wails' asset server refuses a WebSocket
// upgrade, so a board served through it could never carry /ws; served beside
// it, it can, and no window.webSocketBaseURL has to name a second port.
//
// The address is XCIII_SERVER_HOST/PORT, or the WAILS_SERVER_* names for
// familiarity. Whichever is used is then removed from the environment, since
// Wails' own server reads those too and would otherwise publish the private
// half of this on the same interface.
type origin struct {
	listener    net.Listener
	board       http.Handler
	acp         http.Handler
	ingest      http.Handler
	tailnet     *tailnetController
	privatePort int
	host        string
	// session says whether a request carries a live board session; nil in
	// single-user mode, where nothing does. See team.go.
	session func(string) bool
}

const defaultServerPort = 8080

func newOrigin(board, acp, ingest http.Handler, tailnet *tailnetController, session func(string) bool) (*origin, error) {
	host := envOnce("XCIII_SERVER_HOST", "WAILS_SERVER_HOST")
	if host == "" {
		host = "localhost"
	}
	port := defaultServerPort
	if raw := envOnce("XCIII_SERVER_PORT", "WAILS_SERVER_PORT"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 65535 {
			return nil, fmt.Errorf("front door: bad port %q", raw)
		}
		port = parsed
	}

	listener, err := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return nil, fmt.Errorf("front door: %w", err)
	}

	// Wails' server is an implementation detail of this process, so it gets a
	// port nobody is told about.
	private, err := getFreePort()
	if err != nil {
		_ = listener.Close()
		return nil, fmt.Errorf("front door: %w", err)
	}

	return &origin{
		listener:    listener,
		board:       board,
		acp:         acp,
		ingest:      ingest,
		tailnet:     tailnet,
		privatePort: private,
		host:        net.JoinHostPort(host, strconv.Itoa(port)),
		session:     session,
	}, nil
}

// envOnce reads the first of the given variables that is set and unsets all of
// them, so nothing downstream acts on the same value a second time.
func envOnce(names ...string) string {
	value := ""
	for _, name := range names {
		if value == "" {
			value = os.Getenv(name)
		}
		_ = os.Unsetenv(name)
	}
	return value
}

// transport is the stock one: in a server build Wails serves /wails/ itself,
// and the front door forwards to it.
func (o *origin) transport() application.Transport { return nil }

func (o *origin) serverOptions() application.ServerOptions {
	return application.ServerOptions{Host: "127.0.0.1", Port: o.privatePort}
}

// start serves the front door. /wails/ is proxied to Wails' private server —
// including the /wails/events WebSocket, which an ordinary reverse proxy
// upgrades without help — and everything else goes straight to the board.
func (o *origin) start() {
	target, err := url.Parse("http://127.0.0.1:" + strconv.Itoa(o.privatePort))
	if err != nil {
		log.Fatalf("front door: %v", err)
	}
	wails := httputil.NewSingleHostReverseProxy(target)
	server := &http.Server{Handler: newFrontDoor(wails, o.acp, o.ingest, o.board, o.host, o.session)}
	go func() {
		if err := server.Serve(o.listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("front door: %v", err)
		}
	}()
	// The tailnet gets a front door of its own rather than this one: the guards
	// are keyed to the authority the page is served under, and there it is a
	// tailnet name, not the address this build was published under.
	o.tailnet.publish(func(allowedHost string) http.Handler {
		return newFrontDoor(wails, o.acp, o.ingest, o.board, allowedHost, o.session)
	})
}

func (o *origin) url() string { return "http://" + o.host + "/" }

// A headless build has no windows to outlive, so the question the desktop
// answers with a flag — does closing the last one end us — never arises, and
// the ordinary answer is the right one.
func appShouldQuit() bool { return true }

// And nothing to bring back when there is no Dock to click.
func watchDockReopen(*application.App, string) {}

// newMainWindow opens nothing: a server build has no webview, and the same
// page is reached with a browser instead.
func newMainWindow(_ *application.App, url string) {
	log.Printf("server mode: no window; open %s in a browser", url)
}

// openTerminalWindow opens nothing in a server build: there are no windows, so
// the page that asked opens a browser tab at the same address instead.
func openTerminalWindow(_ *application.App, _ acp.TerminalInfo, _ string) bool { return false }

// openShareWindow has no window to open. A server build is reached with a
// browser, and the share dialog is a URL like any other page of it.
func openShareWindow(_ *application.App, url string) {
	log.Printf("server mode: no window; open %s in a browser", url)
}

// closeShareWindow has nothing to close: the dialog is a browser tab, and the
// page says what happened instead.
func closeShareWindow(_ *application.App) {}

// pickDirectory has no native dialog to open. Saying so is the point: an empty
// path would reach the UI as a cancelled picker and look like a bug.
func pickDirectory(_ *application.App, _ string) (string, error) {
	return "", errors.New("выбор папки недоступен в серверном режиме: впишите путь вручную")
}
