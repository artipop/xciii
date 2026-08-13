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
the product no longer carries that name anywhere — not on screen, and since the
rename, not in an import path either.

Both halves are here. `webapp/` is its own npm project built with Vite, since
rewritten from React to **SolidJS**, so upstream and this repository's early
history are both React and neither is a recipe any more; see
`docs/webapp.md` for what the page is made of now. `server/` is the
board server, and it is **a directory of this module, not a module of its own**:
its packages are `github.com/artipop/xciii/server/…`, there is one `go.mod`, and
there is nothing to `replace`. It was a checkout beside this one until that
turned out to mean the project built on exactly one machine, then a second module
carrying upstream's import path, and now neither. Nothing outside this repository
is required to build it.

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
- **A packaged app is not a child of a shell**, and that is the other difference
  `wails3 dev` hides. launchd hands the `.app` `PATH=/usr/bin:/bin:/usr/sbin:/sbin`
  and nothing else, so npx, node, the agent CLIs and a source plugin are all
  invisible to it while a dev build — started from a terminal — finds every one of
  them. `internal/userpath` asks the login shell for the real PATH at startup,
  because a version manager's node lives under a version number only the user's
  own rc files know. Fixing the *process* PATH rather than our lookups is the
  point: npx is a `#!/usr/bin/env node` script and the codex adapter drives the
  codex CLI, so finding a binary and spawning it with launchd's PATH only moves
  the failure one process along. `TERM` is the same trap with a different
  symptom: launchd sets none, so a CLI in the card's terminal drew itself in
  black and white in the installed app and in colour under `wails3 dev`.
  `terminalEnv` writes `TERM`/`COLORTERM` rather than inheriting them —
  the other end of that pty is xterm.js whatever launched the app, and an
  inherited value describes the wrong terminal even when there is one.
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

Nine ideas hold this together. Read them before changing anything structural.

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

**Anything drawn over the page is placed by `@floating-ui/dom`** — the menus,
the tooltips, the combobox list, the typeahead and both tour tips, always the
same shape: `autoUpdate(anchor, floating, () => computePosition(…))` with
`flip`/`shift`, the result written as a `transform`, and a class the stylesheet
answers with `position: fixed`. Placing one inside the page is the bug this
prevents: `.Kanban` scrolls and `.mainFrame` hides its overflow, so an
absolutely positioned menu on a card was clipped by both and read as sliding
under the sidebar. Hand-rolled geometry for a new popover is a rewrite of a
dependency that is already here.

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

The question shows up as `acp:attention` — the amber terminal button on the
card's corner, and,
unless turned off in the settings menu, a notification carrying the question
itself, since the options *are* the answer and there is nothing to navigate to.
It is answered in either place through `AnswerQuestion`, and leaves no comment
behind: a question is live while it waits and the agent's business once it is
answered. This is the only thing that raises attention: a terminal used to be a
second reason and no longer is (below). `components/acp/attention.ts` is the one
subscription behind it.

**The button is also the way in.** A console-glyph button in the card's bottom
right corner (`KanbanCard__terminal` — it began life as a dot, and the corner
button is what it grew into; it started in the *top* right, where a card's
controls are, and moved because the ⋯ menu is there too and the two spent their
time stepping around each other) opens the card's terminal in a window, and it is
the same control whether it is amber because an agent is asking or the
board's own ink because a terminal is merely running there — one thing on the
card's face, its colour saying what is happening and its click saying where to
go. Reaching the CLI otherwise meant opening the card, finding the toolbar and
opening a panel, which is three steps to a window that was already there. What
the board knows per card comes from `components/acp/liveTerminals.ts`: one
`ListTerminals` for the page indexed by card, because `GetCardAgent` is a call
per card and a board has as many as it likes.

Which is why **the terminal page draws the question too**, above the screen and
in the same amber: the button leads here, and what it leads for was asked over the
protocol rather than in the pty — a CLI draws its own questions inside the
terminal, and this one is not the CLI's. The page finds it by the `cardId` in
`TerminalInfo` and answers through the same `AnswerQuestion` the notification
does. A planning terminal has no card and so never shows one.

**A session writes one comment, and writes it at the end**: what the agent did,
or why it could not. There were a dozen once — started, cancelled, asked,
answered, terminal opened, moved along the route — and a card whose comments are
a log of the machinery is a card nobody reads, with the one thing worth reading
buried in it. Everything that was narrated there is shown instead: the branch and
the worktree on the card's stamp, the position on its route strip (whose reason
is kept in the flow event record rather than on the card), the question on the
card's face. What survives is what the card cannot show for itself — the agent's
own summary of a finished run, a deploy or test report, the terminal report, a
session cut off by a restart — and `comment_card`, which is the agent choosing
to say something.

