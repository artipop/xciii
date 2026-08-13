//go:build !server

package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/artipop/xciii/internal/acp"
)

// origin is the front door of a desktop build. A Wails desktop app has no HTTP
// server — the webview asks a custom scheme handler for its pages — so we bring
// one: a transport implementing AssetServerTransport is handed Wails' own asset
// handler and is then free to serve it wherever it likes.
//
// The window is pointed at that address instead of the wails:// origin, which
// is the whole point: a page served over real HTTP can open a real WebSocket,
// so /ws reaches the board directly and window.webSocketBaseURL is not needed.
// The listener is loopback-only and its port is random per launch.
type origin struct {
	*application.HTTPTransport

	listener net.Listener
	board    http.Handler
	acp      http.Handler
	ingest   http.Handler
	tailnet  *tailnetController
	server   *http.Server
}

// newOrigin binds the front door's listener up front, so its address is known
// before the application — and therefore the window — is created. Serving
// starts later, when Wails hands over the asset handler.
func newOrigin(board, acp, ingest http.Handler, tailnet *tailnetController) (*origin, error) {
	listener, err := listenLoopback(0)
	if err != nil {
		return nil, fmt.Errorf("front door: %w", err)
	}
	return &origin{
		HTTPTransport: application.NewHTTPTransport(),
		listener:      listener,
		board:         board,
		acp:           acp,
		ingest:        ingest,
		tailnet:       tailnet,
	}, nil
}

// ServeAssets is called by Wails once the asset server exists. Everything but
// /wails/ goes to the board.
func (o *origin) ServeAssets(assetHandler http.Handler) error {
	o.server = &http.Server{Handler: newFrontDoor(assetHandler, o.acp, o.ingest, o.board, o.host())}
	go func() {
		if err := o.server.Serve(o.listener); err != nil && err != http.ErrServerClosed {
			log.Printf("front door stopped: %v", err)
		}
	}()
	// The tailnet gets a front door of its own rather than this one: the guards
	// are keyed to the authority the page is served under, and there it is a
	// tailnet name, not this loopback address.
	o.tailnet.publish(func(allowedHost string) http.Handler {
		return newFrontDoor(assetHandler, o.acp, o.ingest, o.board, allowedHost)
	})
	return nil
}

func (o *origin) Stop() error {
	if o.server != nil {
		_ = o.server.Shutdown(context.Background())
	}
	return o.HTTPTransport.Stop()
}

func (o *origin) host() string { return o.listener.Addr().String() }

// url is where the window is pointed.
func (o *origin) url() string { return "http://" + o.host() + "/" }

// transport hands the front door to Wails as the IPC transport, which is how
// it gets to serve the assets at all.
func (o *origin) transport() application.Transport { return o }

// serverOptions are unused in a desktop build: nothing here binds a public port.
func (o *origin) serverOptions() application.ServerOptions { return application.ServerOptions{} }

// start is a no-op: the front door began serving from ServeAssets.
func (o *origin) start() {}

// newMainWindow opens the one window the desktop app has, on the front door's
// address rather than the wails:// origin.
func newMainWindow(wapp *application.App, url string) {
	win := wapp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "XCIII",
		// The stated size is what Restore returns to; the window itself opens
		// maximised (below).
		Width:  1024,
		Height: 768,
		URL:    url,
		// What shows between the window appearing and the page painting. Wails
		// cannot know which theme the page will choose, and of the two seams a
		// dark one is the quieter mistake.
		BackgroundColour: application.NewRGB(12, 12, 14),
	})
	// Maximised, not fullscreen: the board is the kind of thing a person gives
	// the whole screen to, and a 1024×768 default opened every session with
	// the columns squeezed and a resize as the first chore. Done when the
	// runtime reports the window ready rather than as StartState, which this
	// Wails runs before the window can zoom, so it opened at the stated size
	// anyway.
	var once sync.Once
	win.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		once.Do(func() { win.Maximise() })
	})
}

// openTerminalWindow gives a terminal session a window of its own — the app's
// own window, not a shell somebody opened beside it: it is named after the
// session, so asking twice focuses the one that exists, and it closes with the
// app. Reports whether a window was opened at all.
func openTerminalWindow(wapp *application.App, info acp.TerminalInfo, url string) bool {
	name := "acp-terminal-" + info.ID
	if existing, ok := wapp.Window.GetByName(name); ok {
		existing.Show()
		existing.Focus()
		return true
	}
	title := "Терминал агента " + info.Agent
	if info.Title != "" {
		title = info.Title + " · " + info.Agent
	}
	wapp.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:   name,
		Title:  title,
		Width:  980,
		Height: 640,
		URL:    url,
		// A terminal is dark by default and a white flash on open is what
		// everyone remembers about a terminal in a webview. This is the same
		// black the page paints, so there is no seam at all.
		BackgroundColour: application.NewRGB(12, 12, 14),
	})
	return true
}

// openShareWindow opens the share dialog: a small window, on top of whatever
// the person was reading when they pressed «Поделиться», and named so that a
// second share focuses the one already open rather than stacking dialogs.
//
// It is deliberately not the main window: the app may not be running visibly at
// all, and showing somebody their whole board because they shared a link would
// be answering a question they did not ask.
func openShareWindow(wapp *application.App, url string) {
	if existing, ok := wapp.Window.GetByName(shareWindowName); ok {
		existing.SetURL(url)
		existing.Show()
		existing.Focus()
		return
	}
	wapp.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             shareWindowName,
		Title:            "Сохранить на доску",
		Width:            420,
		Height:           520,
		DisableResize:    true,
		AlwaysOnTop:      true,
		BackgroundColour: application.NewRGB(12, 12, 14),
		URL:              url,
	})
}

// closeShareWindow shuts the dialog once it has said what happened.
func closeShareWindow(wapp *application.App) {
	if existing, ok := wapp.Window.GetByName(shareWindowName); ok {
		existing.Close()
	}
}

// pickDirectory opens the native folder picker.
func pickDirectory(wapp *application.App, title string) (string, error) {
	dialog := wapp.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		Title:                title,
		CanChooseDirectories: true,
		CanChooseFiles:       false,
	})
	return dialog.PromptForSingleSelection()
}
