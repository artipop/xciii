# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

Lines are wrapped. Keep them wrapped — a paragraph on one line makes every edit a
whole-line diff.

## What this is

**XCIII** is a desktop board that runs coding agents from the board. It is one
Go module built with **Wails v3**, with the board server running **in-process**,
and the same code builds a headless server (`-tags server`) that serves the board to
a browser instead of a webview.

The board server and the webapp are both forks of Mattermost's Focalboard, and
the product no longer carries that name anywhere a person can see it — the only
places it survives are the upstream Go import path and the checkout it is
replaced with.

The frontend is here: `webapp/` is its own npm project built with Vite, copied in
from the `experiments` branch of the server checkout — and since rewritten from
React to **SolidJS**, so upstream and this repository's early history are both
React and neither is a recipe any more. The **server** is still not here —
`go.mod` `replace`s that module to `../focalboard/server`, so a checkout beside
this one is what a build still needs. See `docs/plan.md` for how that should end
up, and `docs/solidjs-migration-plan.md` for what the rewrite promised.

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

`tsnetdoor.go` is that something, and the only supported way off this machine: the
same front door published a second time as a node of the user's own tailnet
(`tailscale.com/tsnet` — userspace, no daemon, no root), with `ListenTLS` so a phone
webview gets a real certificate. A port on an interface would have been reachable by
anything that can route here, and the page hands out the board's session token
(`proxy.go`) to whoever fetches it. A tsnet listener instead knows its caller:
`WhoIs` gives the tailnet login, and the gate allows the user this node was logged in
as (or whatever `allowedLogins` names). Two things follow. The tailnet gets a front
door **built for its own authority** — `sameOrigin` and `hostGuard` are keyed to the
address the page was published under, so the loopback handler would refuse every
request arriving there. And the gate stands in front of *everything*, page included,
because fetching the page is how a caller gets the token. Settings live in
`<dataDir>/tailnet/settings.json` and the feature is off until that file says
otherwise.

### The page talks to Go through a shim, not through generated bindings

v3 injects nothing into the page: it serves `/wails/runtime.js` and the page loads
it. So the bootstrap script in `proxy.go` imports that module and rebuilds the
surface the webapp knows: `window.go.main.App` is a Proxy turning every property
read into `Call.ByName('main.App.<name>', …)` — the fully qualified name of a method
on the bound `App` service — and `window.runtime.EventsOn` wraps `Events.On`,
unwrapping the event object v3 passes. No bindings are generated; adding a method to
`App` is all it takes to make it callable.

**Events do not come back that way, though.** The Wails bus delivers an event by
running JS in the windows the application owns, so a page served through the tailnet
door hears nothing. `eventsws.go` broadcasts the same events over a socket on the
front door instead (`/acp/events/ws`), `emitter.go` sends every event both ways, and
the page listens only on the socket — `components/acp/agentEvents.ts`, one shared
connection for the whole page, with backoff and a "look again" nudge to every
subscriber when it reconnects. A new UI event needs nothing but `Emit`.

**`/m` is the board on a phone**, and deliberately not the board: what is waiting
for a person (answered in place — a question carries its own options) and which
terminals are alive, with a soft key row on the terminal for the keys a phone
keyboard lacks. It is `pages/mobile/`, lazily routed like the terminal page, and it
asks nothing of the board API — everything on it comes from `main.App.*` and the
event socket, both of which the front door serves to a phone exactly as to the
window. `router.test.tsx` guards the one thing that could silently break it: the
board's catch-all route is `/:boardId?/…`, which `/m` fits.

`mobile/` is the phone app itself, and it is **a second Go module on purpose**:
`wails3 ios overlay:gen` compiles `package main` from the module root, and this
root's main is a board server with cgo SQLite, git and a pty. The phone runs
none of that — the app is a window onto `https://<machine>.<tailnet>/m`, which
is what the desktop's own window is too. It keeps the machines in the platform's
secure store, because a person has more than one desktop and each publishes its
own board: the window holds **a tab per machine and a frame behind each tab**,
which is what keeps every board same-origin with its own front door and costs
the desktop side nothing. Two things cross that boundary — a `postMessage` with
the number waiting there, so a tab can carry it, and a `no-cors` probe of the
machine's own page, since a frame's failure is not readable from outside it.
`mobile/README.md` has the build commands; `go test ./...` there covers the
address rules and the machine list.

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

### A session works on its own, and asks when it has to

`internal/acp` is the agent integration, and it is board-agnostic: `internal/
boardadapter` is the only package importing both it and the board server.

A session runs the task a card asked for, comments the result and ends. There is no
console — what a person wants to *say* goes to the terminal instead (below) — but an
agent that needs something from a person gets it through the protocol, which is the
only place it can be asked for without a hack around stdio.

Both of ACP's ways of asking land in `question.go`: a tool outside `autoAllowTools`
comes as `session/request_permission`, and a decision comes as a form elicitation
(the claude CLI's own AskUserQuestion, which stays enabled because
`clientCapabilities` claims form elicitation). Either one **blocks only the request
that asked** — the SDK gives every inbound request its own goroutine, so the agent
keeps streaming and the turn is still open when the answer arrives. The session
reports `waiting_permission` meanwhile, and an unanswered question does not stall
for ever: cancelling the session, or the app closing, is a refusal, and the agent
carries on without what it asked for.

