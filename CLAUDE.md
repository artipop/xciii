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
the product no longer carries that name anywhere — not on screen, not in an
import path, and since the store work, not in a dependency either: nothing here
imports `mattermost/mattermost/server/public`. What that module was still
supplying was a handful of types (`FileInfo`, `Preference`, `License`,
`Channel`, `AppError`), three time helpers, and `ServicesAPI` — the plugin
surface a Focalboard hosted inside Mattermost talked to its host through, an
interface of fifty methods that nothing in this tree ever implemented or set.
The types that survive are ours and hold the columns the tables actually have;
the rest went with the interface. It cost 273 lines of `go.mod`/`go.sum`.

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
  touches the database. One other package in the tree uses cgo at all —
  `tailscale/certstore` — and it falls back to pure Go, so SQLite and Wails are
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
  module boundary, and `webapp/pack` is what it embeds. The suite is green. It
  was not for a long time — `TestPermissionsGetTeamTemplates` failed on every
  run against a hard-coded count of the shipped templates that the archive had
  outgrown — on all three vendors alike — and it now asks the store instead.
  Two suites used to be *flaky* on
  top of that — `server/integrationtests`, where which permission tests failed
  changed between runs, and `internal/boardadapter` about one run in four — and
  they are not any more: the cause was composite writes going through without a
  transaction on SQLite, which is fixed (below). What is left is rarer and not
  understood: `TestPatchBoard` in `server/app` failed twice in a day of
  full-tree runs and passes on its own every time, and
  `TestASessionAsksTheCardForAToolOutsideThePolicy` failed once the same way.
  Blame a change only after re-running the package alone.
- **`wails3 task test:db DB=postgres`** (or `mysql`, `sqlite3`; `test:db:all`
  for all three) — the store and API suites against one vendor. The container is
  started by the tests themselves (`internal/dbtest`, testcontainers-go), so
  this is one environment variable and a Docker daemon: there is no compose file
  to keep in step and nothing to stop afterwards. `FOCALBOARD_STORE_TEST_DB_TYPE`
  is the whole contract, and setting `FOCALBOARD_STORE_TEST_DOCKER_PORT` still
  points the tests at a database of your own instead.
- `go generate ./tools/schemagen` — after any change to the application's own
  tables. It rewrites the migration for all three dialects; `go test
  ./tools/schemagen` is what fails when somebody forgets.

`webapp/pack` must never stop existing, even for a moment: `go mod tidy` resolves
the `go:embed all:` pattern under every build tag and runs in parallel with the
frontend build, so a committed `.gitkeep` holds the directory open and both the
build task and Vite clear around it rather than removing it.

Builds are native per platform; cgo SQLite does not cross-compile with the host
toolchain. `wails3 task setup:docker` builds the image that can, for binaries — the
installers are native-tool jobs (AppImage shells out to `ldd`, NSIS is `makensis`).

## Architecture

Eleven ideas hold this together. Read them before changing anything structural.

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

The other half of that move is a rule about the stylesheets left behind it: a
placed element is `position: fixed` with its corner at the top left of the
screen, so **`left`, `right` and a percentage width in a call site's CSS now
mean the viewport**. `.Select .Menu` still carried `right: 0; min-width: 100%`
from when a menu was an absolutely positioned child of its wrapper, which under
the fixed strategy reads as "start at the left edge of the screen, end at the
right" — every dropdown in the app opened the full width of the window, and it
had been that way since the move. A field's list is as wide as its field
because it *asks* to be: `matchAnchorWidth` on `Menu`, floating-ui's `size`
middleware, in the one place that already knows the anchor's box.

**A dialog is not above the sidebar the way it looks.** `.mainFrame` carries a
z-index, so it is a stacking context, and everything a dialog inside it says
about its own z-index is said *within* the frame — while the collapsed
sidebar's ☰ is positioned over the frame on purpose, and therefore over the
dialog too. Raising the frame is not the fix, since the sidebar's own menus have
to stay above the board. So the screen that needs the whole window takes it:
`components/wholeScreen.ts` is a counter, `useWholeScreen()` holds it for as
long as the component lives, and the sidebar draws itself `offscreen` while
anything does. One caller — `automationDialog.tsx`, whose canvas is the width of
the board.

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

### A stage is the agent's own CLI, and it asks in its own words

`internal/acp` is the agent integration, and it is board-agnostic: `internal/
boardadapter` is the only package importing both it and the board server.

**An agent stage of a route is a terminal, not a session** (`stageterminal.go`).
The card's task goes to the vendor CLI on its command line — `claude "…"`, the
kind's `cliPromptArgs` — and everything the agent does from there is drawn by the
CLI in its own screen: its plan, its questions, its permission prompts. Nothing
of ours is drawn over that, which is the whole point. It was an ACP session
before: an adapter on stdio, its questions lifted out of the protocol into a box
of our own — and that box was drawn *over the card's terminal*, in which a second
CLI was sitting in the same worktree knowing nothing about the first. Two agents
in one copy of the code, and a question about the card hiding the window it was
asked from.

Three things follow, and each had to be answered before the swap was possible.

**How the route learns the stage is over**: the agent says so, through the board
tools — `finish_work` (below), which reports done-or-not and one line about what
it did. Nothing else can: an interactive CLI does not exit when a turn ends, and
a person typing in that terminal afterwards is the ordinary case rather than a
signal. A CLI that exits without having said it is *not* a failed stage — the
card keeps its place and stalls with a reason, since a window somebody closed is
not a verdict.

**How a stuck card is noticed**: `AttentionTerminal`, raised while the stage's
CLI draws nothing (`terminalQuietFor`). This is silence standing in for a
question, which is exactly what was thrown out once — and it is back because
what it measures has changed. It used to be measured on a terminal somebody had
opened and left, where nothing happening is the ordinary state, and it announced
"needs you" five seconds later every time. Here the agent was handed a task and
has not said it is finished, so a still frame means it is waiting on somebody: a
model mid-turn redraws its own spinner, and a permission box does not.

**Silence is the floor, not the only signal** (`internal/acp/toolhook.go`,
`docs/attention-hooks.md`). A CLI with a permission hook says so precisely: the
hook is a command it runs when it needs a person, the command is this binary
re-invoked (`hook.go`), and it posts the tool call to the front door on the
run's own grant, holds while a person answers, and hands the decision back.
Registered by `cliHookArgs` — another column of the adapter table, filled for
claude and empty for everyone else, who keep the timer exactly as it was. Two
things make it safe. It **does not take the question away from the terminal**:
measured, the CLI draws its own box at the same moment it asks, so the card is a
second *place* to answer rather than a second interface over the agent's screen
— which is what makes `attentionAnswers.tsx` legitimate after the answer surface
was deliberately deleted (`docs/deferred.md`). And **every failure is silence**:
no app, no grant, nobody looking — the hook prints nothing and exits 0, leaving
the CLI's own prompt standing. What a hook cannot see is anything outside the
agent loop — the folder-trust question, a login, a refused resume — which is why
the timer stays.

