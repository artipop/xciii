//go:build server

package main

import "github.com/wailsapp/wails/v3/pkg/application"

// A headless build does not update itself. Two reasons, and either would do:
// no release publishes `XCIII-server`, so there is no artifact for the feed to
// point at; and swapping the binary of a service somebody else started, on a
// machine nobody is sitting at, is that machine's package manager's business
// and not ours.
//
// The settings panel asks GetUpdateState first and hides itself when the
// answer says unsupported, so nothing has to know about this file.
func initUpdater(*application.App, *App, *wailsEmitter) {}