**"Nothing happened" is state, never a comment.** A stage that would not start,
a card refused because a person holds it, a column with no free place, a route
with no edge for the event that arrived — each is true only until somebody fixes
the registry or moves the card, and a comment outlives it as noise (`«Агент не
запущен: …»` from SINGLE-USER was the reading experience this replaces). One
stall record per card (`card_stall`, `stall.go`) holds the current reason:
written where the comments used to be, replaced by a newer reason, deleted by
any progress, and drawn by the route strip in amber (`CardFlow.stalled`) or, for
a card outside any route, handed to the terminal panel via `GetCardAgent.stall`.
Route dead-ends write *softly* — only when no reason is recorded — so the
consequence («нет перехода по событию «шаг упал»») can never bury the root
cause (why the шаг упал).

The automation around sessions is untouched by that: columns say what happens when a
card lands in them, flows join columns into routes, deploys publish a branch to
Dokku through our own MCP server, and the test column drives a browser through an
MCP server the agent carries. `docs/flows.md` is that machinery written for somebody
using the board.

The model is a graph, and the kanban is one projection of it: **nodes** are
what a card stands on (a column is a node's face on the board), **edges** are
the routes, a node names its worker (crew — the stage's own, falling back to
the column's), and a card carries one conversation per node (the terminal,
above). Everything per-stage hangs off the node id, which is why it is the
board option id and never regenerated.

Both halves are edited over **the board's own columns**: `components/acp/
automationEditor.tsx` draws every option of the board's column property as a box,
and a route is that same set of boxes with arrows over it — a stage that is not a
column is a stage no card can stand on, so there is no way to make one.
`automationDialog.tsx` points it at the registry of a live board (saving through
`SaveBoardColumn`/`AddFlow`/…), and it is the only container: `automation.ts`
holds the types and every pure helper, so nothing else has to grow its own
answers about the same shapes.

**The panel beside the canvas is about whatever the tab is about**, and that is
the whole of how a route says something a column does not. On «Колонки» it edits
the column — its action, its crew, its limit, its target — which holds wherever
a card lands. On a route's tab it edits *the stage*: action, crew, `runIn`,
deploy target, transitions, each falling back to the column's answer and each
**naming that answer in the control** («— как в колонке: агент работает над
карточкой —», «Никто не отмечен — работают агенты колонки: …»), with a link back
to the column's own settings. That is what puts a different agent on each node of
one route — the engine always preferred `FlowNode.Crew`, and the editor could
only say it inside a fold called «Только в этом маршруте…», under a second list
of the same agents. Two crews for one question read as a bug rather than as an
override, and the fold meant the commonest reason to open a route was the one
thing hidden on it. Making a column is one line above the canvas rather than a
column of blocks beside it — click a kind, or drag it if where it stands matters
— because the palette repeated in prose what the panel says anyway and took a
sixth of the screen the picture is for.

A template is **shown and not edited**: `templateEditor.tsx` is a form — name,
icon, what it is for, and the setup questions — with the columns and routes the
template carries listed in words beside them. A template is made by building a
board and saving it («Сохранить как шаблон…», `saveAsTemplate.ts`, which copies
the board under the board's own name and carries its automation across), so what
it carries is what already worked, and the way to change it is to change the
board and save it again. It was the same route canvas inside a scrolling dialog,
which put a graph editor between somebody and the two fields they came to fill
in, and gave one set of routes two places to be edited — the second of them a
copy nobody was looking at. `docs/templates.md` is that half written for
somebody using it.

And a board's automation **lives on the board** — `xciiiColumns`/`xciiiFlows` in the
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
proxies, the tailnet, what a card-less conversation opens saying, whether an
agent waiting may interrupt, and the archive that carries every board in and
out — so they are `settings/appSettingsDialog.tsx`, one dialog of panels
opened from `sidebarSettingsButton.tsx`, reachable with no board open. Deploy
targets are the one registry whose *door* is elsewhere: the list is still the
machine's (`config.json`, shared by every board that deploys), but a Dokku
host only means anything to a board whose automation has a deploy stage, so
the panel is a fold of that board's `automationDialog.tsx` (`usesDeploys`) and
no other surface offers it — a settings section put a Dokku form one click
from a board of shopping lists. **What a person picked for the UI is kept by the install**, not by the
browser: `<dataDir>/ui-settings.json` (`GetUIPreferences`/`SetUIPreference`),
because the desktop window opens on a loopback origin with a random port and
localStorage forgot everything on every launch. `main.tsx` hydrates
localStorage from it before the first render — the theme and the language
have to be right on the first paint — and `UserSettings.set` writes through;
`installKept` in `userSettings.ts` names the keys that travel, and the
session token deliberately is not one of them. In a plain browser or as a
Mattermost plugin there is no Go side, and localStorage stays the whole
memory there. **The theme and the language are settings like the rest of them**,
and are `settings/appPanel.tsx` with the link to the manual: they spent a while
in the corner of the board on the grounds that they are changed while looking at
it, and what that cost was two icon menus and a question mark standing in for
three words, plus a corner that had to be published over the no-board screen to
stay reachable. The way to say something is broken went the same way and for the
same reason — where to say it is looked for once, and it is looked for where the
manual is — so the corner is gone rather than reduced, and `topBar.tsx` with it.
**Neither of those two addresses is the repository.** The panel points at the
guide (`Constants.guideUrl`, the doc site `docs/guide/` publishes) and at an
email address (`Constants.feedbackEmail`), because the repository was standing
in for both while there was no site: somebody who opens «Руководство» wants the
manual and not a source tree, and a bug report should not cost a person an
account on a hosting service. The address is printed on the panel as well as put
in the `mailto:`, since a webview that refuses to open one leaves nothing to
copy. What a board *runs* — its columns, its routes, and what its agents are
told first (`boardPrompts`, keyed by board id) — is `automationDialog.tsx`.

**What a board had to be asked before it can run is not that, and each question
is its own item in the board's ⋯ menu**: «Папки…» (`workdirsDialog.tsx`),
«Куда деплоить…» (`deployTargetsDialog.tsx`), «Пройти настройку заново…» (the
wizard). Which of them a board has is **the board's own setup plan**
(`BoardSetupPlan` → the steps its template declared in `xciiiSetup`), so the
menu differs by template exactly as the questions do: a board made from
«Разработка» offers folders and a deploy host, one made from «Домашние дела»
offers folders alone. They were folds of the automation dialog, and that was
wrong twice over — setting up where an agent works is not a question about
columns and routes, and a fold under a canvas is a place nobody opens, which is
how somebody who had just answered "which folder" in the wizard ended up with a
card that could not name one.

The rest of the ⋯ menu is export and "save as a template" — the archive in the
settings dialog is every board there is, and one board's own is the board's own
business, which is also the whole of why import is not offered per board: what
an archive brings is boards, plural, and Trello/Notion/Todoist are instructions
for making one rather than an importer of ours. Registering an agent needs none
of these screens: `agentQuickAdd.tsx` is the two-field form, used by the card,
the column's crew list and the setup wizard alike.

**The registry is not an answer by itself.** A card names its folder with an
option of the board's own field, so anything that adds a folder mirrors the
registry into it (`workdirSync.ts`), the wizard included — and a folder somebody
has already added is offered rather than refused («использовать здесь»:
`AttachAgentWorkdir` for one no board claimed, `ShareAgentWorkdir` for one
another board owns), because one checkout worked from two boards is an ordinary
arrangement. That the option is the folder's *name* is a compromise with a
deadline on it: `docs/deferred.md` says why an id belongs there instead.

**A card names its agent by whom it is assigned to**, and by nothing else. Each
registered agent has a board account under its own name, so «Кто занимается»
answers the question the whole board already asks with that
field. The machine keeps the field truthful as the card travels: a stage with
its own crew writes the worker it resolved into the assignee
(`assignCardAgent` → `BoardUsers.AssignCardAgent`, the person property found by
its *type*, the write silent and before the launch) — an uncrewed stage writes
nothing, a card already saying so is left alone, and a card assigned to a
person never reaches the write because `humanAssignee` vetoes the session
first. There used to be a second one — an «Agent» select `agentSync.ts` kept in
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

**The account is made when the agent is registered** (`AddAgent` →
`EnsureAgentAccounts`), because that is the moment it becomes a name a card can
be assigned to — and it needs no board: an account is a row in the board
server's own users table, which is what every board reads when it offers people
to assign a card to. There was a sync instead, `syncAgentsToBoard`, run from
wherever a board happened to be open, and it was a sync in search of an event:
register an agent in the settings, never open «Как работает эта доска…», and
the agent had no account anywhere. Running it on every board render was worse —
finding-then-creating is not atomic, so one agent got three accounts. A
registry that predates this is caught up once, at startup (`ensureAgentAccounts`
in `Manager.Start`). `SyncAgentUsers` survives for the board *membership*,
which is the board's own business and decides only whether the agent is listed
under «участники доски» or found by search.

The username is `AgentUsername`, and it keeps letters of **any** script. It
folded to `a-z0-9` once, on a board whose every label is Russian: «клаус» became
the empty string, was skipped by `AgentUsers`, got no account and could never be
put in the one field that says who works a card — and «клаус 2» was provisioned
under the name "2".

Folders belong to **running an agent**, not to having a board: a board with no
`agent`/`test` column is never asked for one, never grows a «Папки» property,
and a folder marked global joins only boards that already have that property.

### A folder hands out a workspace, and the card owns it

`internal/acp/workdirs.go` is the registry — named folders on this machine, one
of which a card names in its «Папки» field. The code calls them working
directories (`WorkdirEntry`), the screen calls them папки, and neither ever
calls them projects again: a folder of household notes is not a project, and
the word made every board of shopping lists look like it was missing one. The
keys in `config.json` (`projects`), on the board (`xciiiProjectProperty`) and on
a card (`project_path`, `repo_path`) keep their old spelling, because they are
other people's stored data.

**A repository is an ordinary folder with a superpower, not a second kind of
thing.** One registry, one adder, one list: in «Обсудить с агентом» and in «В
какой папке будет работать агент?» the repositories stand among the plain
folders, marked and nothing else (`folderChoices.tsx`). What a folder *is* is
asked of git every time it is listed (`WorkdirStatus`), never remembered — `git
init` in a folder added last month makes it a repository and the registry hears
nothing. `Kind` records only a declaration: the setup step of a board that
publishes a branch demands a repository (`SetupRequiresGit`), and answering it
with a folder that has no git is refused where the answer is given.

**A branch appears because somebody took the folder to work on a card, not
because the folder is a repository.** `workspace.go` is the one entry point —
`ClaimWorkspace(WorkSpec)` — and who asks does not change the answer: the
session, the terminal beside it and the next stage of the route all get the same
directory and the same branch, because a workspace belongs to the **owner** (the
card id, or `board:<id>` for a conversation with no card) rather than to the
run. Each run used to make its own, so a card that travelled a three-stage route
left three branches and three checkouts, and the conversation about a card sat
in a copy the agent working on it never saw. A conversation with no card gets
the folder itself and creates nothing.

Two ways to work in a repository, and the answer is the **folder's, on the board
that offers it** (`WorkdirEntry.Modes`, board id → mode): `worktree` — a copy
and a branch per card, several cards of one repository at once; `branch` — a
branch in the folder itself, one card at a time, the person's own checkout
moving with it. There is no third answer, because "work on whatever is checked
out" is what an ordinary folder already does.

Keyed by *both* on purpose. One answer per board is wrong the moment a board has
two repositories; one answer per folder is wrong for a folder marked «на всех
досках», which is one entry seen from several boards — the board where three
people work it may want a copy per card while the board where one person does
does not. A folder belongs to one board anyway, so for almost every entry there
is exactly one answer and the screen reads as "this folder works like this".
`worktreeDir` and `keepFailedWorktrees` stay in `config.json`, being about this
machine's disk, and `worktreeMode` survives as the default for a folder nobody
has been asked about (`always`→worktree, `never`→branch). A board that carries
the earlier board-level key (`xciiiGit`) has its answer moved onto its folders
once, and the key taken off it (`moveGitPolicyToWorkdirs`).

`branch` mode is the one that can refuse: the folder is held by one card
(`workdir_claim`) until its branch is merged, and it will not switch under
somebody's uncommitted work. Both refusals are **state, not failure** —
`errWorkdirBusy`/`errWorkdirDirty` become the card's stall reason and the route
keeps its place, instead of the card being carried off to «Заблокировано» by
something that is not about the work. A merge is what frees the folder
(`ReleaseMergedBranch`, from the VCS watcher); picking the next card up
automatically is deliberately not built (`docs/deferred.md`).

**The branch is the product, the copy is the workshop.** After a stage finishes
the directory is folded away (`FoldWorktree`) and the branch stays; the next
terminal on that card remakes the copy from the branch, which is what makes
folding it safe — and it never touches a copy with uncommitted work in it or one
a CLI is still running in. The branch is also written onto the card, into the
text property the board records as `xciiiBranchProperty`: a machine's database
does not travel, and the card does — to another board (`MoveCardToBoard`) or
another machine. The path is not written, because a path means nothing there.

Where a stage works is the stage's own answer (`FlowNode.RunIn`, `RunsIn`),
defaulting to what that kind of stage has always done: an agent in the card's
workspace, a deploy and a test in the folder itself. That field is the whole of
"QA before the merge" — a test stage told to run in the card's workspace, and an
edge waiting for «ветка влита» after it.

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
column, a folder, a route, an answer a stage waits for — because names are what
a person typed and ids are what the board's own REST API would have made an agent
learn. A **card id** is the one exception, and it has a default: empty means the
card the run stands on (the grant carries it), which is the card an agent working
on one always means.

One tool is not about the board at all: `describe_conversation` is the agent
saying, in one line, what the conversation it is in is doing, and it is there
because **nothing else can know**. A terminal is the vendor CLI in a pty, not an
ACP session, so no protocol carries a title or a recap of one, and the only other
source would be the CLI's own transcript file — its private business, in a
different shape per kind. The agent, on the other hand, is the one having the
conversation, so it is asked. The grant names the terminal
(`BoardGrant.TerminalID`), which is what keeps an agent from describing somebody
else's; the line lands in `TerminalInfo.Summary`, is drawn under the name in
«Открытые терминалы» and on «Терминалы» on a phone, and is kept in the record so
it comes back with the conversation it describes.

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
offers is ours: a column that means something, a folder by name.

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
column of it** (`boardadapter.Writer.EnsureInbox`): a kanban filtered to that
column and grouped by who brought the card — a column per source — called
«Входящие», which the sidebar lists under the board beside its other views. Its
columns are facts about the past rather than places, so a card cannot be dragged
between them (`columnsAreFacts` in `kanban.tsx`). That is where somebody looks for a part of a board, and it keeps
what nobody has read yet out of the middle of the work — which is also why the
column itself is hidden from the kanban (`arrangeKanbans`, and
`hiddenOptionIds` in the templates). The column has to exist, since a card
stands in one and the automation fires on a change of it; it just is not where
anybody reads. A board with no source
gets neither the column nor the view, because nothing arrives on it.

So the inbox is the screen about **where cards come from**, and that is where
the sources are set up: «Источники…» is on that view's ⋯ menu and nowhere else,
and that menu holds nothing besides — exporting or saving as a template are
questions about the board, asked where the board is (`viewHeaderActionsMenu.tsx`,
`isInboxView`). One door stays open on the board itself: a board that has no
«Входящие» yet is offered them there, or the only way to make an inbox would be
a screen that exists once you have one.

A person's own card made on that screen lands in a **second** column,
«Мои задачи» — everything else there arrived, and a task somebody typed is not
something nobody has read. It is a column rather than a group of the view
because what has to be kept apart is what the *automation* sees; the view is
grouped by author, where "made by me" is already its own column — and that
column is headed «Мои задачи» rather than by the viewer's username
(`kanbanColumnHeader.tsx`, on the inbox view only), because what those cards
are says more than who typed them. The mechanism is the view's filter and
nothing else: it admits both columns, «Мои задачи» first, and the first value
of an "includes" clause is what a card made in that view becomes
(`CardFilter.propertyThatMeetsFilterClause`). On the board's own kanban the
column is hidden exactly as «Входящие» is: it stood at the kanban's front for
one template version, and that reading was reverted — a person's unprocessed
tasks are the inbox's business, and the board of work stays as it was. A card
leaves either column through its own dialog, by changing the column property.

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
the card's worktree, drawn by xterm.js and wired over a WebSocket on the front door
(`/acp/terminal/{id}/ws`).

**Where it is drawn is beside the card, not in it**: `pages/…/terminalPage.tsx`
takes its terminal id from the route when it is a window and from a prop when it
is not, and `cardDialog.tsx` gives it a panel of its own next to the card
(`cardTerminal.tsx`, lazily so a card whose panel is never opened does not pay
for the emulator). What opens it is a button in the *dialog's* toolbar, beside
«Attach», because the card's body is what a person wrote and everything of ours
put in there was the machine talking in the middle of it. There was a row in the
card once — the agent's name, the session status, the branch with a deploy
button, a form asking which folder and which agent, and a chevron that expanded
downwards — and the thing a person actually wanted, the terminal, was the part
hardest to find in it. The window survives as the open-in-new button in the
panel's own head — `OpenCardTerminal`'s `window` argument is what asks for one,
the glyph is the compass font's, and it appears only once the terminal runs —
because a screen of its own is the one thing a panel beside a card cannot be. And **no session UI of
ours was built to go beside it**: the terminal *is* what a session looks like,
since the agent's own CLI already draws its work and asks its own questions.

**A terminal is the conversation of the stage the card stands on** — keyed
(card, node), where a node is a stage of the card's route and `""` is the one
conversation of a card outside any route. Everything follows from one rule: the
only conversation that can be opened is the current stage's, and Go offers no
way to ask for another (`StartCardTerminal` reads the node from the card's own
flow state). A passed stage's conversation is closed; the card coming back
makes that stage current and its conversation reopens where it left off. A
still-running CLI on a passed stage stays reachable by id until it exits — a
person's terminal is never killed — it just is not where a new ask lands, which
is why the board's terminal button shows a live terminal via `ShowTerminal(id)` rather than
reopening "the card's terminal" beside it. The node-less conversation is the
resume fallback for a stage with none, so planning done on a card flows into
its first stage. Resume metadata is per stage; the transcript `claude
--continue` picks up is directory-scoped, and the panel lists the card's
conversations as chips (`GetCardAgent.conversations`), current solid, the rest
history. Who a terminal speaks as follows the stage too — its crew, then the
assignee, then the single agent — and a fully busy crew does not block it: the
person opening one is present.

**A folder is optional, an agent is not — and neither is picked silently.** A
card can be talked over — wording, a plan, the brief — before anybody decides
where the work lives, so "the card names no folder" is not a refusal:
`resolveWorkdir`'s two nothing-chosen errors are marked `errNoWorkdir`
(workdirs.go) and `StartCardTerminal` opens the conversation in **«черновики
доски»** — `<dataDir>/boards/<boardID>`, the board's own directory under the
app's data, which is what every UI surface calls it (`TerminalInfo.
BoardFolder` is how a surface knows to; the name is the board id and nothing
else, because a generated name would need remembering somewhere). It was
«папка доски» for a while, and the name said where it is rather than what is
in it — briefs, drafts, notes — which is the half a person needs to decide
whether to answer with it. One folder
per board on purpose: what an agent writes there for one card — a brief, a
draft — is on hand when another card of the same board is talked over; the
price is that the CLI's directory-scoped resume is board-scoped there, the
same trade every non-git folder makes. The *panel* asks before
starting one: `GetCardAgent.folder` (`CardFolder`) says whether the card
resolves a folder, and a card that does not — with no conversation to
reopen — gets the question «В какой папке будет работать агент?», answered by
clicking one of them. Go's own fallback (board folder) stays for the
windowed path, which has no form to ask with. A conversation that already
exists continues with the agent who held it — re-resolving refused every old
conversation the moment a second agent was registered. A folder the card
*does* name but which is broken stays an error: the person meant it. Sessions
are untouched — automation without a folder has nowhere to work, so it stalls
as before.

**The pick is a stepped flow, one question per screen, the answers as
chips** (`cardTerminal.tsx`, mirrored by `planningDialog.tsx`): «Выбор агента»
with the agents as name-chips first — a single registered agent answers it
unasked, quick-add beside the names — then «В какой папке будет работать
агент?», with the chosen name kept above it as the way back. Clicking a name
when the folder is already known is also the start. Two selects asking both
questions at once was the shape this replaced, twice: it read as one question
interrupted by another.

**Both questions are answered the same way, and the folder half is one
component** — `folderChoices.tsx`, used by both panels: the board's folders as
chips, the board's own drafts folder as a chip among them, and «Добавить
папку…» as a quiet link, which is exactly the shape «Добавить агента…» has in
the question before it. What it replaced was a row of folder chips *plus* two
full-width buttons — the drafts folder and the native picker — so the answer a
person mostly wanted was the smallest thing on the screen, and nothing said
which of the three were the same kind of thing. Sharing the component is the
point: the two panels asked one question in two shapes, and that is how they
drift. The choice lives that one conversation and writes
nothing to the card: planning in place, not an assignment. (This deliberately
reversed an earlier decision to point at the settings instead; the form that
once overloaded the card stood on every card always, while this one appears
only when there is something to ask, in the panel the question is about.)

**«Обсудить с агентом» is two sections, and the open conversations are the
first of them** (`planningDialog.tsx`): «Открытые терминалы», then «Новый
разговор». Continuing a conversation is the shorter path, and it used to be the
lower one — a line of buttons under the pick, each labelled «агент · папка», so
two terminals on the same thing was what the dialog led to. A row now carries
what a person needs to pick one: its name, the agent's own recap
(`describe_conversation`), and who is talking where. Everything a row can do is
an icon — open (`ShowTerminal`), rename (`RenameTerminal`), end
(`CloseTerminal`) — and **ending is asked about**, because it stops a CLI
somebody is using and is the only way this list gets shorter: the list *is* the
terminals that are running. The dialog subscribes to `acp:terminal` rather than
reloading on its own, since the recap arrives mid-turn, while it is open.

It is deliberately not an ACP session: an ACP agent speaks JSON-RPC on stdio and has
no terminal UI, so one process cannot be both. What the two share is everything
around them — the card's workspace (its directory and its branch, claimed the
same way a session claims it), the agent entry's env and proxy — and that is
what `startTerminal` reuses. It used to make a copy of its own, which is how a
person ended up talking about a card in a checkout the agent working on it never
saw. Which binary is the interactive half of a kind
is a column in the same table that knows the adapters (`cliBin`: `claude-agent-acp`
→ `claude`); `terminalCommand` on an entry replaces the argv outright.

The card still hears about it, once: a comment when the CLI exits, saying what it
left on the branch. Opening the terminal is not commented — it is on the card, in
front of whoever opened it. Terminals outlive the panel and the window and
resume — every one is recorded, so the next terminal on that card returns to the
card's own workspace with `claude --continue`.

**Our record of a terminal is not the CLI's own history, so a refused resume
opens a new conversation rather than a dead window** (`restartFresh`). A terminal
that was opened and never spoken in leaves a row here and nothing there — which
is what a `wails3 dev` restart makes of every terminal that was open — and
`claude --continue` then prints "No conversation found to continue" and exits 1.
The CLI is started once more without the resume flags, in the same terminal id,
the same directory and a new pty (a pty takes one process), and the window is
told why in its own scrollback; the card is told nothing, because nothing
happened to it. Only for a launch that asked to resume, only for an exit too fast
to have been work, and only once — a kill is this app closing the terminal and
must never come back. Nothing vendor-specific is read to decide it, so the same
fallback covers a pruned transcript and a `codex resume --last` with nothing to
resume. The other half of that bug was the environment: **a terminal drops the
kind's `dropEnv` exactly as a session does**, because `CLAUDE_CODE_CHILD_SESSION`
inherited from a Claude Code session the app was launched from turns the CLI's
transcript saving *off*, and then there is never anything to continue.

A terminal **raises nothing**, and that is a decision. There is no protocol to
ask through in a pty — an agent CLI draws a TUI — so the only signal available
was silence, and silence could not be told from a CLI sitting at its prompt with
nothing asked: opening a terminal and leaving it announced "needs you" five
seconds later, every time, including after the window was closed. A signal that
is wrong more often than right is worse than none, and the window is in front of
whoever opened it. **Only the protocol asks** (`question.go`), which is why
`acp:attention` now has one reason instead of two.

### The app replaces itself, and trusts one key while doing it

`updates.go` is self-updating, and the machinery under it is the framework's:
`app.Updater` is on every Wails v3 application with nothing to register, and it
owns the whole risky part — streaming the artifact, checking it, unpacking it,
and the helper process that waits for us to exit and renames the new bundle into
place. What this repository adds is the three things the framework leaves to the
application.

**Which feed to trust.** The provider is `endpoint`, not `github`. `github`
reads a release's assets and can verify a `SHA256SUMS` sidecar, which catches a
corrupted download and nothing else — the hash and the file come from the same
place — and it ties the app to a public repository for ever, which this one is
not. `endpoint` reads a signed `manifest.json`, and the signature is checked
against `build/updater.key.pub` — `go:embed`ed, so the feed has no say in which
key authenticates it. `wails3 updater manifest` in CI is the whole publishing
side.

**The address is the part that cannot be taken back.** `updateManifestURL` is
`https://updates.deffun.com/stable.json`, a domain of ours rather than a
release page on somebody's platform, because every copy already installed asks
there and nowhere else: where the *files* are kept is a decision that can be
revisited every release, and that one line cannot. So the manifest sits at one
unchanging address and the artifact links inside it are absolute per version
(`…/v1.1.0/…`), which is what lets one never move and the others always. It is
also the only place the release address is written down — the workflow reads
the prefix back out of the constant — so the app and the release cannot come to
disagree about where a release lives.

**What survives a restart.** Nothing, on the framework's side: the download is
a temp directory the helper deletes, and the version a person skipped is a
field of the running `Updater`. So `<dataDir>/updates.json` keeps the switch,
the skipped version and when it last looked — `enabled` a pointer, because a
file written before the field existed must not read as "turned off". The timer
is ours too rather than `Config.CheckInterval`: `Init` may be called once and
`StopPeriodicCheck` cannot be undone, so the framework's timer would make
«проверять автоматически» a switch that takes effect at the next launch. And
the poll only ever *checks* — spending a hundred megabytes of somebody's
connection unasked is not the same act as telling them there is a new version.

**What a person sees.** Not the framework's window, which is good and entirely
hard-coded English. `updater.WindowNone`, Go subscribes to the eleven
`wails:updater:*` events and re-emits **one** — `acp:update`, carrying the whole
state — through `emitter.go`, which is the front door's socket and therefore
the only path that also reaches a page opened on a phone. The status in that
state is read fresh off `Updater.State()` rather than inferred from which event
arrived, because the bus dispatches each event in a goroutine of its own and a
status that went backwards is a progress bar that did. It is drawn by
`settings/updatesPanel.tsx`, and the only thing outside that dialog is a dot on
the sidebar's settings button: an update is not worth a notification.

`updater.HandleHelperMode()` is **the first line of `main()`**, before
`maybeRunMCP`. `application.New` calls it too, but by then this process has
opened SQLite, taken a port, restored a PATH from the login shell and started
plugin processes — all in the one process whose entire job is to wait for the
old one to die.

The version is a constant (`version.go`), not an `-ldflags` injection: every
Taskfile bakes its own `-ldflags="-w -s"` into a template string, and threading
a value through four of them makes the version a property of how the binary was
built, which is exactly what `wails3 dev` then gets wrong. Every other file that
states a version is listed in `internal/buildversion`, `version_test.go` fails
when they disagree, and `wails3 task version:set` writes all of them. Not
`common:update:build-assets`, which regenerates `build/darwin/Info.plist` from
the CLI's template and drops the hand-written `CFBundleURLTypes` block the share
extension is launched through. `docs/release.md` is the release itself;
`.github/workflows/release.yml` is a tag away from it.

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
- **User-facing text is plain documentation.** The register for everything a
  person reads off the product — the webapp's strings (`webapp/i18n/*.json` and
  the English defaults in components), the landing (`site/`) and `docs/guide/` —
  is that of a good manual: name the thing, say what it does, say what to do.
  Not allowed: aphorisms and mirrored halves («Доска уже знает, как устроена
  работа. Чего она не знает — …»), a lesson appended to an instruction, a
  metaphor where a plain verb exists («кормить источник», «архив уносит
  доски»), a heading that makes a statement instead of naming its topic. The
  product's own vocabulary is terminology, not decoration, and stays (маршрут,
  карточка едет, «Входящие»); a hint keeps its "why" when the why changes what
  the reader does.
