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

	"github.com/artipop/xciii/internal/acp"
	"github.com/artipop/xciii/internal/boardadapter"
	"github.com/artipop/xciii/internal/secrets"
	"github.com/artipop/xciii/internal/sources"
)

// acpDataDir returns the ACP integration's own state directory
// (~/Library/Application Support/XCIII/acp).
func acpDataDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "XCIII", "acp")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", err
	}
	return dir, nil
}

// sourcesDataDir returns where the sources subsystem keeps its registry and
// what it has already seen (~/Library/Application Support/XCIII/sources).
func sourcesDataDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "XCIII", "sources")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", err
	}
	return dir, nil
}

// tailnetDataDir returns where the tailnet door keeps its settings and the
// node's own state (~/Library/Application Support/XCIII/tailnet).
func tailnetDataDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "XCIII", "tailnet")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

// ignoreViteDevServer removes the variable `wails3 dev` sets to point the app at
// a Vite dev server. This app never has one: the page is the board webapp,
// served by the in-process board server behind the front door, in a dev build
// exactly as in a release build. Left set, Wails' own preRun waits ten times for
// a server that will never answer and then kills the app with "unable to connect
// to frontend server", which is a confusing way to say "there isn't one".
func ignoreViteDevServer() {
	_ = os.Unsetenv("FRONTEND_DEVSERVER_URL")
}

