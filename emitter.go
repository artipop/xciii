// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"log"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// wailsEmitter implements acp.UIEmitter over the Wails event bus. In v3 an
// event is emitted through the application itself rather than through a
// runtime context, so the only window in which events are dropped is between
// application.New and SetApplication.
//
// In a desktop build the event reaches the webview directly; in a server build
// the same call is broadcast over the /wails/events WebSocket to every
// connected browser. Nothing here knows which it is.
type wailsEmitter struct {
	mu  sync.RWMutex
	app *application.App
}

func newWailsEmitter() *wailsEmitter { return &wailsEmitter{} }

// SetApplication is called from main once the application exists.
func (e *wailsEmitter) SetApplication(app *application.App) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.app = app
}

func (e *wailsEmitter) Emit(event string, payload any) {
	e.mu.RLock()
	app := e.app
	e.mu.RUnlock()
	if app == nil {
		log.Printf("acp: dropping UI event %s (application not ready)", event)
		return
	}
	app.Event.Emit(event, payload)
}
