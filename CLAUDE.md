# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

Lines are wrapped. Keep them wrapped — a paragraph on one line makes every edit a
whole-line diff.

## What this is

**Trixi** is a desktop Focalboard that runs coding agents from the board. It is one
Go module built with **Wails v3**, with the Focalboard server running **in-process**,
and the same code builds a headless server (`-tags server`) that serves the board to
a browser instead of a webview.

The frontend is here: `webapp/` is the Focalboard webapp, its own npm project
built with Vite, copied in from the `experiments` branch of the Focalboard
checkout. The **server** is still not — `go.mod` `replace`s that module to
`../focalboard/server`, so a checkout beside this one is what a build still
needs. See `docs/plan.md` for how that should end up.

What the page needs from the Go side is described in README.md, "What this app
requires of the frontend": the output layout `go:embed` expects, and three
globals the page consumes, each feature-detected because the same bundle also runs
in a browser and as a Mattermost plugin.

## Build & run

- `wails3 dev` — the dev loop: Go edits rebuild and restart, and the webapp watcher
  declared in `build/config.yml` keeps `webapp/pack` current, which a
  dev build (no `frontend` tag) serves off disk. Needs the webapp's dependencies —
  `npm ci` in `webapp/` once.
- `wails3 task build` — the binary for this platform. `wails3 task package` — the
  `.app`/installer. `darwin:package:dmg`, `windows:package`, `linux:package` for the
  rest. `wails3 task build:server` — the headless build.
- Build tags travel as `EXTRA_TAGS`, defaulting to `json1,sqlite3,frontend`
  (cgo SQLite plus the `go:embed` of `webapp/pack`). Linux adds `gtk3`.
- `go test ./...` — the whole suite. `go vet -tags "server json1 sqlite3" .` checks
  the headless build, which has its own files. `./...` also walks
  `webapp/node_modules`, where an npm package happens to ship Go sources; that is
  cosmetic, and a nested `go.mod` would not fix it — `go:embed` cannot cross a
  module boundary, and `webapp/pack` is what it embeds.

Builds are native per platform; cgo SQLite does not cross-compile with the host
toolchain. `wails3 task setup:docker` builds the image that can, for binaries — the
installers are native-tool jobs (AppImage shells out to `ldd`, NSIS is `makensis`).

## Architecture

Four ideas hold this together. Read them before changing anything structural.

### The front door owns the origin

`frontdoor.go` is an HTTP server of ours that everything goes through: `/wails/` to
the Wails runtime, everything else — HTML, `/api`, `/files` and the `/ws` socket —
to the board. A desktop build hands it to Wails as an `AssetServerTransport`
(loopback, random port) and points the window at it rather than at the `wails://`
origin; a server build puts it in front of Wails' own HTTP server, which moves to a
private port.

This exists because **Wails' asset server answers a WebSocket upgrade with 501** and
its response writer cannot be hijacked, so `/ws` can never be served through it. One
origin for the page, the API and the socket is what removes the
`window.webSocketBaseURL` hack the v2 app needed.

Since a loopback port is reachable by anything on the machine, `/wails/` and `/acp/`
refuse a request whose `Origin`/`Sec-Fetch-Site` names another site, and the front
door refuses a `Host` it was not published under. That is the whole of the
protection: **nothing authenticates a user**. Keep the server build on localhost
unless something in front of it does.

### The page talks to Go through a shim, not through generated bindings

v3 injects nothing into the page: it serves `/wails/runtime.js` and the page loads
it. So the bootstrap script in `proxy.go` imports that module and rebuilds the
surface the webapp knows: `window.go.main.App` is a Proxy turning every property
read into `Call.ByName('main.App.<name>', …)` — the fully qualified name of a method
on the bound `App` service — and `window.runtime.EventsOn` wraps `Events.On`,
unwrapping the event object v3 passes. No bindings are generated; adding a method to
`App` is all it takes to make it callable.

### A session is one turn, and nobody watches it

`internal/acp` is the agent integration, and it is board-agnostic: `internal/
boardadapter` is the only package importing both it and the Focalboard server.

A session runs the task a card asked for, comments the result and ends. There is no
console: what a person wants to say goes to the terminal instead (below). Two
consequences to keep in mind when reading the code — a tool outside `autoAllowTools`
is **refused rather than asked about**, and `clientCapabilities` does not claim
elicitation, so the claude adapter passes `--disallowedTools AskUserQuestion` and an
agent that needs a decision states it in its answer.

The automation around sessions is untouched by that: columns say what happens when a
card lands in them, flows join columns into routes, deploys publish a branch to
Dokku through our own MCP server, and the test column drives a browser through an
MCP server the agent carries. `docs/flows.md` is that machinery written for somebody
using the board.

### A terminal is how a person works with an agent

`internal/acp/terminal.go` + `terminalws.go` run the agent's **own CLI** in a pty in
the card's worktree, drawn by xterm.js in a second window of the app, wired over a
WebSocket on the front door (`/acp/terminal/{id}/ws`).

It is deliberately not an ACP session: an ACP agent speaks JSON-RPC on stdio and has
no terminal UI, so one process cannot be both. What the two share is everything
around them — repository, worktree, branch, the agent entry's env and proxy — and
that is what `startTerminal` reuses. Which binary is the interactive half of a kind
is a column in the same table that knows the adapters (`cliBin`: `claude-agent-acp`
→ `claude`); `terminalCommand` on an entry replaces the argv outright.

The card still hears about it: a comment when the terminal opens, and one when the
CLI exits saying what it left on the branch. Terminals outlive their window and
resume — every one is recorded, so the next terminal on that card returns to the
same worktree with `claude --continue`.

## Conventions

- **Comments say why, not what.** The code says what. A comment earns its place by
  recording a decision, a constraint, or a trap somebody already fell into.
- **Tests describe behaviour, not implementation.** The test name is a sentence
  about the product; the comment above it says why that behaviour matters.
- Russian in user-facing strings and product docs, English in code, comments and
  commit messages. `webapp/i18n/ru.json` carries the
  translations; defaults in components stay English.
- Commit messages: a plain subject line saying what changed, and a body saying why —
  the reasoning, the alternative that was rejected, what was verified. No emoji.
- Verify before claiming. A feature is done when it has been run, not when it
  compiles.