- **Russian is never a key.** A Russian word may be a label, a message, a
  prompt, or the name a thing is *given* when this app creates it — and nothing
  else. Nothing may find, match or branch on one: the board's column property is
  whatever a view groups by, the author and link properties are found by their
  *type*, the inbox view by what it filters, the folders field by an id the
  board records (`xciiiProjectProperty`). Names that do decide something come from
  the board or the registry — a rule's `Props`, a flow's stages — where a person
  typed them against the board in front of them; they are data, not literals in
  our code. A manifest field is the shape to copy: `key` is the id, `title` is
  the Russian a person reads. The one deliberate exception is
  `NormalizeVerdict`, which meets an agent's free text halfway in both languages
  and maps it onto `pass`/`fail`/`blocked`.
- **A rework is not finished until `docs/` says what is now true.** The rule
  below is about a feature somebody uses; this one is about the shape of the
  code. When something structural moves — a layer replaced, a plan carried out,
  a decision reversed — the document that described the old shape is edited in
  the same change, and a planning document whose work is done is either
  rewritten as description or deleted. A plan that outlives its work is not
  history, it is a wrong answer with a filename: `plan.md` went on saying
  `acpColumns`, went on describing a session console that had been cut, and
  listed Makefile targets this tree has not got. What was thought through and
  deliberately *not* done keeps its reasoning in `docs/deferred.md` — that is
  worth carrying, and it is the half a deletion tends to take with it.
