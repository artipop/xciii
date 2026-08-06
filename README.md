# XCIII

A desktop board that runs coding agents from the board itself. Moving a card
into a column starts an agent on it; opening a terminal on a card puts you in that
agent's own CLI, in the card's worktree, with the branch and environment already
set up. One binary, built with [Wails v3](https://v3.wails.io), with the board
server running **in-process** — no spawned server process, no Node.js of our
own — and the same code builds a **headless server** (`-tags server`) that serves
the whole thing to a browser.

The frontend lives here, in `webapp/` — its own npm project built with Vite. The
**server module does not**: it is a fork of Mattermost's Focalboard server, and
`go.mod` `replace`s it to `../focalboard/server`, so that checkout beside this one
is still what a build needs:

```
sources/
  focalboard/   # github.com/artipop/focalboard — the server module
  xciii/        # this repository, webapp included
```

**That checkout has to be on a branch carrying the fork's server patches** —
`experiments` — because this app needs `GetUserByUsername` and two single-user
endpoint fixes that upstream does not have. Settling that properly is the first
open question: see [docs/plan.md](docs/plan.md), "Открытые решения".

## How it works

The Go code is platform-agnostic — the same files build for every OS:

- `server.go` — starts the board server in-process in single-user mode on a
  free port. The SQLite database and uploaded files live under the OS user config
  dir (`os.UserConfigDir()` → `~/Library/Application Support/XCIII` on macOS,
  `%AppData%\XCIII` on Windows, `~/.config/XCIII` on Linux), **not** next
  to the binary, because a signed/packaged app dir is read-only.
- `frontend_embed.go` / `frontend_disk.go` — the webapp `pack` is compiled into the
  binary with `go:embed` (release builds, `-tags frontend`) straight from
  `webapp/pack`, where the `build:frontend` task leaves it.
  At startup `resolveWebPath` extracts
  the embedded pack to `<dataDir>/web` and points the server there (the server
  templates `index.html` on read, so it needs files on disk). Without the tag
  (`go build ./...`, tests) it falls back to on-disk `pack`.
- `frontdoor.go` — **the origin everything is served under**: `/wails/` goes to
  the Wails runtime, everything else to the board. In a desktop build the front
  door is a loopback listener of ours on a random port, handed to Wails as an
  `AssetServerTransport`, and the window is pointed at it instead of the
  `wails://` origin. In a server build it stands in front of Wails' own HTTP
  server, which is moved to a private port.

  One origin is what lets the **WebSocket** work: Wails' asset server answers an
  upgrade with `501 Not Implemented` and its response writer cannot be hijacked,
  so `/ws` can never be served through it. Beside it, on a plain `net/http`
  server, an upgrade is ordinary — which is why there is no
  `window.webSocketBaseURL` here, unlike the v2 app, whose page origin (a WebKit
  custom scheme) could not carry a socket at all.

  Because a loopback port is reachable by anything on the machine, `/wails/`
  refuses a request whose `Origin`/`Sec-Fetch-Site` says it came from another
  site (the bound methods start agents; the endpoint carries no credential of
  its own), and the whole front door refuses a `Host` it was not published
  under — the standard answer to DNS rebinding.
- `proxy.go` — a reverse proxy to the in-process server, sitting behind the
  front door on everything but `/wails/`. It injects a bootstrap `<script>` into
  the served HTML that seeds the single-user session token into `localStorage`,
  **builds the bridge the webapp calls through** (see below), and wires
  `window.openInNewBrowser` to open external links in the system browser. A
  capture-phase click handler sends **every** absolute http(s) anchor there,
  same-origin ones excepted. It deliberately does not defer to the inline
  `onclick` that `Utils.htmlFromMarkdown` puts on markdown links: when that
  handler does not run, the click is simply lost — the webview cannot navigate
  to an outside origin either — which is what made preview links in card
  comments dead.

  **The bridge** is what replaces v2's generated bindings. v3 injects nothing
  into the page: it serves `/wails/runtime.js` and the page loads it. So the
  bootstrap imports that module once and builds `window.go.main.App` (every
  property read becomes `Call.ByName('main.App.<name>', …)`, the fully qualified
  name of a method on the bound `App` service) and `window.runtime.EventsOn`
  (`Events.On`, unwrapping the event object v3 passes where v2 passed the
  payload). The webapp therefore sees exactly the surface it saw under v2 —
  the migration needed no change in `webapp/` at all — and stays inert in
  browser and plugin builds, where nothing injects this script.
- `internal/acp/terminal.go`, `terminalws.go` — **the way a person works a card with
  an agent**, and the only one: the agent's own CLI running in a pty in the card's
  worktree, drawn by xterm.js in a second window of the app and wired to the pty over
  a WebSocket on the front door. The session console this module used to carry — the
  transcript, the prompt box, the permission buttons — is gone with everything behind
  it, so a session is now one turn (a card's task, run and reported) and a tool
  outside the policy is refused rather than put to somebody who is not there.
  It is not an ACP session (an ACP agent speaks JSON-RPC on stdio and has no terminal
  UI) — it reuses everything around one: the project, the worktree and branch, the
  agent's environment and proxy. The card is told when it opens and what it left on
  the branch when the CLI exits, and the next terminal on that card returns to the
  same worktree with `claude --continue` / `codex resume --last`.
- `app.go` — the bound service. Its exported methods are what the frontend
  calls; `OpenInBrowser` is the one the bootstrap script uses.
- `mode_desktop.go` / `mode_server.go` — everything that differs between a
  window and a server: the front door, the window, and the folder picker (a
  server build has no native dialog and says so, rather than returning an empty
  path the UI would read as a cancellation).
- `main.go` — wires it all together and runs the app.

Builds are **native per platform** (each on its own machine/CI runner) — cgo
SQLite does not cross-compile with the host toolchain; `wails3 task
setup:docker` builds the image that can, if a Mac has to produce a Linux or
Windows binary. Nothing generates JS bindings: the webapp calls bound methods by
name through the bridge above, which is what v2's `-skipbindings` meant.

**[How a card gets worked on](docs/flows.md)** walks through the whole thing for
somebody using the board: what happens when a card lands in a column, when a
worktree appears and what becomes of it, which branch is followed, the routes
the template ships, and what to look at when nothing happens.

## What this app requires of the frontend

The desktop app serves and embeds `webapp`, and knows nothing about what it is
written in. There is no React here, and none of the migration off React-only
libraries touched this module. What the two halves *do* agree on is worth
writing down, because it is the whole of what a port to another framework has to
keep — `webapp/src/types/index.d.ts` declares the shape, and this is the
contract behind it.

**The build output.** `build:frontend` must leave `webapp/pack/index.html` plus
everything under `webapp/pack/static/`, which is copied to `pack/` here and
compiled in with `go:embed`. `index.html` must still carry the Go template
`{{.BaseURL}}`, and asset URLs referenced from JS and CSS must stay relative so
they survive a non-empty base path.

**Three globals**, built by the bootstrap script in `proxy.go` — v3 injects
nothing, so the script imports `/wails/runtime.js` and rebuilds the surface the
webapp already knows:

- `window.go.main.App.*` — a Proxy turning every property read into
  `Call.ByName('main.App.<name>', …)`. This is how the ACP UI reaches the agent,
  repo, proxy and flow registries.
- `window.runtime.EventsOn` — wraps `Events.On`, unwrapping the event object v3
  passes where v2 passed the payload.
- `window.openInNewBrowser` — hands a link to the system browser rather than the
  webview. Called from `utils.ts`, `csvExporter.ts`, `archiver.ts` and the
  sidebar user menu.

There is deliberately **no `window.webSocketBaseURL`** here, unlike v2:
`frontdoor.go` owns the origin, so `/ws` opens from the page's own origin.

**Every one of them is feature-detected at the call site**, because the same
bundle also runs in a browser and as a Mattermost plugin, where none of them
exist. That guard is what keeps the desktop-only UI inert elsewhere, and it is
the one thing a rewrite must not quietly drop.

## Prerequisites

- Wails v3 CLI (it carries its own task runner, so no separate `task` binary):
  ```
  go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.2
  ```
- A C toolchain for the cgo SQLite build:
  - **macOS**: Xcode Command Line Tools.
  - **Linux**: `gcc`, plus `libgtk-3-dev` and `libwebkit2gtk-4.1-dev` (Wails).
  - **Windows**: MinGW-w64 `gcc` on `PATH`, NSIS (`makensis`) for the installer,
    and the WebView2 runtime (bundled with modern Windows).
- **Linux and Windows installers** are generated by the v3 CLI itself
  (`build/linux/appimage`, `build/linux/nfpm`, `build/windows/nsis`); nothing
  else has to be installed for them.
- **Building for another platform from a Mac**: `wails3 task setup:docker` once
  (~800MB), then `wails3 task linux:build` / `windows:build`. Binaries only —
  the installers are native-tool jobs (AppImage shells out to `ldd`, NSIS is
  `makensis`), and a cross-built `.exe` comes out on the console subsystem
  (zig's linker ignores `-H windowsgui`), so it flashes a console window.
  Native builds on the target platform stay the release path.
- **Linux targets GTK 3** (`gtk3` build tag, webkit2gtk-4.1). Wails v3 defaults
  to GTK 4, but its GTK 4 code needs 4.10 — newer than several still-supported
  distributions ship. `GTK_TAG=` drops the tag where GTK 4 is new enough.
- **Browser-testing sessions** (the "To Test" column) need a browser MCP server
  on the agent — under *Agents → MCP servers*, paste the same JSON any MCP
  client takes, e.g. `{"mcpServers": {"playwright": {"command": "npx", "args":
  ["-y", "@playwright/mcp@latest", "--headless"]}}}`. The app ships no
  browser driver of its own and stays Node-free; the server is the user's
  choice, and a test session refuses to start for an agent without one. Each run
  gets a directory under `artifactsDir` (default
  `<dataDir>/artifacts/<session-id>`) where the agent is asked to save its
  screenshots and write `result.json` — that verdict is what moves the card.
- **Templates**: the board selector offers four of them, and each ships the
  columns and routes it needs in the board's own properties — "Developer Tasks"
  for code, and «Домашние дела», «Покупки и меню» and «Дом и техника» for the
  ordinary life the same machinery turns out to fit: an agent that prepares a
  plan, a checklist or a shopping list in a project of household notes, and a
  route that closes the card once the branch it wrote is merged. Every other
  upstream template is hidden, because a board the automation knows nothing
  about arrives empty — the server module's own templates are the upstream's
  examples and stay hidden. Ours live **here**, in
  `internal/boardadapter/templates/`, one `.jsonl` per board, embedded with
  `go:embed` and installed into the global team on launch by `ImportTemplates`.
  A board is recognised on the next launch by the `xciiiTemplate` property
  carrying its file's slug (ids are regenerated on import, titles are the
  user's), and `TemplateVersion` in `internal/boardadapter/templates.go` is what
  replaces an installed copy with an edited one. Authoring is not by hand:
  build the board in the app, *Export board archive*, unzip, keep the
  `board.jsonl`.
- **First run**: a board made from a template opens a setup wizard by itself
  when the registries are still empty — a project and an agent are asked for
  (nothing runs without them), Dokku and a browser MCP server are offered and
  skippable. **Which steps it has is the board's own answer.** A template
  declares them in `acpSetup`, beside the columns and routes it carries, and may
  add a sentence of its own to a step ("the folder with your household notes")
  or insist on one the app calls optional. It may only name steps from the
  closed set `internal/acp/setup.go` implements — like the flow triggers, the
  list is the app's, so a board cannot ask for something nothing can fill.
  **A project does not have to be a git repository.** What git buys — a
  worktree per session, a branch to publish, every transition that waits for one
  — is offered to the projects that have it and simply absent from the ones that
  do not, so a board of household chores sends an agent into a folder of notes
  and nobody is told to `git init` their shopping list. Which boards do need it
  is worked out, not declared: a step of the plan carries what its answer must
  satisfy (`requires: ["git"]`), and the project step asks for git exactly when
  the board publishes a branch or waits for one — a deploy or test stage, or an
  edge whose trigger the VCS watcher polls. `CheckBoardSetupAnswer` enforces it
  where the question is asked, rather than on a card three steps later.
  `BoardSetupPlan` resolves the whole answer in Go: what the board asked for (or,
  failing that, what its automation implies), minus what this machine has
  already answered, plus what was deliberately skipped, which is recorded per
  board in the `board_setup` table because no registry can be read for it later.
  The page renders that plan and works nothing out for itself; the board menu
  reads the same one, which is why *Deploy targets…* is absent from a board that
  never deploys. The wizard can be reopened from the board menu (*Set up this
  board…*), and having been offered it once is remembered for that board.
- **Columns** (column menu → *Agents in this column…*) say what happens when a
  card lands in one: the action, the crew of agents who work it, and how many of
  them at once. A card without an agent of its own goes to whoever of the crew is
  free; when they are all busy, or the limit is reached, the card waits in place
  and starts by itself as soon as a place frees up. The old
  `triggerColumn`/`deployColumn`/`testColumn` keys are migrated into this
  registry on first load, so nothing changes until you edit it. A crew of several
  agents needs `worktreeMode: "always"` (the default) — without worktrees two
  agents cannot share one project, and the crew works one card at a time.
- **Taking a card yourself**: assign it to yourself and no agent starts on it —
  the card keeps its place on the route and waits for you to move it on. Deploy
  and test still run, since that is machine work; assigning a registered agent,
  or nobody, hands the card back to automation.
- **Flows** (board "…" menu → *Workflows*) join those columns into a route and
  move cards along it. Repository events are polled from the branches parked
  cards wait on: plain git needs nothing, while `pr.*`, `review.approved` and
  `checks.*` call the GitHub API and want a token in `githubToken` (or
  `GITHUB_TOKEN`) — public repositories work without one, more slowly. The
  interval is `vcsPollSeconds` (default 60) and the remote is `gitRemote`
  (default `origin`). Which branch is watched: the card's `branch` property if
  it has one, otherwise the branch the card's own sessions worked on — with
  worktrees that is the agent's branch, which the card never names itself. A fresh config is seeded with three routes — `Feature`,
  `Hotfix` and `Review only` — and the "Developer Tasks" board template ships
  the columns they name plus a `Workflow` property to pick one with, so a new
  board runs them without any setup. Picking a route stays optional: a card with
  no `Workflow` option takes none, and the trigger columns work as they always
  did. The editor draws the route as a graph and offers whichever shipped route
  the registry is missing. A card shows its own route: which stage it stands on
  and what that stage is waiting for. Routes belong to the board they were made
  on, and a board made from the "Developer Tasks" template arrives with them:
  the template carries its columns and routes in the board's own properties, and
  the first card moved on it takes them into the registry. The Workflows dialog
  is both the map and the builder: it draws each route with the number of cards
  standing on every stage, and editing one turns the same canvas into the place
  the graph is drawn — stages are dragged, and pulling from a stage's right edge
  joins it to another.

## Develop

From this repository:

```
wails3 dev
```

`build/config.yml` declares the dev loop: Go edits rebuild and restart the app,
and `cd webapp && npm run watchdev` runs alongside it, keeping
`webapp/pack` current with `vite build --watch`. Needs webapp deps — run
`npm ci` in `webapp/` once if `webapp/node_modules` is missing. The watcher's
own directory is excluded from the Go watch list, so a TS edit rebuilds the
bundle without restarting the app.

A dev build leaves the `frontend` tag out, so nothing is embedded and the Go
side serves the on-disk bundle (`diskWebPath` finds `webapp/pack`).
The page still goes through the front door and `proxy.go` exactly as in a
release build, which is why nothing here needs to know the board server's port
or the session token — both stay random per launch.

There is deliberately no Vite dev server in the loop: pointing the webview at
it would buy HMR but would mean re-implementing the bootstrap script in
`vite.config.ts`, and the page would no longer be the page a release build
serves.

To run it manually instead:

```
wails3 dev
```

The server build is the fastest way to look at the UI in a real browser with
devtools:

```
wails3 task build:server && XCIII_SERVER_PORT=8099 bin/XCIII-server
```

For pure webapp/CSS iteration the browser loop is still faster than the webview:
run the server build above, then `cd webapp && npm run dev` for HMR at
http://localhost:5173.

## Build release installers

From the repo root, per platform. The build produces `webapp/pack` itself and
embeds it, so the artifacts are single-binary:

```
wails3 task package            # macOS   → bin/XCIII.app
wails3 task darwin:package:dmg # macOS   → bin/XCIII.dmg
wails3 task windows:package    # Windows → bin/XCIII.exe + NSIS installer
wails3 task linux:package      # Linux   → AppImage + .deb (+ .rpm)
wails3 task build:server       # any     → bin/XCIII-server (headless)
```

`wails3 task build` / `linux-app-wails3` build just the `.app` / bare binary.
Installer configs live in `build/` (`darwin/`, `windows/nsis/`,
`linux/appimage/` + `linux/nfpm/`), all generated by `wails3 update
build-assets` from `build/config.yml` — edit the config, not the assets.

The server binary has no window: it publishes the board at
`XCIII_SERVER_HOST`/`XCIII_SERVER_PORT` (default `localhost:8080`) and
is opened in a browser. Keep it on localhost unless something in front of it
authenticates: the bound methods start agents and read the filesystem, and the
runtime endpoint has no credential of its own — the front door's cross-origin
check stops a web page from calling it, not a user on that network.

## Sign & notarize macOS (single pass — one binary)

v3 has its own signing path, which reads the identity and the keychain profile
`wails3 setup` stored, so nothing has to be repeated on the command line:

```
wails3 setup                      # once: signing identity + notarytool profile
wails3 task darwin:sign:notarize
```

`wails3 entitlements` writes `build/darwin/entitlements.plist` when the app
needs one (the v2 build carried a hand-written file; v3 generates it). Signing
by hand still works and is one pass, since the app is one binary:

```
codesign --deep --force --options runtime \
  --sign "Developer ID Application: <TEAM>" \
  bin/XCIII.app

xcrun notarytool submit bin/XCIII.app \
  --apple-id <id> --team-id <team> --password <app-specific-pw> --wait

xcrun stapler staple bin/XCIII.app
```

## Out of scope (MVP)

Not yet implemented: the `nativeApp` bridge for persisting user settings, the
What's New dialog, multi-window, in-app downloads / file picker, and
window-position autosave.

## Documentation

- [docs/flows.md](docs/flows.md) — how a card gets worked on, for somebody using the
  board rather than working on it.
- [docs/plan.md](docs/plan.md) — what is done, what is left, and the open decisions
  this repository starts with.
- [docs/desktop-port-and-websocket.md](docs/desktop-port-and-websocket.md) — why the
  app serves itself over a local HTTP port, and why that is now on purpose.
- [docs/solidjs-migration-plan.md](docs/solidjs-migration-plan.md) — an unfinished
  plan for the frontend this app serves. It belongs to nobody yet.
- [docs/spec-acp.md](docs/spec-acp.md) — the original specification the agent
  integration was written from. Kept for the reasoning; the implementation has
  moved past parts of it.
