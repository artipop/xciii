// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

//go:build !server

package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"

	"github.com/wailsapp/wails/v3/pkg/application"

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
	server   *http.Server
}

// newOrigin binds the front door's listener up front, so its address is known
// before the application — and therefore the window — is created. Serving
// starts later, when Wails hands over the asset handler.
func newOrigin(board, acp http.Handler) (*origin, error) {
	listener, err := listenLoopback(0)
	if err != nil {
		return nil, fmt.Errorf("front door: %w", err)
	}
	return &origin{
		HTTPTransport: application.NewHTTPTransport(),
		listener:      listener,
		board:         board,
		acp:           acp,
	}, nil
}

// ServeAssets is called by Wails once the asset server exists. Everything but
// /wails/ goes to the board.
func (o *origin) ServeAssets(assetHandler http.Handler) error {
	o.server = &http.Server{Handler: newFrontDoor(assetHandler, o.acp, o.board, o.host())}
	go func() {
		if err := o.server.Serve(o.listener); err != nil && err != http.ErrServerClosed {
			log.Printf("front door stopped: %v", err)
		}
	}()
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
	wapp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "XCIII",
		Width:  1024,
		Height: 768,
		URL:    url,
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
		// everyone remembers about a terminal in a webview.
		BackgroundColour: application.NewRGB(24, 24, 27),
	})
	return true
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