- **A feature a person uses is not finished until `docs/guide/` says how.**
  `docs/` is for whoever works on the code; `docs/guide/` is the other shelf —
  Russian, organised by screen or by task, for the person the thing was built
  for. A new way to do something on the board gets a page or a section there in
  the same change that adds it, and every menu item, button and message the
  guide quotes is checked against `webapp/i18n/ru.json` rather than remembered:
  a guide that misquotes the screen teaches somebody to look for a thing that
  is not there. `webapp/i18n/ru.json` carries the
  translations; defaults in components stay English.
  That shelf is **also a site** — VitePress rooted at `docs/guide/` itself, so
  the markdown stays where this rule points and nothing else under `docs/` can
  be published by accident. A new page goes in one of the sections and gets a
  line in the sidebar in `.vitepress/config.mjs`: a page nothing links to is a
  page that, for a reader, is not there. `docs/guide-site.md` is the how.
  Russian is the original and the root of that site; `docs/guide/en/` is a
  translation kept **page for page**, so the language switcher never lands on a
  page that does not exist. What the English pages quote off the screen comes
  from `webapp/i18n/en.json` — a translated-by-eye button name sends a reader
  looking for something that is not there — and a name the app *gives* (the
  «Входящие» view) is not translated at all, because the English screen shows
  it in Russian too.
- Commit messages: a plain subject line saying what changed, and a body saying why —
  the reasoning, the alternative that was rejected, what was verified. No emoji.
- Verify before claiming. A feature is done when it has been run, not when it
  compiles.