func main() {
	// `xciii mcp dokku` runs this same binary as an MCP server for an agent
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

	// The templates this app offers are its own (internal/boardadapter/
	// templates); the server module's are the upstream's examples and carry no
	// automation. Failing to install them costs the selector its contents, not
	// the app, so it is logged rather than fatal.
	if err := boardadapter.ImportTemplates(srv.App(), logger); err != nil {
		log.Printf("templates: %v", err)
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
	// The UI event socket beside them: what the agents are doing, sent to every
	// page rather than only to the windows this application owns.
	uiEvents := newEventRoutes()
	acpSockets := newACPSockets(terminals, uiEvents)
	// The ingest endpoint, on the same terms: it is a route on the front door,
	// and it is handed its manager once the board exists.
	ingest := newSourceRoutes()

	emitter := newWailsEmitter(uiEvents)
	app := NewApp(emitter)

	// The board as the page at /m reads it. Set here rather than beside the
	// sources registry because a phone lists boards and cards whether or not
	// this machine has a source or an agent.
	app.board = boardadapter.NewWriter(srv.App())

	// The tailnet door publishes the same front door to the user's own tailnet,
	// so a phone can reach the board. Off unless its settings file says
	// otherwise; a bad settings file disables it rather than stopping the app,
	// which is the same bargain the ACP config gets.
	var tailnet *tailnetController
	if dir, err := tailnetDataDir(); err != nil {
		log.Printf("tailnet: disabled, no data dir: %v", err)
	} else if tailnet, err = newTailnetController(filepath.Join(dir, "settings.json"), filepath.Join(dir, "state"), app.OpenInBrowser); err != nil {
		log.Printf("tailnet: disabled, settings error: %v", err)
		tailnet = nil
	}
	app.tailnet = tailnet

	// The front door is the origin the page is served under — a loopback
	// listener of ours in a desktop build, the published address in a server
	// build. Its listener is bound here so the window can be pointed at it.
	front, err := newOrigin(handler, acpSockets, ingest, tailnet)
	if err != nil {
		log.Fatalf("failed to open the front door: %v", err)
	}

	// Sources are wired independently of the agent integration, and on purpose:
	// cards from a phone are useful on a board that runs no agents at all.
	// Anything that goes wrong here costs the sources and nothing else.
	var (
		sourceStore *sources.Store
		// The same manager, kept for shutdown: its plugins are processes, and
		// they have to be stopped before the app goes.
		sourcePlugins *sources.Manager
	)
	// Whether this machine has any source at all, for the board setup wizard:
	// its step set is closed and lives in internal/acp, which cannot import
	// this registry, so the answer is handed over as a function below.
	sourcesReady := func() bool { return false }
	if dir, err := sourcesDataDir(); err != nil {
		log.Printf("sources: disabled, no data dir: %v", err)
	} else if cfg, err := sources.LoadConfig(filepath.Join(dir, "sources.json")); err != nil {
		log.Printf("sources: disabled, config error: %v", err)
	} else if sourceStore, err = sources.OpenStore(filepath.Join(dir, "sources.db")); err != nil {
		log.Printf("sources: disabled, store error: %v", err)
		sourceStore = nil
	} else {
		sourceMgr := sources.NewManager(cfg, filepath.Join(dir, "sources.json"),
			sourceStore, boardadapter.NewWriter(srv.App()), nil)
		ingest.SetManager(sourceMgr)
		app.sources = sourceMgr
		sourcesReady = func() bool { return len(sourceMgr.Sources()) > 0 }
		// Manifests are a directory rather than something compiled in: a source
		// is a plugin, and with MCP a manifest is the whole adapter, so adding a
		// service somebody else already wrote a server for is a JSON file. A bad
		// one is reported and skipped — the app has to come up to be able to say
		// what was wrong with it.
		manifests, errs := sources.LoadManifests(filepath.Join(dir, sources.ManifestsDir))
		for _, err := range errs {
			log.Printf("sources: манифест не прочитан: %v", err)
		}
		sourceMgr.SetCatalog(manifests)
		if len(manifests) > 0 {
			log.Printf("sources: %d манифест(ов) из %s", len(manifests), filepath.Join(dir, sources.ManifestsDir))
		}
		// Where a credential the app has to *present* is kept — an MCP server's
		// API token, an OAuth access token. The environment comes first so a
		// token given from outside wins over a stored one without anybody
		// having to delete anything; the file behind it is what the app writes
		// when somebody pastes a token into the source dialog.
		sourceMgr.SetSecrets(secrets.Chain{
			secrets.Env{Prefix: "XCIII_SECRET_"},
			secrets.NewFileStore(filepath.Join(dir, "secrets.json")),
		})
		// Plugins come up here and go down in shutdown below. A source fed over
		// ingest needs none of this; a source with a plugin is a process, and
		// this is where it starts.
		sourceMgr.Start(context.Background())
		sourcePlugins = sourceMgr
		log.Printf("sources: enabled (%d registered)", len(cfg.Sources))
	}

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
			// Lets a board that asks to be asked about sources see the
			// question as already answered when this machine has one.
			mgr.SetRegistryProbe("sources", sourcesReady)
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
		tailnet.close()
		if sourcePlugins != nil {
			sourcePlugins.Stop(5 * time.Second)
		}
		if sourceStore != nil {
			_ = sourceStore.Close()
		}
		_ = srv.Shutdown()
	}

	// The bound methods live on App, and the webapp calls them by their fully
	// qualified names (main.App.<Method>) rather than through generated
	// bindings — exactly what the v2 build's -skipbindings meant.
	wapp := application.New(application.Options{
		Name:        "XCIII",
		Description: "Boards with coding agents",
		Services: []application.Service{
			application.NewService(app),
		},
		Assets: application.AssetOptions{
			Handler: handler,
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		// The share extension shares by launching us with a URL, so a second
		// launch has to reach the instance that already has the board rather
		// than start a second one beside it. Wails catches the URL that
		// launched the second process — macOS delivers it as an Apple Event and
		// not in argv — and passes it here in Args.
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "io.deffun.xciii",
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				if req, ok := shareURLFrom(data.Args); ok {
					app.openShare(req)
				}
			},
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

	// A share that started the app rather than reaching a running one: the URL
	// is on our own command line, and the dialog is the only window that should
	// open — somebody who shared a link did not ask to be shown their board.
	if req, ok := shareURLFrom(os.Args); ok {
		app.openShare(req)
	} else {
		newMainWindow(wapp, front.url())
	}

	if err := wapp.Run(); err != nil {
		shutdown()
		log.Fatalf("wails run error: %v", err)
	}
}
