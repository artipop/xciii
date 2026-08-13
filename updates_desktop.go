//go:build !server

package main

import "github.com/wailsapp/wails/v3/pkg/application"

// initUpdater wires self-updating into a desktop build. The controller is kept
// on App because App is what the page calls.
func initUpdater(wapp *application.App, app *App, emitter *wailsEmitter) {
	app.updates = newUpdateController(wapp, emitter)
}