**Which agents can do this at all**: `stageRunsInTerminal`. Three requirements,
and an agent missing any of them keeps the old arrangement, an ACP session — a
way to be handed the board tools (without them the stage could never end), an
interactive CLI at all (the generic `acp` kind is an adapter and nothing else),
and that CLI actually installed here (the claude adapter embeds the CLI it
drives, so a machine can run sessions of that kind with no `claude` on it).

**A deploy and a test are still sessions**, and so is anything the rule above
excludes. Nobody watches them, the machine reads their verdict rather than a
person, and there is no terminal for anybody to answer in. So `question.go`
stays: a tool outside `autoAllowTools` comes as `session/request_permission`, a
decision as a form elicitation, either one **blocks only the request that asked**
— the SDK gives every inbound request its own goroutine — and an unanswered one
refuses on cancellation or shutdown rather than stalling for ever. What is gone
is the surface that answered it; `docs/deferred.md` records why that is
acceptable and what it costs.

Both reasons show up as `acp:attention` — the amber terminal button on the card's
corner, and, unless turned off in the settings menu, a notification. **Neither is
answered there any more.** The notification carries what is being asked and one
thing to do about it, «Открыть терминал», because the answer belongs to the
interface the agent drew it in. `components/acp/attention.ts` is the one
subscription behind all of it.

**Being told is a thing that happens once** (`internal/acp/attentionack.go`).
The ✕ and «Открыть терминал» are the same answer to the same question — whether
anybody still needs telling — and both call `AckAttention(key)`. The ack is
kept by the Go side, not by the page, so one click takes the notification off
every window and off the phone and a reload does not bring it back; the card's
amber button is untouched, being part of the card. It was a list in the page
keyed by the wait *and when it was raised*, and that made a loop: a stage's
wait is silence, opening the terminal to look at it resizes the CLI, a TUI
repaints when it is resized — so the wait ended and went up again forty-five
seconds later under a timestamp nobody had dismissed. Going to look at an agent
guaranteed a fresh notification about it a minute afterwards, for ever. What
drops the ack is the CLI drawing something that is **not** the repaint our own
looking provoked (`TerminalSession.workAt`, `resizeEcho`), because an agent
that revives, does a turn and stops again is asking something new. A wait that
ends takes its ack with it.

**The stack belongs to the window with the board in it.** It is mounted outside
the router (`app.tsx`), which is what puts it wherever in the app a person is —
and a terminal window is the app too, so every one of them drew the whole stack
as well: two conversations waiting read as the first one being announced twice.
One of those copies was worse than a repeat, since a box saying «агент ждёт»
over the terminal it is *about* covers the question it is announcing — the same
reason nothing of ours is drawn on that screen. So `attentionNotifications.tsx`
draws nothing on a `/acp/terminal/` or `/m/terminal/` page, and the list it does
draw is deduped by the wait's own key.

**Every one of those surfaces needs somebody to be looking at a window**, and
the case a stage's wait is raised in is usually the opposite one: the app is
minimised, or behind an editor, or on another space. So the same wait goes out
through the two surfaces a desktop keeps for exactly that — the OS notification
centre and the menu bar (`alerts.go`, `alerts_desktop.go`, desktop build only:
a headless install has no menu bar and would post to whoever is logged into the
server). Both are driven by re-reading `Manager.Attention()` on `acp:attention`
rather than by the payload, since a wait ending and a wait being acknowledged
arrive as the same event and what both surfaces need is the picture afterwards.

The line between them is the setting. **The dot on the tray icon is an
indicator**, like the card's amber button: it interrupts nobody, it is drawn
while anything is waiting whether or not it has been acknowledged, and it is
therefore not a setting. **A notification interrupts**, so it is the switch —
and it is *the switch that already existed*, `agentNotifications`, read out of
`ui-settings.json` by the Go side (`agentNotificationsEnabled`) rather than
duplicated, because "tell me when an agent is waiting" is one question and two
of them would need a rule about which wins. It is also suppressed while any
window of this app has focus, terminal windows included: announcing a wait to
somebody sitting in front of the agent's own screen is the noise this is meant
to be the opposite of. Clicking it opens the terminal and acks the wait —
`openWait`/`AckAttention`, the same pair `attention.ts` performs, so going to
look takes the notification off every window and off the phone. **Both buttons
open the menu** and the way in is «Открыть» inside it, because opening the app
straight off a left click is not reachable on this Wails — see
`docs/deferred.md`.

**Taking a notification down is not `RemoveNotification`**, which is the call
that reads like it and is a stub returning nil on macOS and on Windows.
`RemoveDeliveredNotification` is the one, delivered being what ours are —
nothing here schedules — and on Linux the two are the same method.

**Answering in the terminal is now seen** (`withdrawWhenAnsweredOnScreen`). "The
CLI's box and the card are two places to answer, whoever is first wins" was true
of the *agent* and false of everything a person looks at: somebody answering on
screen told this side nothing, so the hook went on holding and the card, both
notifications and the menu bar icon went on saying an agent waited for a
decision it already had — for the rest of `hookHold`. What the terminal does say
is that it started drawing again, and a permission box is a still frame (the
premise `AttentionTerminal` already rests on), so output after the box has
settled is the person. `workedAt` rather than `lastOutput`, because opening the
window to read the question resizes the CLI and a TUI repaints when resized:
being looked at must not read as being answered — the same trap the ack fell
into. Wrong in the safe direction, since withdrawing leaves the CLI's own box
standing, which is where the question was.

**The app outlives its windows**, which is what makes the icon worth having:
one that dies with the last window is a decoration on a window, and every agent
conversation used to die with it. Closing the board *hides* it — a
`WindowClosing` hook that cancels, so the framework's own destroy listener never
runs and coming back is the same window with the same board rather than a page
loading from scratch. The Dock icon leads back too
(`ApplicationShouldHandleReopen`), and the menu's «Выход» is the way out.

**Which lever stops the app quitting is per-platform, and using one lever costs
⌘Q.** Windows and Linux call `Options.ShouldQuit` from a teardown that *both*
the last window closing and `App.Quit()` go through, so there it has to be a
flag `requestQuit` sets. macOS asks the same hook from
`applicationShouldTerminate` and from nowhere else — the last window closing is
settled separately, by `ApplicationShouldTerminateAfterLastWindowClosed` — so
answering with the flag there refuses ⌘Q, the Dock's Quit and everything else a
person reaches for. `appShouldQuit` says yes on darwin for exactly that reason;
it was measured, not reasoned — the runtime's own Quit answered 200 and the
process stayed up.

Three things about the notifications are traps already fallen into. The notification service is
started **by hand** (`ns.ServiceStartup`) and never registered in
`application.Options.Services`: a service whose startup errors takes the whole
application down, and on macOS this one errors whenever the binary is not a
bundle — which is every `wails3 dev` run there is, so a dev build has the menu
bar and no OS notifications. Permission is asked at the first wait rather than
at launch, so an install whose owner never runs an agent is never interrupted to
be asked. And the icons are **two inks rather than one template icon**
(`build/tray/{idle,waiting}-{light,dark}.png`, drawn by `build/appicon.py`):
macOS renders a template icon from its alpha alone, so the amber badge — the
whole point — would come out the same grey as the mark. macOS and Linux take one
icon and never ask for a second, so which ink is right is ours and is redecided
on `ThemeChanged`; Windows keeps both and swaps them itself.

