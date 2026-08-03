// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"os"
	"testing"
)

// `wails3 dev` points every app it starts at a Vite dev server, whether or not
// the project has one. This one does not — the page comes from the board server
// behind the front door — and Wails' preRun kills the app when the address it
// was given never answers. The variable is therefore dropped before anything
// reads it, which is what makes `make dev-wails3` start at all.
func TestViteDevServerVariableIsIgnored(t *testing.T) {
	t.Setenv("FRONTEND_DEVSERVER_URL", "http://localhost:9245")
	ignoreViteDevServer()
	if got, ok := os.LookupEnv("FRONTEND_DEVSERVER_URL"); ok {
		t.Errorf("FRONTEND_DEVSERVER_URL is still set to %q", got)
	}
}
