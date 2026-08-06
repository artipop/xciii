// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"log"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// wailsEmitter implements acp.UIEmitter. In v3 an event is emitted through the
// application itself rather than through a runtime context, so the only window
// in which events are dropped is between application.New and SetApplication.
//
// Every event goes out twice: over the Wails bus, which reaches the windows
// this application owns, and over the front door's own socket (eventsws.go),
// which reaches every page — including one opened on a phone through the
// tailnet door, where the bus does not reach. The page listens on the socket;
// the bus is kept because it costs a line and it is what a window would use if
// the socket were ever unavailable.
type wailsEmitter struct {
	mu     sync.RWMutex
	app    *application.App
	fanout *eventRoutes
}

func newWailsEmitter(fanout *eventRoutes) *wailsEmitter { return &wailsEmitter{fanout: fanout} }

// SetApplication is called from main once the application exists.
func (e *wailsEmitter) SetApplication(app *application.App) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.app = app
}

func (e *wailsEmitter) Emit(event string, payload any) {
	if e.fanout != nil {
		e.fanout.Emit(event, payload)
	}
	e.mu.RLock()
	app := e.app
	e.mu.RUnlock()
	if app == nil {
		log.Printf("acp: dropping UI event %s (application not ready)", event)
		return
	}
	app.Event.Emit(event, payload)
}