**One colour, three shapes.** The button says the machine needs a person here
in amber, and what kind of needing is the glyph: a console breathing while an
agent is asking, a still pause while a stage was cut off — the CLI was closed,
or the app was, and nothing was reported. Quiet ink is the third, and it says
only that a CLI is running. A second colour would have needed a legend, which a
card cannot carry. Where the pause comes from is `StallKindConversation`: the
stall record gained a *kind* because one of the reasons a card stands still has
somewhere to go and the rest — a column with no free place, a folder another
card holds, a route with no edge — do not, and reading that off the reason's own
Russian is exactly what is never allowed. The shutdown path writes one now
(`stallCardConversation` in `stageterminal.go`), which it never did: the session
went to cancelled where only the panel would show it, and the next launch had
nothing on the board saying the card was mid-something. Recorded there rather
than at the next startup, because that is the one moment that knows *why* — a
session found stale on launch could equally be a crash. Continuing such a stage
by itself was thought through and deliberately not built (`docs/deferred.md`).

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

Which is why **the terminal page draws nothing over the screen**: the button
leads here, and what it leads for is on the screen already, drawn by the CLI. A
box of ours above the terminal covered the very thing the button was for.

**A stage writes one comment, and writes it at the end**: what the agent did,
or why it could not. There were a dozen once — started, cancelled, asked,
answered, terminal opened, moved along the route — and a card whose comments are
a log of the machinery is a card nobody reads, with the one thing worth reading
buried in it. Everything that was narrated there is shown instead: the branch and
the worktree on the card's stamp, the position on its route strip (whose reason
is kept in the flow event record rather than on the card), the question on the
card's face. What survives is what the card cannot show for itself — the summary
the agent handed to `finish_work` with what landed on the branch under it
(`stageComment`), a deploy or test report, the report a terminal somebody opened
leaves when its CLI exits, a session cut off by a restart — and `comment_card`,
which is the agent choosing to say something. A stage's terminal writes no
report of its own, or one piece of work would be commented twice.

**And the card does not draw them, because there is one person here**
(`docs/teamwork.md`). A comment is a thing said to somebody who will read it
later, and the person working this board is talking to the agent instead — in
the card's terminal, and in the talk conversation beside it. So the list and
the badge are *commented out* in `cardDetail.tsx` and `cardBadges.tsx`, blocks,
store and permission untouched, and they come back when there is a second
person to say something to. What that costs meanwhile is stated where it is
decided: the writes above still happen, and the `finish_work` summary is
readable only in the terminal the agent said it in and in the edge conditions
that match on it.

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
the column's) and its instructions (`Prompt`, same inheritance), and a card
carries one conversation per node (the terminal, above). Everything per-node
hangs off the node id, which is why it is the board option id and never
regenerated.

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

**The marker is the app's to give** (`TemplateMarkerProperty`, `xciiiTemplate`).
It is how the importer recognises its own copy of a template across launches, so
a copy that carries one is a copy claiming to be it: a board made from
«Разработка» carries the marker, `saveBoardAsTemplate` copies the board's
properties, and three «Разработка» stood in the picker while the importer
maintained whichever came last. A copy that carries one is **disowned** at the next
launch — the property comes off and it is listed among the person's own —
rather than deleted, since it is their board and all that is wrong with it is a
word it inherited. Taken off there rather than at the moment of copying because
there are two doors and only one of them is ours: «Сохранить как шаблон…» goes
through `saveBoardAsTemplate`, and «Новый шаблон из доски» in the sidebar's
board menu is a plain `duplicateBoard` that never touches our code. Read as the
single user, because a template somebody saved is private to them and the store
answers a caller with no user id with the open ones alone. Which templates are
*ours* is read the same way round: `createdBy`, not the version stamp, because a
board carries the version of the template it came from and a copy of that board
carried it too — the picker counted such a copy as shipped and then showed it in
neither list.

**What an agent is told first is two texts, and there are two because there are
two owners** (`internal/acp/boardprompts.go`). The board's — `boardPrompts`, on
the board as `xciiiPrompt`, so it travels with it — goes to everybody working
here, and is «Системный промпт доски…» in the board's ⋯ menu. The agent's own —
`AgentEntry.Prompt`, in the registry — holds on every board this machine has,
and is «Настройки → Агенты». `promptLead` puts them in that order in front of
whatever the caller appends, which is the one place four call sites used to
write the same two blocks by hand.

**A third was built and taken out again**, and the reason is the rule rather
than the feature: a text per (board, agent) is the only one of them that
belongs to no single thing a person can point at — a cell of a table, not a
setting of the board or of the agent — and a person cannot reason about what an
agent was told if the layers outnumber the nouns on screen. What a *folder*
wants said is already said in the folder, in the `AGENTS.md` its own CLI reads,
and what one card wants said is the card. So the dialog prints the order it
composes, and the count it prints is two.

And a board's automation **lives on the board** — `xciiiColumns`/`xciiiFlows` in the
board's own properties, in the board database, which is why a live board and a
template are the same two keys and why a template can carry automation at all.
`internal/acp` keeps the registry in memory because the engine reads it on every
card move, but every edit is written through to the board it belongs to
(`persistBoardLocked` in `boardseed.go`), and `config.json` does not carry it at
all: `Columns`, `Flows` and `BoardPrompts` are `json:"-"`, working copies fed
from the boards themselves. A board that refuses the write keeps its entries in
the registry for the run and the next edit tries again — the file is not a
fallback any more, which is the trade the move onto the board bought.

**A setting lives where its owner does**, and that is the rule the whole
settings surface is sorted by. The registries are the machine's — agents,
proxies, the tailnet, what a card-less conversation opens saying, whether an
agent waiting may interrupt, and the archive that carries every board in and
out — so they are `settings/appSettingsDialog.tsx`, one dialog of panels
opened from `sidebarSettingsButton.tsx`, reachable with no board open. Deploy
targets are the one registry whose *door* is elsewhere: the list is still the
machine's (the `deploy_target` table, shared by every board that deploys), but a Dokku
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
copy. What a board *runs* — its columns and its routes — is
`automationDialog.tsx`.

**What a board had to be asked before it can run is not that, and each question
is its own item in the board's ⋯ menu**: «Системный промпт доски…»
(`boardPromptsDialog.tsx`), «Папки…» (`workdirsDialog.tsx`), «Куда деплоить…»
(`deployTargetsDialog.tsx`), «Пройти настройку заново…» (the wizard). Which of
them a board has is **the board's own setup plan** (`BoardSetupPlan`), so the
menu differs by board exactly as the questions do: one that deploys offers a
deploy host, a board of household chores offers folders alone.

**The first question is the board's own name** (`SetupStepName`), and it is the
only step that is not about this machine and the only one with no way past it.
A board arrives called what its template is called, so the second one made from
«Разработка» is a second «Разработка» in the sidebar — and names are unique:
the step refuses one another board has, and so does renaming a board by its
title. One rule, `boardTitle.ts`, used at both doors a person types a name
through; trimmed and case-insensitive, because two boards nobody can tell apart
on screen are two boards with the same name whatever the bytes say. The wizard
reads the other names through `listBoards()` rather than the store, so it needs
no provider around it in a test.

