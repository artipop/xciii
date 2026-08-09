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
place it survives is the upstream Go import path.

Both halves are here. `webapp/` is its own npm project built with Vite, since
rewritten from React to **SolidJS**, so upstream and this repository's early
history are both React and neither is a recipe any more; see
`docs/solidjs-migration-plan.md` for what the rewrite promised. `server/` is the
board server, its own Go module, which `go.mod` `replace`s the upstream path
onto. It was a checkout beside this one until that turned out to mean the
project built on exactly one machine, because the branch it needed had never
been pushed. Nothing outside this repository is required to build it.

`server/` is a fork carried, not a library consumed: patch it here, and keep
patches small enough to explain, because there is nobody upstream to merge them.

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
- **`CGO_ENABLED=0` is a trap on the headless build and only there.** A desktop
  build fails honestly — `wails/v3/pkg/mac` has every file excluded — but the
  server build *compiles clean* and then dies at the first query, because
  `mattn/go-sqlite3` swaps itself for `static_mock.go`, which registers the
  `sqlite3` driver name and answers every `Open` with "Binary was compiled with
  'CGO_ENABLED=0' […] This is a stub". Nothing is wrong with the binary until it
  touches the database. Only two other packages in the tree use cgo at all —
  `prometheus/client_golang` for a Darwin memory collector and
  `tailscale/certstore` — and both fall back to pure Go, so SQLite and Wails are
  the whole of the requirement.
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

Six ideas hold this together. Read them before changing anything structural.

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

**`/m` is the board on a phone**, and deliberately not the board: four screens
and a row of buttons at the bottom, which is where a thumb is. «Входящие» — what
a source left and nobody has looked at, carried onto a board from there;
«Карточки» — one board's cards as a list, to find out where something got to
without walking to the desk; «Ждут» — what is asking for a person, answered in
place, because a question carries its own options; «Терминалы» — which are
alive, with a soft key row on the terminal for the keys a phone keyboard lacks.
«Ждут» is what opens, being the only one of the four that cannot wait; the rest
count themselves on their own button, which is why the page and not the tab
holds those lists — a tab that only counts once you are looking at it counts
nothing.

It is `pages/mobile/`, lazily routed like the terminal page, and it **asks
nothing of the board's own API**: everything on it, the board included, comes
from `main.App.*` and the event socket, both of which the front door serves to a
phone exactly as to the window. That is what `ListBoards`/`ListInbox`/
`ListBoardCards`/`MoveCardToBoard` are for (`pages/mobile/mobileBoards.ts`) —
carrying the store, the board client and the websocket onto a screen that shows
a list and moves one card would be the whole app to do a tenth of it.
`router.test.tsx` guards the one thing that could silently break the page: the
board's catch-all route is `/:boardId?/…`, which `/m` fits.

`mobile/` is the phone app itself, and it is **a second Go module on purpose**:
`wails3 ios overlay:gen` compiles `package main` from the module root, and this
root's main is a board server with cgo SQLite, git and a pty. The phone runs
none of that — the app is a window pointed at `https://<machine>.<tailnet>/m`,
which is what the desktop's own window is too. It keeps the address in the
platform's secure store, and a failed navigation returns to its setup page,
because once the window is on the board there is no address bar to type in.
`mobile/README.md` has the build commands; `go test ./...` there covers the
address rules.

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

### A source brings cards in, and the app decides what they become

`internal/sources` turns outside events into cards: mail, an issue, a
notification from a phone. It is board-agnostic the way `internal/acp` is, and
deliberately **not part of it** — cards from a phone on a board of household
chores are useful to somebody who has no agent and never will, so a source has
to work with the agent integration switched off.

A source is a **plugin**, not a branch in our code: a separate process speaking
JSON-RPC over stdio (`sources/protocol`, `internal/sources/plugin`), which is
what lets one be written in TypeScript and by somebody else. The plugin does one
thing — hands over items. It never sees the board: rules, columns and cards are
this side's, because a plugin author must not be trusted with the board and
because otherwise every plugin would invent its own filter syntax.
`ingest.go` is the way in for everything that has no plugin — a script, a phone,
a webhook — a route on the front door guarded by a per-source token.
`docs/sources.md` is the whole design.

**Everything a source brings lands in «Входящие» unless a rule says otherwise**,
and that is the one column the app will put on a board itself
(`boardadapter.Writer.EnsureColumn`, add-only). The templates carry it, but a
template only ever reaches a board that does not exist yet — `importTemplates`
replaces the *template* board and never one made from it — so a column that
shipped only in a template would exist for every board except the ones people
already have. For the same reason nothing here assumes what the column property
is called: `ColumnProperty` asks the board, because "Status" and «Статус» are
each right for exactly half the boards there are.

Where a person meets the inbox, though, is **a view of the board and not a
column of it** (`boardadapter.Writer.EnsureInbox`): a table filtered to that
column, called «Входящие», which the sidebar lists under the board beside its
other views. That is where somebody looks for a part of a board, and it keeps
what nobody has read yet out of the middle of the work. A board with no source
gets neither the column nor the view, because nothing arrives on it.

The inbox is **grouped by what brought the card**, and that needs no property of
ours: a source has a board account, exactly as an agent does and for the same
reason (`EnsureSourceUser` beside `EnsureAgentUsers`), so the card is *authored*
by its source and the board groups by "created by" out of the box. What a person
typed stays theirs. The account is named after the source rather than prefixed,
because the board shows the username wherever it names an author.

A card can then be carried onto another board — from the card's own menu, or
from «Входящие» on a phone — and that is a **real move** — same card id, so comments come with it and everything outside
the board that remembers the card by id still finds it. It lives in the server
module (`app.MoveCardToBoard`, `POST /cards/{cardID}/move`) because moving a
card is the board's own operation, not ours, and because it cannot be built out
of what was there: `insertBlock` keys its update on `id AND board_id`, so
re-inserting a block under a new board updates nothing and says it worked.
Properties travel by **name**, since the two boards share nothing else.

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
