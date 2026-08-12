//go:build frontend

// Package main, `frontend` build tag: the webapp `pack` bundle is compiled into
// the binary straight from `webapp/pack`, where `build:frontend` leaves it.
// Release builds pass `-tags frontend`; plain `go build`/tests omit it and fall
// back to the on-disk pack (see frontend_disk.go), so the module still builds
// without a built frontend.
package main

import (
	"embed"
	"io/fs"
)

//go:embed all:webapp/pack
var frontendFS embed.FS

// embeddedFrontend returns the compiled-in webapp pack rooted at its top level.
func embeddedFrontend() (fs.FS, bool) {
	sub, err := fs.Sub(frontendFS, "webapp/pack")
	if err != nil {
		return nil, false
	}
	return sub, true
}
