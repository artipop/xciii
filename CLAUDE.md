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

Seven ideas hold this together. Read them before changing anything structural.

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

The question shows up as `acp:attention` — the amber dot on the card's face, and,
unless turned off in the settings menu, a notification carrying the question
itself, since the options *are* the answer and there is nothing to navigate to.
It is answered in either place through `AnswerQuestion`, and the card keeps the
exchange in its comments like everything else a session does. This is the only
thing that raises attention: a terminal used to be a second reason and no longer
is (below). `components/acp/attention.ts` is the one subscription behind it.

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

And a board's automation **lives on the board** — `acpColumns`/`acpFlows` in the
board's own properties, in the board database, which is why a live board and a
template are the same two keys and why a template can carry automation at all.
`internal/acp` keeps the registry in memory because the engine reads it on every
card move, but every edit is written through to the board it belongs to
(`persistBoardLocked` in `boardseed.go`), and `config.json` keeps only what the
machine owns. An install that predates this moves over once, at startup
(`moveAutomationToBoards`); a board that refuses the write keeps its entries in
the file until one gets through, which is what makes the move safe to retry.

**A setting lives where its owner does**, and that is the rule the whole
settings surface is sorted by. The registries are the machine's — agents,
deploy targets, proxies, the tailnet, what a card-less conversation opens
saying — so they are `machineSettingsDialog.tsx`, one dialog of panels opened
from `sidebarSettingsMenu.tsx`, reachable with no board open. What a board runs
— columns, routes, its folders, and what its agents are told first
(`boardPrompts`, keyed by board id) — is `automationDialog.tsx`. The board's ⋯
menu keeps only export and "save as a template". Registering an agent needs
neither: `agentQuickAdd.tsx` is the two-field form, used by the card, the
column's crew list and the setup wizard alike, and `agentSync.ts` is what makes
a registered agent nameable on a board — called where a board exists, since the
machine's own settings have none.

**A card names its agent by whom it is assigned to**, and by nothing else. Each
registered agent is a member of the board under its own name (`SyncAgentUsers`),
so «Кто занимается» answers the question the whole board already asks with that
field. There used to be a second one — an «Agent» select `agentSync.ts` kept in
step with the registry — and two fields for one question meant a rule about
which of them wins and a field that said nothing on a board where nobody had
registered an agent. `retireAgentProperty` takes it off a board the first time
one is opened, and `resolveSessionAgent` no longer reads select options at all —
that match outlived the field as a rule with nothing behind it, where any option
anywhere on the board spelled like an agent quietly decided who worked the card.
`humanAssignee` is what keeps "assigned to a person" and "assigned to an agent"
opposite answers rather than the same one. A card property named `agent` went
with them, and for the same reason: nothing in this app creates one, so it was a
third answer only a hand-built board could give.

Folders belong to **running an agent**, not to having a board: a board with no
`agent`/`test` column is never asked for one, never grows a «Проекты» property,
and a project marked global joins only boards that already have that property.

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

**An MCP server is the second kind of plugin, and it needs no code at all.**
What MCP has no word for is "the feed" — its tools are described for a model —
so a manifest says which tool to call, with what arguments, and how to read one
row of the answer as an item (`internal/sources/mcpsource.go`, mapped with the
same `text/template` a rule's properties use). Past `dialPlugin` nothing knows
which protocol the process speaks. Manifests come from two places: the ones
this app ships (`internal/sources/manifests`, embedded — Kaiten is one, and its
server is this binary re-invoked, `internal/sources/kaiten`), and the ones
somebody drops in `<dataDir>/sources/manifests/*.json`, which win by name. A
service with a server of its own is the second kind, since a manifest then
names a path on that machine.

The system's «Поделиться» is a source too (`internal/sources/share.go`,
`share.go`, `pages/share/`): the share extension in the .app opens
`xciii://share?url=…`, a small window asks which board, and the link goes down
the same pipeline. It is the one entry allowed to name its own board
(`PickBoard`), because a person is looking at the dialog when it happens.

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
what nobody has read yet out of the middle of the work — which is also why the
column itself is hidden from the kanban (`hideFromKanban`, and
`hiddenOptionIds` in the templates). The column has to exist, since a card
stands in one and the automation fires on a change of it; it just is not where
anybody reads. A board with no source
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

A terminal **raises nothing**, and that is a decision. There is no protocol to
ask through in a pty — an agent CLI draws a TUI — so the only signal available
was silence, and silence could not be told from a CLI sitting at its prompt with
nothing asked: opening a terminal and leaving it announced "needs you" five
seconds later, every time, including after the window was closed. A signal that
is wrong more often than right is worse than none, and the window is in front of
whoever opened it. **Only the protocol asks** (`question.go`), which is why
`acp:attention` now has one reason instead of two.

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
  commit messages.
- **A feature a person uses is not finished until `docs/guide/` says how.**
  `docs/` is for whoever works on the code; `docs/guide/` is the other shelf —
  Russian, organised by screen or by task, for the person the thing was built
  for. A new way to do something on the board gets a page or a section there in
  the same change that adds it, and every menu item, button and message the
  guide quotes is checked against `webapp/i18n/ru.json` rather than remembered:
  a guide that misquotes the screen teaches somebody to look for a thing that
  is not there. `webapp/i18n/ru.json` carries the
  translations; defaults in components stay English.
- Commit messages: a plain subject line saying what changed, and a body saying why —
  the reasoning, the alternative that was rejected, what was verified. No emoji.
- Verify before claiming. A feature is done when it has been run, not when it
  compiles.
