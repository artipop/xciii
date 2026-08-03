// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/mattermost/focalboard/server/services/notify"

	"github.com/artipop/trixi/internal/acp"
	"github.com/artipop/trixi/internal/boardadapter"
)

// acpDataDir returns the ACP integration's own state directory
// (~/Library/Application Support/Trixi/acp).
func acpDataDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "Trixi", "acp")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", err
	}
	return dir, nil
}

// ignoreViteDevServer removes the variable `wails3 dev` sets to point the app at
// a Vite dev server. This app never has one: the page is the Focalboard webapp,
// served by the in-process board server behind the front door, in a dev build
// exactly as in a release build. Left set, Wails' own preRun waits ten times for
// a server that will never answer and then kills the app with "unable to connect
// to frontend server", which is a confusing way to say "there isn't one".
func ignoreViteDevServer() {
	_ = os.Unsetenv("FRONTEND_DEVSERVER_URL")
}

func main() {
	// `focalboard mcp dokku` runs this same binary as an MCP server for an agent
	// session; it must come first, before the board server or a window exists.
	maybeRunMCP(os.Args[1:])

	ignoreViteDevServer()

	sessionToken := "su-" + uuid.New().String()

	port, err := getFreePort()
	if err != nil {
		log.Fatalf("failed to find a free port: %v", err)
	}

	// ACP integration: config + board-event backend, wired before the server
	// so the notify backend registers during server construction.
	var (
		acpCfg     acp.Config
		acpEnabled bool
		events     *boardadapter.EventsBackend
		backends   []notify.Backend
	)
	if dir, err := acpDataDir(); err != nil {
		log.Printf("acp: disabled, no data dir: %v", err)
	} else if acpCfg, err = acp.LoadConfig(filepath.Join(dir, "config.json"), dir); err != nil {
		log.Printf("acp: disabled, config error: %v", err)
	} else if acpCfg.Enabled {
		acpEnabled = true
	}

	logger := newServerLogger()
	if acpEnabled {
		events = boardadapter.NewEventsBackend(logger)
		backends = append(backends, events)
	}

	srv, err := runServerWithLogger(logger, port, sessionToken, backends)
	if err != nil {
		log.Fatalf("failed to start the server: %v", err)
	}

	handler, err := newServerProxy(port, sessionToken)
	if err != nil {
		log.Fatalf("failed to create the server proxy: %v", err)
	}

	// The terminal sockets live on the front door beside the board. The routes
	// are created before the manager exists — the manager needs the board
	// server, which needs the port the front door is already listening on — and
	// are given it below.
	terminals := newTerminalRoutes()

	// The front door is the origin the page is served under — a loopback
	// listener of ours in a desktop build, the published address in a server
	// build. Its listener is bound here so the window can be pointed at it.
	front, err := newOrigin(handler, terminals)
	if err != nil {
		log.Fatalf("failed to open the front door: %v", err)
	}

	emitter := newWailsEmitter()
	app := NewApp(emitter)

	// Manager lifecycle: created after the server (needs srv.App()), stopped
	// before it (agents may still post comments during the grace period).
	var mgr *acp.Manager
	if acpEnabled {
		events.SetApp(srv.App())
		dir, _ := acpDataDir()
		store, err := acp.OpenStore(filepath.Join(dir, "acp.db"))
		if err != nil {
			log.Printf("acp: disabled, store error: %v", err)
		} else {
			mgr = acp.NewManager(acpCfg, filepath.Join(dir, "config.json"), store, boardadapter.NewWriter(srv.App()), emitter, nil)
			// Lets the UI open a console on a card without moving it.
			mgr.SetBoardReader(events)
			mgr.SetBoardMeta(events)
			// Lets the UI give agents board accounts, so cards can be
			// assigned to them in a person property.
			mgr.SetBoardUsers(events)
			if err := mgr.Start(context.Background(), events); err != nil {
				log.Printf("acp: disabled, start error: %v", err)
				mgr = nil
			} else {
				app.mgr = mgr
				terminals.SetManager(mgr)
				log.Printf("acp: enabled (trigger %q/%q)", acpCfg.TriggerProperty, acpCfg.TriggerColumn)
			}
		}
	}

	shutdown := func() {
		if mgr != nil {
			mgr.Shutdown(5 * time.Second)
		}
		_ = srv.Shutdown()
	}

	// The bound methods live on App, and the webapp calls them by their fully
	// qualified names (main.App.<Method>) rather than through generated
	// bindings — exactly what the v2 build's -skipbindings meant.
	wapp := application.New(application.Options{
		Name:        "Trixi",
		Description: "Focalboard boards with coding agents",
		Services: []application.Service{
			application.NewService(app),
		},
		Assets: application.AssetOptions{
			Handler: handler,
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		// A desktop build hands Wails the front door as its transport, which is
		// what lets the front door serve the assets. A server build leaves both
		// empty and points Wails' own server at a private loopback port.
		Transport:  front.transport(),
		Server:     front.serverOptions(),
		OnShutdown: shutdown,
	})

	// Both App and the emitter (acp.UIEmitter) reach the runtime through the
	// application instance rather than through a context, so there is no
	// startup hook to wait for before an event can be delivered.
	app.SetApplication(wapp)
	app.SetOrigin(front.url())
	emitter.SetApplication(wapp)

	front.start()
	newMainWindow(wapp, front.url())

	if err := wapp.Run(); err != nil {
		shutdown()
		log.Fatalf("wails run error: %v", err)
	}
}
