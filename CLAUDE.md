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
checkout — and since rewritten from React to **SolidJS**, so upstream Focalboard
and this repository's early history are both React and neither is a recipe any
more. The **server** is still not — `go.mod` `replace`s that module to
`../focalboard/server`, so a checkout beside this one is what a build still
needs. See `docs/plan.md` for how that should end up, and
`docs/solidjs-migration-plan.md` for what the rewrite promised.

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
- `npm test` in `webapp/` — the page's suite, **vitest** under jsdom, sharing
  `vite-plugin-solid` with the build through `vitest.config.ts`. Coverage is on by
  default (v8); `--coverage.enabled=false` while iterating, `npm run updatesnapshot`
  to rewrite snapshots.
- `go test ./...` — the whole suite. `go vet -tags "server json1 sqlite3" .` checks
  the headless build, which has its own files. `./...` also walks
  `webapp/node_modules`, where an npm package happens to ship Go sources; that is
  cosmetic, and a nested `go.mod` would not fix it — `go:embed` cannot cross a
  module boundary, and `webapp/pack` is what it embeds.

`webapp/pack` must never stop existing, even for a moment: `go mod tidy` resolves
the `go:embed all:` pattern under every build tag and runs in parallel with the
frontend build, so a committed `.gitkeep` holds the directory open and both the
build task and Vite clear around it rather than removing it.

Builds are native per platform; cgo SQLite does not cross-compile with the host
toolchain. `wails3 task setup:docker` builds the image that can, for binaries — the
installers are native-tool jobs (AppImage shells out to `ldd`, NSIS is `makensis`).

## Architecture

Five ideas hold this together. Read them before changing anything structural.

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

### The page is Solid, and its state is a store rather than Redux

A Solid component is a function that runs once and wires reactive reads, not a
render function that re-runs. The price of that is a bug class the whole page
shares: a value read outside a tracked scope is a value frozen at first run, and
every migration bug found so far has been one — `useAppSelector` returns an
**accessor**, so `foo()` is the value and bare `foo` is a function and therefore
always truthy; props are getters, so destructuring one takes a snapshot.

State lives in `src/store`: `createAppStore(deps, initialState)` builds one
`solid-js/store` tree with per-domain actions, passed down by `AppStoreProvider`
and read with `useAppSelector(selector)`, which memoizes on the fields the
selector touched. There is no dispatch and no thunk — an action is a method that
writes the store, and the client it calls arrives through `deps` rather than a
module import, which is what lets a test hand it a mock.

React-only libraries were replaced rather than wrapped: `@dnd-kit/solid`,
`@dschz/solid-flow` for the workflow canvas, `@solidjs/router`, `@formatjs/intl`
behind our own `src/intl.tsx` (same `IntlShape`, same message ids), and headless
Lexical with a typeahead menu of our own under `markdownEditorInput/plugins/`.

Two rules the drag-and-drop earned the hard way, both silent when broken.
`OptimisticSortingPlugin` is left out of every sortable, because it reorders
nodes the framework owns — and the price is that a sortable's `index` and
`group` no longer move during a drag, so **where a drop landed can only be read
off `event.operation.target`**, never off the source. And **two entities may not
share an id**: dnd-kit's registry is a map keyed by id, so a category that
registered its sortable and its boards drop zone both under the category id had
no drop target of its own. `hooks/sortable.tsx` carries the rest of the
reasoning; `sortableDrag.test.tsx` and `sidebarDrag.test.tsx` drive real drags
in jsdom and are the guards.
Several widgets survived the rewrite untouched because their logic already sat
in a plain module under a thin wrapper — `hotkeys.ts`, `calendar.ts`,
`combobox.ts` beside `widgets/calendar.tsx` and `widgets/combobox.tsx`; keep new
ones that shape. Nothing may import React or Redux again: `no-restricted-imports`
in `eslint.config.mjs` fails the lint, which is cheaper than finding a React
component rendered from Solid at runtime — which is exactly how that guard
earned its place.

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
- **The webapp's testing library is Solid's, and it is not React's.** `render`
  takes a thunk — `render(() => wrapIntl(() => <X/>))` — because JSX built
  outside it is built before the reactive root and its providers exist, and a
  component created there sees neither. There is no `act` (updates are
  synchronous) and no `rerender` (render again, or drive a signal). A store comes
  from `mockAppStore(state)` under `AppStoreProvider` and a router from
  `TestRouter`, both in `testUtils`; `fireEvent.input`, not `change`, is what a
  per-keystroke handler hears.
- **Mocking is vitest's, and it is ESM.** `vi.*` is a global, as `describe` and
  `expect` are. A `vi.mock` factory for a module with a default export has to
  return `{default: …}` — babel's CJS interop used to hand the whole object back
  and no longer does. `vi.resetAllMocks` restores what `vi.spyOn` wrapped rather
  than leaving a no-op behind, so a spy that must not call through says so with
  `mockResolvedValue`, and the hook around it clears rather than resets.
- Russian in user-facing strings and product docs, English in code, comments and
  commit messages. `webapp/i18n/ru.json` carries the
  translations; defaults in components stay English.
- Commit messages: a plain subject line saying what changed, and a body saying why —
  the reasoning, the alternative that was rejected, what was verified. No emoji.
- Verify before claiming. A feature is done when it has been run, not when it
  compiles.
