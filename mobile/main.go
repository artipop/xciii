package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// XCIII on a phone: one window, pointed at the board.
//
// It is a module of its own rather than a build tag over the desktop app, and
// that is not tidiness. The mobile build compiles package main from the module
// root (`wails3 ios overlay:gen` injects a main_ios.gen.go beside it), and the
// desktop main is the board server, cgo SQLite, git and a pty — none of which
// builds for iOS and none of which belongs on a phone anyway.
//
// What the phone runs is nothing. The board, its API, its sockets and the agent
// bindings are all served by the front door on the desktop, and this app is a
// window onto it — exactly what the desktop app's own window is
// (mode_desktop.go points it at http://127.0.0.1:port). The page each machine
// shows is /m, the board's phone view.
//
// A person has more than one desktop, so the window holds a tab per machine and
// a frame behind each tab. A frame keeps every machine on its own origin, which
// is what makes this cost nothing on the desktop side: inside it, the board's
// page is same-origin with its own front door, and the bindings, the event
// socket and the terminal socket work exactly as they do in a browser. What the
// frames report to the tabs is one number each — how many things are waiting
// there — so which desktop needs a person is visible without opening its tab.
//
// Getting there is Tailscale's job: the desktop publishes the front door on the
// tailnet (tsnetdoor.go), the phone has the Tailscale app, and the address is a
// tailnet name. Nothing of ours is on the public internet, and nothing of ours
// authenticates — the front door checks the caller's tailnet identity instead.

//go:embed all:frontend
var assets embed.FS

func main() {
	settings := newSettings()

	// The setup page is the only asset this app has, so serving it is a file
	// server over the embedded directory — v3's asset options take a handler
	// and nothing else.
	pages, err := fs.Sub(assets, "frontend")
	if err != nil {
		log.Fatal(err)
	}

	app := application.New(application.Options{
		Name:        "XCIII",
		Description: "Boards with coding agents",
		Assets: application.AssetOptions{
			Handler: http.FileServerFS(pages),
		},
		Services: []application.Service{
			application.NewService(settings),
		},
	})

	// One window, and it stays on the app's own page: the boards are frames
	// inside it, one per machine, so switching between two desktops is a tab
	// rather than a navigation. On mobile only the first window is shown
	// anyway, and a second one is not what a phone means by "the other board".
	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "XCIII",

		// The same black the page paints, so there is no white flash between
		// the app opening and the board arriving over a phone network.
		BackgroundColour: application.NewRGB(12, 12, 14),
	})
	settings.attach(window)

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