The question shows up as `acp:attention` with reason `question` — the amber dot on
the card's face, and, unless turned off in the settings menu, a notification
carrying the question itself, since the options *are* the answer and there is
nothing to navigate to. It is answered in either place through `AnswerQuestion`, and
the card keeps the exchange in its comments like everything else a session does. The
other reason is `quiet`, from a terminal, below; `components/acp/attention.ts` is
the one subscription behind both.

The automation around sessions is untouched by that: columns say what happens when a
card lands in them, flows join columns into routes, deploys publish a branch to
Dokku through our own MCP server, and the test column drives a browser through an
MCP server the agent carries. `docs/flows.md` is that machinery written for somebody
using the board.

Both halves are edited over **the board's own columns**: `components/acp/
automationEditor.tsx` draws every option of the board's column property as a box,
and a route is that same set of boxes with arrows over it — a stage that is not a
column is a stage no card can stand on, so there is no way to make one. The
editor is source-agnostic and the container decides what it edits: `automation
Dialog.tsx` points it at the registry of a live board (saving through
`SaveBoardColumn`/`AddFlow`/…), `templateEditor.tsx` at a template board's own
properties (`acpColumns`, `acpFlows`, `acpSetup`), which is where a board made
from it will read them. `automation.ts` holds the types and every pure helper,
which is what keeps the two containers from growing their own answers.
`docs/templates.md` is the template half written for somebody using it.

### An agent talks back through MCP, not through its output

Everything above is us talking to an agent. `internal/boardmcp` is the way back:
an MCP server giving an agent the board as tools. It is what planning ends with —
a conversation about what to do leaves the cards on the board itself, where before
a person read the screen and retyped them — and it is what finishing ends with
too, since a card carries what happens to it next in its own column.

The surface is the board in the vocabulary a person uses: read it
(`list_columns`, `list_flows`, `list_cards`, `get_card`), put work on it
(`create_card`, `create_cards`), change it (`update_card`, `comment_card`), and
carry a card on (`move_card`). Everything is **named, never identified** — a
column, a project, a route, an answer a stage waits for — because names are what
a person typed and ids are what the board's own REST API would have made an agent
learn. A **card id** is the one exception, and it has a default: empty means the
card the run stands on (the grant carries it), which is the card an agent working
on one always means.

`move_card` is `update_card` with a column in it, and the split is for the model
rather than for the code: moving is the call whose *consequence* is the point.
Which is why `acp.CardEdit` is the one write in `BoardWriter` that lets the board
notify — the rest are the integration's own bookkeeping and must not re-trigger
the agent that produced them, but a card moved because an agent asked for it has
to set the column's automation off, exactly as a person's drag does. The card's
**description is not editable**: it is a person's content, and what an agent has
to say about a card goes where everything else a session says already goes.

**The app serves it, over HTTP, on the front door** (`/acp/board/mcp`,
`boardapi.go`). The other two MCP servers are subprocesses of the agent because
they do work of their own — dokku talks ssh, webtest drives a browser — but this
one *is* the app: the board lives in this process, and the app is already a
separate process from the agent, already listening on an origin it can reach. A
subprocess in between would have been a proxy of ours to ourselves with the tool
schema written twice. It is not the board's own REST API either, because what it
offers is ours: a column that means something, a project by name.

The server carries **a grant token, not a board id**
(`internal/acp/boardtools.go`): the token names the board, is minted per agent
run and dies with it, so an agent cannot leave cards anywhere else, and one found
later opens nothing — the same bargain the dokku server takes, where the model
picks steps and never targets. The handler is **stateless**, so every request
carries the grant and no session id outlives the check. Now that the tools reach
existing cards, every call that names one is checked against the grant's board
(`grantedCard`): a card id is something an agent can read anywhere, and without
that check one board's grant would edit every other board's cards.

A session declares MCP servers in `session/new`, where ACP has a field for HTTP
ones. A **terminal** has no such field, so it gets a config file its CLI is
pointed at — `cliMCPArgs` in the kind table, beside `cliBin`. A kind that has not
filled that column in simply runs without the tools, which is better than
guessing a flag and failing to open the window.

A session could take the same server through `session/new` and does not yet: a
card's own agent creating cards — or moving its own card into the column that
starts it — is a loop with nothing to stop it, and that wants a decision before
it wants code. A terminal is a person watching, which is what stands in for that
decision today.

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

A window nobody is looking at is also where an agent asks its questions, so
**silence is read as a question**: a CLI that has printed nothing for
`terminalQuietFor` is waiting for a person, and typing ends the wait. That
heuristic holds only because a working agent prints continuously — spinner, tool
output, tokens — and it is used *only here*, where there is no protocol to ask
through (an ACP agent has no TUI, which is the whole reason a terminal is not a
session).

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
