//go:build production

package main

// appDirName is where a real installation keeps everything it owns: the board
// database, the registries, the tailnet node's state — and it is also the name
// of the keychain service the secrets go under.
//
// A development build takes a different one (datadir_dev.go). The two are set
// apart by the `production` tag because that tag already means exactly this and
// nothing else: `wails3 dev` runs `wails3 build DEV=true`, which leaves it off,
// and every packaged build — the .app, the installers, the headless server —
// has it. Nothing new has to be remembered or passed in.
const appDirName = "XCIII"

// appIsDev says this build is the one you get from `wails3 dev`. It is only
// ever used to say so out loud at startup, so that "why is my board empty"
// answers itself.
const appIsDev = false