**The plan is read off the board's stages, not off its template**
(`setupSteps`). It used to be the steps the template declared in `xciiiSetup`,
falling back to inference — and a declaration is written once, before the board
exists, so a board of household chores that grew a deploy stage a month later
was never asked for a host and never offered «Куда деплоить…» either: the stage
stood there when a card reached it with no door in the UI to fix it. It ran
stale the other way too. So the stages decide *which* questions there are and
the declaration decides what they say — the hint, the `required`, and the one
kind nothing implies (`source`: no arrangement of columns means cards should
arrive by themselves). A board with no stages at all is the exception, since
inference answers that case by offering everything: there the declaration is
the whole plan.

None of it makes a stage's question an obligation. An inferred step keeps the
closed set's own answer about being optional, because **a stage nobody has
configured is not a broken board** — it runs nothing by itself and a person
works the card there by hand, which is a way of using a column and not a
failure. The one place that is said out loud is the stage that cannot start at
all: a test stage with no browser anywhere gets a note in the editor's panel
saying so, and saying what happens instead (the card waits for a person). They were folds of the automation dialog, and that was
wrong twice over — setting up where an agent works is not a question about
columns and routes, and a fold under a canvas is a place nobody opens, which is
how somebody who had just answered "which folder" in the wizard ended up with a
card that could not name one.

**Relaxed mode is the word for that, and for the moment it is a word and not a
thing.** Every setup question may be left unanswered — «Пропустить» in the
wizard, or a chip nobody ticked — and the board still works, on a default this
side picks. What makes it a mode rather than a pile of accidents is that each
default is *named where the question is asked*, so leaving one is a choice with
a stated consequence rather than a screen somebody escaped from. There is
nothing in the code called `relaxed`: nothing stores it, nothing branches on
it, and a board is in it by not having said otherwise. Whether it should become
a thing the code knows — a flag, or a state a board reports — is open; the term
exists so the defaults can be argued about together instead of one dialog at a
time.

What it means today, question by question:

- **no folder** — a conversation about a card opens in «черновики доски», and
  an agent stage of a route stalls with a reason and keeps the card where it
  is (`errNoWorkdir`, `StartCardTerminal`);
- **no crew on the board's agent stages** — the card's assignee field offers
  every agent on the machine rather than none (`BoardAgentNames` empty narrows
  nothing), and who works the card is whoever it is assigned to; one agent
  registered answers that by itself, several and nobody assigned is the stall
  `resolveSessionAgent` reports;
- **no deploy target, no browser** — the stage does not start and the card
  waits for a person, which is the "not a broken board" rule above;
- **no action on a column at all** — a person works the card there, and that is
  what most columns on most boards are.

The rule a new default has to meet is the one those share: it must be sayable
in one sentence on the screen that leaves the question open, and it must be the
answer that keeps a person able to work — offering too many agents rather than
none, waiting rather than refusing, a folder of drafts rather than an error.

The rest of the ⋯ menu is export — the archive in the settings dialog is every
board there is, and one board's own is the board's own business, which is also
the whole of why import is not offered per board: what an archive brings is
boards, plural, and Trello/Notion/Todoist are instructions for making one rather
than an importer of ours. It is **last, under a separator**: carrying the board
out is not a setting of it, and the two exports used to open the menu with the
questions a person came for underneath them. A separator draws nothing when it
has no group above or below it (`separatorOption.scss`) — every menu here is
built out of `<Show>`s, so the group above a line can be empty, and that rule
lives with the line rather than being re-derived at each call site. **"Сохранить как шаблон…" is parked there**
(`OFFER_SAVE_AS_TEMPLATE`, one line in `viewHeaderActionsMenu.tsx`): the
machinery is untouched and still reached by the template picker's pencil, but
making a template is the rarest thing anybody does on a board and it stood one
slot from the things a board is set up with. Registering an agent needs none
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
register an agent in the settings, never open «Колонки и маршруты…», and
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
`agent`/`test` column is never asked for one, never grows a «Папка» property,
and a folder marked global joins only boards that already have that property.

### A folder hands out a workspace, and the card owns it

`internal/acp/workdirs.go` is the registry — named folders on this machine, one
of which a card names in its «Папка» field. The code calls them working
directories (`WorkdirEntry`), the screen calls them папки, and neither ever
calls them projects again: a folder of household notes is not a project, and
the word made every board of shopping lists look like it was missing one. The
keys in `config.json` (`projects`), on the board (`xciiiProjectProperty`) and on
a card (`project_path`, `repo_path`) keep their old spelling, because they are
other people's stored data.

**A card names its folder by id, and the id is the entry's own**
(`WorkdirEntry.ID`, `cardWorkdir`). The board records which property holds the
folder (`BoardPropProject`, `xciiiProjectProperty`); the *option* offering a
folder is created under that folder's registry id (`workdirSync.ts`), so a card
that names a folder is a card holding an ordinary select value that happens to
be a reference. Nothing about the entry has to stay still except the id — which
is what makes a rename possible, and what lets a place to work stop being a
folder on this disk at all: a repository to clone, a drive, a machine over ssh
have identities of their own, and for them the "name" is exactly the part
somebody will want to change. `docs/deferred.md` carried this as a plan; it is
this.

It used to be a **name**, matched by scanning every option selected anywhere on
the card and then the name of the column it came from, so a label named after a
repository decided where an agent worked — and since the names were collected by
ranging over the property schema, which is a Go map, which of two matches won
changed between events. The same rule already taken out of
`resolveSessionAgent`, for the same reason. Two fallbacks are left for data that
predates the id: an option made before it is matched by its *name*, and a board
that recorded no folder property at all gets the old scan, that being the only
thing such a board can say. `CardMoved.SelectedOptions` carries property and
option ids, and `CardMoved.Values` is the whole card keyed by property id —
filled on every path a card is read by, which is how any field this app made is
read off a card.

**The field is one choice, and the singular is the type talking.** A card claims
one workspace, works one branch — which the board keeps in a single text field —
and hands its agent one cwd, so a second folder had nowhere to go:
`resolveWorkdir` took the first of the selected options and dropped the rest,
which is a choice made for the person and made in silence. It was a
`multiSelect` until `narrowWorkdirProperty` (`workdirSync.ts`), which converts a
board that predates the change when it is opened — beside `retireAgentProperty`,
and for the same reason: a field narrowed on one board and still wide on the
next four is a migration nobody can trust. The name goes with the type, by the
rule that lets this app rename a field at all — it is one this app gave
(`OUR_WORKDIR_TITLES`), and a name a person typed is theirs and stays.

