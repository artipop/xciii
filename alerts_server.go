//go:build server

package main

import (
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/artipop/xciii/internal/acp"
)

// A headless build has neither of the two surfaces this is about: there is no
// menu bar on the machine it runs on, and an OS notification would be posted to
// whoever happens to be logged into the server rather than to the person
// looking at the board through a browser. The page's own notification is what
// reaches them, and it needs nothing from here.
func initAlerts(*application.App, *App, *acp.Manager) func() { return func() {} }