**A board with one folder fills the field in** (`soleWorkdirOption`, applied in
`centerPanel.newCardProperties` beside the view's filter and the group a card
was dropped into): one option is not a choice, and making somebody give the same
answer on every card is a question with no second option. Counted off the
*field* rather than the registry, because options are never taken away — a board
that has known two folders offers two, and two is a question only the person can
answer. It writes an ordinary value, visible and clearable, which is what makes
writing it unasked acceptable; the filter and the group still win, and a board
grouped by its folder is left alone entirely, or its empty group could never
take a card. `UserSettings.prefillCardFolder` is the switch, on by default,
kept by the install like the rest of `installKept`.

**Where a card's work is has one answer** (`Manager.CardWork`). Two places knew:
the claim in this app's own database, which knows the whole of it — directory,
branch, base, how the folder is worked in — and knows it only on this machine;
and the card, which knows one thing, its branch, and knows it everywhere,
because a card travels and its fields go with it. Every reader that picked one
was wrong somewhere: the folder lock read the claim and so let go on the second
machine, the stamp read the card and so spoke before anything was claimed. They
are merged once, with the precedence stated — the claim wins where it exists,
being the fuller record of the same fact — and `CardWork.Started` (work exists
anywhere) is deliberately a different question from `CardWork.Here` (this
machine holds it).

**And it stops being a choice once the card has a workspace**
(`cardDetailProperties.tsx`, read off `CardWork.Started` — work exists, which is
what "работа началась" actually means; the column the card stands in is not, and
neither is «this machine holds the workspace»). Work on a card lives in one place, claimed under the folder
the card named then, so pointing the field at another folder afterwards does not
move the work — it makes the card describe somewhere the work is not. The field
goes read-only with the reason under it, in the one place a person changes it,
rather than being refused later and further away. The card's face carries the
folder too (`KanbanCard__folder`), from the field and never from where a
conversation happens to stand: «черновики доски» is not an answer the card
gives.

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
somebody's uncommitted work — tracked work, since untracked files survive a
switch untouched and every checkout has some. Both refusals are **state, not
failure** —
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

The branch is named after the card's title, transliterated (`dokku.foldLabel`
carries а Cyrillic→Latin table, so «Почини логин» is `pochini-login-…` rather
than a hash) — or by the agent itself when `agentNamedBranches` is on: a short
headless ACP session (`naming.go`, the same shape as a source's run) answers
with one name, no terminal appears, and anything wrong with the answer falls
back to the title. Machine-wide, because it is about how this machine spends
agent runs.

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

**`finish_work` is how a stage of a route ends**, and it is the load-bearing
piece of the arrangement above: an agent stage is a terminal, and only the agent
knows the work in it is over. It says done-or-not and one line of what it did;
that becomes the flow trigger, the card's one comment and the end of the
conversation. A run that is not a stage — a planning terminal, a card outside any
route — is told so and pointed at `move_card`, since the tool is about a stage
rather than about the board.

Three tools are not about the board at all, and all three are there because
**nothing else can know**. A terminal is the vendor CLI in a pty, not an ACP
session, so no protocol carries a title, a recap or a stop reason, and the only
other source would be the CLI's own transcript file — its private business, in a
different shape per kind. The agent, on the other hand, is the one having the
conversation, so it is asked: `finish_work` above, `describe_conversation`, one
line about what this conversation is doing, and `name_conversation`, what it is
called. The grant names the terminal (`BoardGrant.TerminalID`), which is what
keeps an agent from describing somebody else's; the recap lands in
`TerminalInfo.Summary`, drawn under the name in «Открытые терминалы» and on
«Терминалы» on a phone, and both are kept in the record so they come back with
the conversation. The two are split rather than one call with two fields because
they are edited from opposite ends: the recap is the agent's, volunteered and
replaced as the conversation moves on, while the name is the row's — a person
types over it — and it is *asked for* rather than offered (`AskTerminalName`).

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
filled that column in simply runs without the tools, and since a stage of a route
*is* a terminal that now decides more than whether the window is useful: no
tools, no `finish_work`, so `stageRunsInTerminal` leaves such an agent on the
protocol rather than opening a conversation nothing could end.

A deploy or a test session could take the same server through `session/new` and
does not: a card's own agent creating cards — or moving its own card into the
column that starts it — is a loop with nothing to stop it, and that wants a
decision before it wants code. An agent stage no longer has the question, being a
terminal with a person able to watch it.

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

### A terminal is where the work happens, watched or not

`internal/acp/terminal.go` + `terminalws.go` run the agent's **own CLI** in a pty in
the card's worktree, drawn by xterm.js and wired over a WebSocket on the front door
(`/acp/terminal/{id}/ws`).

It began as the place a person works *with* an agent, and it is now both that and
the place the automation works: an agent stage of a route is a terminal, opened
with the card's task already in it (`stageterminal.go`, above). One mechanism,
two callers, and the same conversation either way — asking for the card's
terminal while a stage is running hands back the stage's own, because that *is*
the conversation about that card at that stage.

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

**A conversation is keyed (card, node): one per column the card has stood on.**
The node is the option id of the column — the same id a route's stage hangs off
(`FlowNode.ID`) — so the person who opens a terminal on a column and the stage
that runs there are in **one** conversation, with the column's agent, workspace
and prompt. Come back to the node and you come back to the session. A card with
no column at all stands on `nodeNone` (`@none`, spelled with `@` because option
ids are not made of it) and can still be talked over. A stage with no route
behind it keys by its column's option id too (`Session.NodeID`).

That is the key **work** is filed under, and a stage joins the conversation
already open there: `startStageTerminal` **adopts** it (marks it a stage, types
the task in) rather than opening a second CLI beside it. What a column means —
who works there, what they are told — is the column's setting, so a person who
sat down at a stage and the stage itself belong in one place.

**A conversation is also one of two kinds, and the kind is declared rather than
derived** (`nodeTalk`, `@talk`). Work stands in the card's workspace, a route
may join it, it ends in `finish_work` and leaves a branch; **talk** — the
wording, the plan, the brief — claims nothing and ends in nothing. There was a
key for that once (`@brainstorm`), taken out because the split it made was
arbitrary; what the node model could not express is this axis, and while the
kind was *inferred* — from the column the card happened to stand in, and from
whether it had named a folder yet — the two collided. A card talked over before
it had a folder took the node's key with a conversation standing in «черновики
доски»; the stage then typed its task into a CLI sitting there, made a branch,
wrote the branch on the card and left it empty. Neither the lists nor the button
on the card could say which kind a row was, because nothing knew.

**Work refuses what talk is allowed.** A card with no folder has nowhere for
work to happen, so `StartCardTerminal` returns `errNoWorkdir` rather than
falling back to the drafts folder — that fallback is talk's, and it was the
silent half of the collision above. The refusal is what makes the panel ask
which folder (it already turns an error into the chips), and the console button
on the card's face — a window, an interface with no way to ask anything — opens
**the card** instead (`openCardTerminalWindow` answers false).

So there are **two doors** — `StartCardTerminal` and `StartCardTalk`, bound as
`OpenCardTerminal`/`OpenCardTalk` — and the card's own conversation is always in
the list, first, spoken in or not: it is the one that asks nothing of the card.
It is also the one thing about a conversation that is *not* re-resolved each
time it opens: it stays in the folder it started in, because it is a train of
thought with a transcript behind it and the CLI's own resume is
directory-scoped. `startStageTerminal` keeps a second guard behind the key —
adopt only what stands in the stage's own place — because the cost of being
wrong there is silent.

**Where a conversation runs is the node's answer** (`cardPlace`). On a column
that runs an agent it claims the card's workspace exactly as the stage would —
so the stage joins it in the right directory — honouring the node's `RunIn`. On
every other column `talkingPlace` stands it beside the work: the copy the card
already has, else the folder, else «черновики доски». And it asks little of the
card: no folder is an ordinary case, nobody assigned is answered by the node's
crew, then the assignee, then the single agent — a fully busy crew does not
block a terminal, since the person opening one is present.

**A card returning to a node resumes that node's conversation with a brief, not
the task** (`returnBrief` → `terminalSpec.returnPrompt`): the conversation
already had its task, and what it lacks is why the card is back — the trigger
and what the stage it returned from reported, which `flow_event.said` keeps
(the agent's closing words, threaded through `advanceFlowWith` → `enterNode`).
A still-running CLI on a passed node stays reachable by id until it exits — a
person's terminal is never killed. Resume metadata is per conversation; the
transcript `claude --continue` picks up is directory-scoped, so two
conversations sharing a directory share a transcript — the same trade every
non-git folder already makes.

**A stage has a prompt of its own, inherited like its crew**: what working in
this column *means* — the reviewer's brief on «Ревью» — lives on the column
(`ColumnSpec.Prompt`, the textarea on the «Колонки» tab) and a route node may
override it for its stage alone (`FlowNode.Prompt`, whose placeholder names the
column's answer). It lands after `promptLead` and before the card's task in
every compose path (agent, deploy, test) and opens a person's conversation on
that node too (`joinPrompts(place.prompt, cardIntro(ev))`). Typed by a person,
so it passes through as data in whatever language the board works in.

**Properties are the dataflow, and a stage declares its half**
(`PropertyWrite`; `Writes`/`Reads` on `ColumnSpec` and `FlowNode`, inherited
like the crew). Writes are what makes a transition on a property deterministic:
an agent stage delivers the values through `finish_work`'s `properties` and a
required one is refused without — checked in `FinishWorkFromTools`, which also
**writes the fields before delivering the report**, deliberately twice over:
the route advances on the report and its edges read the card as it is then,
and a write the board refuses (no such option, no such property) comes back as
the tool call's own error to the one party that can fix the value. The write
is silent (`SetCardFields` in the writer: a select by option name, anything
else as text) because the outcome is the one event the route acts on; the
column property is refused — the card moves by the outcome or `move_card`. A
deploy stage writes its preview URL and a test its verdict by itself
(`writeStageFields`), so those facts stop dying in comments. Reads open the
brief valued (`cardInputs`, «From the card: …») — sessions and the person's
conversation on the node alike. The editor edits both lists
(`writesPicker`/`readsPicker`; deploy/test get a single picker for their one
machine value) and warns per route about a conditional edge whose property no
stage writes (`unwrittenConditions`) — named, not refused, since the value may
be a person's own click.

**Tools are the column's answer too, and inherited exactly as the crew is**
(`MCPServers` on `ColumnSpec` and `FlowNode`, resolved by `startOptions.
stageMCP` and by `cardPlace`). A browser belongs to «QA» and not to whoever
works it: the alternative was registering one agent twice under two names to
have it configured two ways, which is a copy of a thing to stand in for a
setting of another thing. The set is **added** to what the agent carries in the
registry, and a node's set replaces the column's whole answer rather than
merging with it — what the editor shows on the stage is what the agent gets. It
travels by the road each kind of run already has: a session gets it as
`extraMCP` with the tool prefixes allowed (wiring a server in is consent, the
same bargain `agentMCPServers` takes), and a terminal — which is what an agent
stage is — gets it in the config file the board's own tools already travel in
(`openBoardTools`), where the CLI's own permission prompt is the answer. Two
names are refused where the JSON is typed: dokku's, as before, and
`boardmcp.ServerName`, because that file has one key per server and a set that
shadowed it would put out `finish_work` — the call a stage ends through. The
one behaviour this changed rather than added: a test session is refused for
having no browser only when *neither* owner brings one.

**The panel is «Терминалы», the list, and the conversation being read under
them** (`GetCardAgent.conversations`) — one row per node, the current column's
first and always present (`CardConversations` synthesizes it before anything has
been said there, because it is the one a click opens) — and each part owns its
own ✕: the head's closes the panel, the one over the terminal puts that terminal
away (the CLI keeps running; ending it is the bin on the row). The row is the
row «Обсудить с агентом» draws — `conversationRow.tsx`, shared, because the two
screens list the same thing and had drifted into two shapes of it. The current
node's row starts or resumes on a click; another node's opens only while its CLI
runs, and otherwise continues when the card returns to that column. **Every row
has the bin except a running stage's** (`CardConversation.Stage`): deleting ends
the CLI and the record (`DeleteCardConversation`), so the next conversation on
that node starts blank, and the card is told nothing about an exit somebody
asked for (`discarded`); the running stage's is refused because the route is
waiting on it. Rows are drawn with `Index` rather than `For` — the list is
re-read on every `acp:terminal` event, and identity-keyed rows would take a
half-typed rename with them. A row is never named after the card
(`conversationTitle` drops a title that is just the card's): it falls back to
its column, or «Без колонки» (`NoColumn`), so two rows cannot read as one thing
twice — what survives is a name somebody gave, by hand or through
`name_conversation`.

**A conversation opens with what the card says** (`cardIntro`): the person
clicking the button has the card in front of them and the agent has nothing, so
the first thing anybody typed was the title they were both looking at. It rides
in as `terminalSpec.intro` — the first message of a conversation that is
*starting*, dropped on a resume, where repeating it would read as a new
instruction. A stage's `prompt` is not dropped, because a stage hands over a
task every time it runs.

**A folder is optional, an agent is not — and neither is picked silently.** A
card can be talked over — wording, a plan, the brief — before anybody decides
where the work lives, so "the card names no folder" is not a refusal:
`resolveWorkdir`'s two nothing-chosen errors are marked `errNoWorkdir`
(workdirs.go) and `StartCardTerminal` opens the node's conversation in **«черновики
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
an icon — open (`ShowTerminal`), rename (`RenameTerminal`), ask the agent for a
name (`AskTerminalName`), end (`CloseTerminal`) — and **ending is asked about**,
because it stops a CLI somebody is using and is the only way this list gets
shorter: the list *is* the terminals that are running. The dialog subscribes to
`acp:terminal` rather than reloading on its own, since the recap arrives
mid-turn, while it is open.

**A name is asked for in the conversation, because that is the only way in.**
`AskTerminalName` types one English line into the pty (`namingAsk`, delivered on
the same quiet-wait `deliverPrompt` uses, so it lands between turns) and the
agent answers with `name_conversation` — the same field `RenameTerminal` writes,
capped at `terminalTitleLimit` so an answered sentence stays a row. This is the
one message this app ever puts into somebody else's conversation, and it earns
it: until the agent says so, every row reads «клаус · черновики доски». A CLI
that took no board tools cannot answer, so `TerminalInfo.Tools` is what the
button is drawn on.

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
left on the branch (`workLanded`). Opening the terminal is not commented — it is
on the card, in front of whoever opened it. A *stage's* terminal writes no such
comment, because the stage already wrote one carrying the same facts under the
agent's own summary. Terminals outlive the panel and the window and resume —
every one is recorded, so the next terminal on that card returns to the card's
own workspace with `claude --continue`.

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

**A terminal somebody opened raises nothing; a stage's does.** There is no
protocol to ask through in a pty, so the only signal is silence — and the same
measurement means different things in the two cases. On a terminal a person
opened, nothing happening is the ordinary state: it announced "needs you" five
seconds later, every time, including after the window was closed, and a signal
that is wrong more often than right is worse than none — the window is in front
of whoever opened it anyway. On a stage the agent was handed a task and has not
called `finish_work`, so a CLI drawing nothing has stopped *for somebody*
(`watchStageQuiet`, `AttentionTerminal`). That is the whole difference, and it is
why `acp:attention` has two reasons again without the old bug coming back.

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
`edition.ManifestURL` — `https://updates.deffun.org/stable.json` for the base
build — a domain of ours rather than a release page on somebody's platform,
because every copy already installed asks there and nowhere else: where the
*files* are kept is a decision that can be revisited every release, and that
one line cannot. So the manifest sits at one unchanging address and the
artifact links inside it are absolute per version (`…/v1.1.0/base/…`), which is
what lets one never move and the others always. It is also the only place the
release address is written down — the workflow reads the prefix back out of the
constant — so the app and the release cannot come to disagree about where a
release lives. **Which address it is belongs to the edition** (below): one
manifest names one artifact per platform, so a shared feed would hand a
lifetime install the base app under the version number it was waiting for.

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

### An edition is a build, not a flag

This tree compiles into two products (`internal/edition`, `docs/editions.md`):
`base`, which everybody gets, and `lifetime`, bought once, whose whole
difference today is that it embeds more board templates. **Which one a binary
is, is a build tag and is never read at runtime** — a licence file, an env var
or a flag makes the difference a thing this process *reads*, and anything read
can be made to read the other answer, while what the paid edition buys is files
that are simply not in the base binary. `templates/lifetime/*.jsonl` is a
second `go:embed` behind the tag (`templates_base.go`, `templates_lifetime.go`)
joined with the shipped set by `shippedTemplates`; `EDITION=lifetime` on any
Taskfile target adds the tag; the release workflow's matrix is `edition ×
platform`.

**The page is not told, and that is the point.** `VISIBLE_TEMPLATE_SLUGS` names
every edition's templates, and in a base install the extra slugs match no board
because no such board was ever imported. A page that knew which edition it was
would be a page that could be told otherwise.

Editions are also why the release feed moved into `edition.ManifestURL`
(above), and why the constants there are one `const` per line: CI reads them
out of the source with `sed`, the same way it reads the version.

The other end of that rule: **a template this build does not ship is deleted at
startup**, which predates editions (`importTemplates`) and is what makes
installing base over lifetime take the two extra templates away. Boards made
from them are the person's and are untouched.

### One database, and the schema is written once

Everything this application knows is about a card or a board, and both of those
are rows in the board's database. So our tables are in it too — `conversation`,
`agent_session`, `flow_state`, `card_stall`, `stage_queue`, `workdir_claim`,
`source_item` and the rest — rather than in files beside it, which is where they
began (`acp.db`, `sources.db`). `internal/acp` and `internal/sources` take a
`*sql.DB` (`NewStore(db)`) and create nothing; `server.NewStore` hands
back both the store and the handle under it, and `runServerWithLogger` carries
the pair as `board{srv, db}`.

**The reason is a leak rather than tidiness.** Deleting a card is a real
`DELETE FROM blocks`, and this side never heard about it — `BlockChanged`
handles only `notify.Update` — so a deleted card left its conversations, its
place on a route, its stall and its queue slot behind for ever. A foreign key
onto `blocks(id)` is the fix, and it cannot be added later: SQLite's
`ALTER TABLE` has no `ADD CONSTRAINT`, so a key is written in `CREATE TABLE` or
never. The keys are written; **turning the check on is a separate step**
(`docs/store-plan.md`, step 4), because every remaining empty string that means
"nothing" has to become NULL first, and because `PRAGMA foreign_keys` is a DSN
parameter whose name depends on which SQLite driver the build tag chose.

**The schema is Go data, and the SQL is generated.** `tools/schemagen` holds
every table once with dialect-neutral types, and `ariga.io/atlas` renders
`000041_app_tables.{up,down}.sql` for SQLite, MySQL and Postgres. Writing three
dialects by hand is what the fork's other eighty migrations do, and every
`{{if .postgres}}JSON{{else}}TEXT{{end}}` is a place somebody has to remember
three answers to one question — here the question is asked once and one table of
types answers it. Atlas is a build-time dependency: what ships is the SQL, in
the repository, and `go test ./tools/schemagen` fails when the two disagree.
**Transactions work on SQLite**, and getting there is a chain worth knowing.
`@withTransaction` was switched off for SQLite because turning it on failed with
`UNIQUE constraint failed: blocks_history.id, blocks_history.insert_at`: the
history tables keyed on `(id, insert_at)`, `insert_at` comes from the database's
own clock, and inside a transaction SQLite hands every statement the same
instant. So the fork's composite operations — insert a block, write its history,
touch the board — ran as separate statements on the database everyone actually
uses, and a failure halfway left the database half-changed. That is what made
two test suites flaky, and it is why deleting a board and undeleting it at once
returned a 500 about a third of the time. The fix is that **`insert_at` comes
from Go** — `utils.NextInsertAt`, a per-process clock that never returns a
millisecond it has already given out — written at each of the eleven places a
history row is made, two of which are `INSERT … SELECT` and carry the stamp as a
literal in the projection. The keys stay, and one reader depends on them:
`undeleteBlockChildren` picks each block's latest history row by
`max(insert_at)`, so two rows sharing an instant hand it the same block twice and
it violates `blocks.id` on the way back in. The SQLite branch is gone from
`generators/transactional_store.go.tmpl`. What monotonicity does not cover is two
processes on one database; nothing here does that, and the honest answer when
something does is a key of the row's own rather than a clock.

**A closed set is a `CHECK`, a growing one is not.** `checkout.mode`,
`workspace_board.mode`, `agent_session.status`, `board_setup.status` and
`source_event.outcome` are constrained in the schema, because what they may
hold is closed by the model — there is no fourth way to work a folder. An agent
kind is a vendor CLI, a `session_event` kind is an event name, and a
`workspace` kind is meant to grow past `git` to a drive or a machine over ssh:
those have no check, because SQLite cannot `ALTER` one in, so a check on a
growing set buys a table rebuild every time somebody adds a value.
`TestAValueOutsideAClosedSetIsRefused` is the guard, and it covers the case
worth naming: a difference in *case* is refused too.

**The three dialects are checked, not assumed** (`internal/dbtest`,
`.github/workflows/test.yml`). The fork's fixture could always be handed a MySQL
or a Postgres on a port, and nothing ever handed it one — no compose file, no CI
job — so every run took the SQLite branch and went green, which is the worst
kind of green. `FOCALBOARD_STORE_TEST_DB_TYPE=postgres go test …` now starts the
container it needs (testcontainers-go, from the tests themselves, so there is no
second description of the containers to drift), and `wails3 task test:db:all`
runs the three in turn. What the first real run found, in order: **the MySQL DDL
would not execute at all** — a key column declared NULL, which SQLite permits
and MySQL refuses outright, so `build()` now forces NOT NULL on every key column
and the golden test carries that as a declared departure; `DEFAULT "NOW(6)"`
written as a *string* because atlas quotes any raw expression on a time column
that does not begin with `current_timestamp`; **board search by property name
had never worked on Postgres**, since `properties` is a text column and `->` has
no text overload; and the last data migration read the collation of a table
called `Channels` — Mattermost's — and took the whole open down with it. Every
one of those is a thing that only exists on the vendor nobody ran.

**golang-migrate still runs it**: this is a generator, not a migration engine,
and the engine already knows about versions, dirty marks and the record the
previous one kept. `go generate ./tools/schemagen` after any schema change.

**The ladder is one rung.** `000001_init` is the whole schema — the fork's tables
and ours — where there used to be eighty-one files of archaeology leading to it
(`{{if doesColumnExist "boards" "minimum_role"}}`, `ALTER TABLE blocks DROP
PRIMARY KEY`, three data migrations interleaved at particular versions to repair
rows the next step would refuse). None of it means anything to a database made
today. What made deleting it safe is that the result is *checkable*: the
generator can print the schema as plain SQLite DDL, and a test compares it —
column, type, nullability, default, key and index — against a snapshot of what
the ladder actually built (`tools/schemagen/testdata/`). Column widths are
checked separately, because SQLite ignores them and atlas therefore does not
emit them, so a `varchar(64)` narrowed to `varchar(32)` is invisible to the
first check and silently truncates data on the two dialects nothing here can
run. A database built by the old ladder is refused with a message saying to
delete it: there is no release, so the only ones that exist belong to whoever is
working on this.

**No table carries a prefix.** `{{.prefix}}` in the migration, `s.tablePrefix`
at a hundred and thirty query sites, `DBTablePrefix` in the config and the
`{in braces}` our own queries were written with all named the same thing: the
namespace Focalboard's tables needed when they lived inside a Mattermost
database as a plugin. This application never set it — the default was `""` and
nothing overrode it — and the two places that did were tests, which get a
database of their own anyway. It went, and the migration's template actions went
with it except the three `{{if .sqlite}}` that pick a dialect. So did the
helpers those migrations were rendered with: `addColumnIfNeeded`,
`doesColumnExist`, `renameTableIfNeeded` and six more, four hundred lines of
per-dialect SQL string building that the collapsed ladder calls from nowhere.

Two consequences worth knowing before touching a query. **Absence is NULL**
wherever a key looks: a planning conversation has no card, and `''` is a card
id that does not exist; the reads say `COALESCE(...,'')` because in Go absence
here is the zero value. And **no
journal has an autoincrement** any more — `session_event`, `flow_event` and
`source_event` take UUIDv7, which sorts by the moment it was made, so
`ORDER BY id` still means "as it happened" and three spellings of
`AUTO_INCREMENT` are gone. `session_event.seq` went with them.

A test needs that schema and must not carry a copy of the DDL, because a copy
drifts — the exact bug all of this is about. `internal/appschema` renders the
same migration out of the same embedded filesystem onto a scratch file; that is
the only thing it is for, and the running application never touches it.

`conversation` and `agent_session` stay two tables on purpose. **A conversation
outlives every process that drew it** — it is resumed, `claude --continue`, and
the row is the conversation while the pty under it has changed three times —
where a session is one run and one verdict. `docs/deferred.md` records the rest.

**The registry's own name is decided but not yet applied.** `workdir` says
directory, and the whole point of the entry having an id is that tomorrow it need
not be one. At step 2, where these columns are rewritten anyway, it becomes
**`workspace`** — the named place, carrying the git *settings*: `kind`,
`base_branch`, `branch_prefix`, the per-board mode. What it hands one owner
becomes **`checkout`** — dir, branch, base, mode, the git *state* — in a table of
that name instead of `workdir_claim`. That reads as what it already is, because a
plain folder records no row at all: `ClaimWorkspace` creates and writes nothing
for `WorkModePlain`, so the table only ever held git copies. Not `project`,
though every stored key still says so (`projects`, `xciiiProjectProperty`,
`project_path`): that word was removed for a product reason which has not changed
— a folder of household notes is not a project, and it made every board of
shopping lists look like it was missing one.

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
- **Everything the system says to an agent is English**, and that is a third
  register rather than a corner of either. A prompt, an MCP server's
  instructions, a tool description, a `jsonschema` field, the sentence a tool
  answers a call with — all of it is read by a model, on a machine whose person
  may be working in any language, and there is no reason for that text to pick
  one. What a *person* wrote travels through it as data and keeps its own
  language: the card, the board's own prompt (`boardPrompts`), a column's name,
  a rewrite of `DefaultPlanningPrompt` in the settings. Where the answer comes
  back to a person — a name for a conversation, a comment on a card — the prompt
  asks for the language of the conversation rather than assuming one
  (`namingAsk`, `cardIntro`). The defaults this repository ships (`config.go`'s
  three prompts, `boardmcp`, `internal/dokku`, `internal/sources/inbox`) are
  English for the same reason; what those tools say to a *person* is not, and
  stays Russian.
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
- **Where the model is written down.** `docs/schema/erd.md` is the schema drawn
  — every table and column, as a mermaid ER diagram — and `docs/schema/app.hcl`
  is the same schema as Atlas HCL, for pointing Atlas's own tooling at. **Both
  are generated** by `go generate ./tools/schemagen` out of the Go data the
  migration comes from, and a test fails when either is stale: a picture of a
  schema maintained by hand is a second description of it, and the second one
  goes wrong. Which tables are drawn together is the one hand-written part
  (`erdGroups`), because that is a judgement rather than something the schema
  knows. `python3 tools/schemapage.py` dresses the same markdown as
  `docs/schema/erd.html` — a page to open in a browser, presentation only, and
  nothing in the Go build calls it. `docs/db-erd.md` is what is stored where in words,
  `docs/model-graph.md` is how one thing finds another — and what is still found
  by name rather than by id — `docs/db-schema-review.md` is the decisions
  behind it, `docs/store-plan.md` is the work that followed, and
  `docs/sql-dialects.md` is the inventory of what is still written per vendor —
  fifteen branches in the queries, ten of them the same upsert, two of them
  functions only a test calls. `docs/sql-plan.md` is that half's plan and its
  history. `docs/schema/ent.md` is why ent was weighed and turned down. The rule they are kept to: **a
  reference is a foreign key** — everything referable lives in one database and
  has an id, the settings file holds only what nothing points at, and nothing at
  all is found by name.
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
