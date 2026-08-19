# XCIII

A desktop board that runs coding agents from the board itself. Moving a card
into a column starts an agent on it; opening a terminal on a card puts you in that
agent's own CLI, where the card's work lives, with the branch and environment already
set up. One binary, built with [Wails v3](https://v3.wails.io), with the board
server running **in-process** — no spawned server process, no Node.js of our
own — and the same code builds a **headless server** (`-tags server`) that serves
the whole thing to a browser.

Everything a build needs is in this repository: `webapp/` is the frontend, its
own npm project built with Vite, and `server/` is the board server, a fork of
Mattermost's Focalboard with our own patches (`GetUserByUsername` and two
single-user endpoint fixes). It is one Go module — `server/` is a directory in
it, not a module of its own — so **`git clone` and `go build ./...` is the whole
of it**: no second checkout beside this one, no branch of somebody else's, and
nothing to `replace`.

The board server's packages are `github.com/artipop/xciii/server/…`. They kept
upstream's import path for a long time, on the grounds that a rename was a
tree-wide edit buying nothing but the name; the name turned out to be worth it,
and the edit was one pass over 209 files.

## How it works

The Go code is platform-agnostic — the same files build for every OS:

- `server.go` — starts the board server in-process in single-user mode on a
  free port. The SQLite database and uploaded files live under the OS user config
  dir (`os.UserConfigDir()` → `~/Library/Application Support/XCIII` on macOS,
  `%AppData%\XCIII` on Windows, `~/.config/XCIII` on Linux), **not** next
  to the binary, because a signed/packaged app dir is read-only.
- `datadir_production.go` / `datadir_dev.go` — which install that is.
  A packaged build (`-tags production`, which every one of them carries) uses
  `XCIII`; `wails3 dev` builds without the tag and uses `XCIII-dev`, including
  as the keychain service name. One product, two installs, so what is tried out
  in development is not in the app afterwards.
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
  own directory, drawn by xterm.js in a second window of the app and wired to the pty over
  a WebSocket on the front door. The session console this module used to carry — the
  transcript, the prompt box, the permission buttons — is gone with everything behind
  it, so a session is now one turn (a card's task, run and reported) and a tool
  outside the policy is refused rather than put to somebody who is not there.
  It is not an ACP session (an ACP agent speaks JSON-RPC on stdio and has no terminal
  UI) — it reuses everything around one: the folder, the card's directory and branch, the
  agent's environment and proxy. The card is told when it opens and what it left on
  the branch when the CLI exits, and the next terminal on that card returns to the
  same place with `claude --continue` / `codex resume --last`.
- `tsnetdoor.go` — **the board on your own tailnet**, which is how a phone
  reaches it. The app becomes a Tailscale node itself
  ([`tsnet`](https://tailscale.com/docs/features/tsnet): userspace, no daemon,
  no root, nothing to install) and serves the same front door there over TLS, so
  a phone webview gets a real certificate rather than an excuse. Who is calling
  is answered by `WhoIs`: the gate lets in the tailnet user this node was logged
  in as, and nobody else unless `allowedLogins` names them. It stands in front of
  the page too, because fetching the page is how a caller gets the board's
  session token.

  Off until `~/Library/Application Support/XCIII/tailnet/settings.json` says
  otherwise:

  ```json
  {"enabled": true, "hostname": "board"}
  ```

  First run has no credentials, so the login URL is opened in the browser;
  `authKey` in the same file skips that. The node's state lives beside the
  settings, so later launches come up by themselves.
- `app.go` — the bound service. Its exported methods are what the frontend
  calls; `OpenInBrowser` is the one the bootstrap script uses.
- `mode_desktop.go` / `mode_server.go` — everything that differs between a
  window and a server: the front door, the window, and the folder picker (a
  server build has no native dialog and says so, rather than returning an empty
  path the UI would read as a cancellation).
- `main.go` — wires it all together and runs the app.

**On a phone**, the board is the same board: `webapp/src/pages/mobile` is the
`/m` route — what is waiting for a person, answered in place, and the terminals
it is waiting in — and [`mobile/`](mobile/README.md) is a small Wails app for
iOS and Android that is one window onto it, over the tailnet door above. It is
its own Go module because the mobile build compiles `package main` from the
module root, and this one is a board server with cgo SQLite, git and a pty.

Builds are **native per platform** (each on its own machine/CI runner) — cgo
SQLite does not cross-compile with the host toolchain; `wails3 task
setup:docker` builds the image that can, if a Mac has to produce a Linux or
Windows binary. Nothing generates JS bindings: the webapp calls bound methods by
name through the bridge above, which is what v2's `-skipbindings` meant.

**[How a card gets worked on](docs/flows.md)** walks through the whole thing for
somebody using the board: what happens when a card lands in a column, when a
a branch appears and what becomes of it, which branch is followed, the routes
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
bundle also runs in a browser, where none of them exist. That guard is what keeps the desktop-only UI inert elsewhere, and it is
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
- **Browser-testing sessions** (the «QA» column) need a browser MCP server
  on the agent — under *Agents → MCP servers*, paste the same JSON any MCP
  client takes, e.g. `{"mcpServers": {"playwright": {"command": "npx", "args":
  ["-y", "@playwright/mcp@latest", "--headless"]}}}`. The app ships no
  browser driver of its own and stays Node-free; the server is the user's
  choice, and a test session refuses to start for an agent without one. Each run
  gets a directory under `artifactsDir` (default
  `<dataDir>/artifacts/<session-id>`) where the agent is asked to save its
  screenshots and write `result.json` — that verdict is what moves the card.
- **Templates**: the board selector offers three of them, and each ships the
  columns and routes it needs in the board's own properties — «Разработка»
  for code, «Контент» for writing, and «Домашние дела» for the ordinary life
  the same machinery turns out to fit: an agent that puts a plan, a list or a
  draft in a folder of notes, and a route that waits for a person to read it. Every other
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
- **Where a setting lives is decided by whose it is.** The registries are the
  machine's — which agents are installed, where they deploy, how they reach the
  network, whether the board is published on the tailnet — so they are one
  dialog opened from the sidebar's *«Настройки → Эта машина…»*, beside the theme
  and the language, and are reachable with no board open at all. What a board
  runs — its columns, its routes, the folders its agents work in, and what those
  agents are told first — is one screen, *«Как работает эта доска…»*. The board's
  ⋯ menu holds nothing else but export and *«Сохранить как шаблон…»*: it used to
  be the only door to all of the above, which made machine settings look like a
  property of whichever board happened to be open. A setting that belongs to one
  *screen* goes with it: what feeds a board is asked on «Входящие», whose ⋯ menu
  offers *«Источники…»* and nothing besides — with the board's own menu keeping
  that door only while the board has no inbox to open it from.
  Registering an agent or a folder does not require going there — the card's
  terminal and the column's crew list both offer the short form (a name and a
  kind) where the choice is being made, and the full form stays in the
  settings. **Folders are part of running an agent, not of having a board**: a
  board with no agent column is never asked for one and never grows a «Папки»
  field, and a folder marked "on every board" joins only boards that already
  have that field.
- **What a board tells its agents first is the board's** (`boardPrompts` in the
  config, keyed by board id, edited in *«Как работает эта доска…»*). It was one
  string shared by every board on the machine, labelled "board system prompt"
  while being nothing of the kind — which meant the household board and the code
  board shared it and so nobody could write anything useful in it. An install
  that had written something keeps it: on first load the old `systemPrompt` is
  spread over every board named by a column or a route, and the global field is
  blanked.
- **First run**: a board made from a template opens a setup wizard by itself
  when the registries are still empty — a folder and an agent are asked for
  (nothing runs without them), Dokku and a browser MCP server are offered and
  skippable. **Which steps it has is the board's own answer.** A template
  declares them in `xciiiSetup`, beside the columns and routes it carries, and may
  add a sentence of its own to a step ("the folder with your household notes")
  or insist on one the app calls optional. It may only name steps from the
  closed set `internal/acp/setup.go` implements — like the flow triggers, the
  list is the app's, so a board cannot ask for something nothing can fill.
  **A folder does not have to be a git repository.** What git buys — a branch
  per card, something to publish, every transition that waits for one — is
  offered to the folders that have it and simply absent from the ones that
  do not, so a board of household chores sends an agent into a folder of notes
  and nobody is told to `git init` their shopping list. Which boards do need it
  is worked out, not declared: a step of the plan carries what its answer must
  satisfy (`requires: ["git"]`), and the folder step asks for git exactly when
  the board publishes a branch or waits for one — a deploy or test stage, or an
  edge whose trigger the VCS watcher polls. `CheckBoardSetupAnswer` enforces it
  where the question is asked, rather than on a card three steps later.
  `BoardSetupPlan` resolves the whole answer in Go: what the board asked for, or
  failing that what its automation implies, and how far *this board* has got
  through it. **Setup is per board, not per machine.** Every step's status is
  read from the `board_setup` table, keyed by board — the registries are the
  machine's and say only that a step *can* be answered quickly (`ready`, shown
  as "already registered" with one click to pass it). Reading them as the answer
  is what made every board after the first appear fully set up and get created
  in silence. The page renders that plan and works nothing out for itself; the
  wizard walks exactly what the plan lists, which is why a board that never
  deploys is never asked where to. The wizard opens itself once per board —
  closing it half-way answers nothing, so the header goes on saying *«Доска ещё
  не настроена»* until every question that board asks has an answer, and that
  button is the way back in (*«Пройти настройку заново…»* in *«Как работает эта
  доска…»* afterwards).
  Having been offered it is remembered in the store, not in the page: the app
  publishes itself on a fresh port every launch, so `localStorage` is keyed by
  an origin that does not survive a restart — anything the page has to remember
  between runs has to be asked of Go.
- **Columns** (column menu → *«Что происходит в этой колонке…»*, or the board
  menu's *«Как работает эта доска…»*) say what happens when a
  card lands in one: the action, the crew of agents who work it, and how many of
  them at once. A card without an agent of its own goes to whoever of the crew is
  free; when they are all busy, or the limit is reached, the card waits in place
  and starts by itself as soon as a place frees up. The old
  `triggerColumn`/`deployColumn`/`testColumn` keys are migrated into this
  registry on first load, so nothing changes until you edit it. A crew of several
  agents needs the board's «в отдельной копии» (the default) — with one branch
  in the folder itself two agents cannot share it, and the crew works one card
  at a time.
- **Taking a card yourself**: assign it to yourself and no agent starts on it —
  the card keeps its place on the route and waits for you to move it on. Deploy
  and test still run, since that is machine work; assigning a registered agent,
  or nobody, hands the card back to automation.
- **Flows** (board "…" menu → *«Как работает эта доска…»*) join those columns into a route and
  move cards along it. Repository events are polled from the branches parked
  cards wait on: plain git needs nothing, while `pr.*`, `review.approved` and
  `checks.*` call the GitHub API and want a token: `GITHUB_TOKEN` in the
  environment, or the credential store under `github.token` — public
  repositories work without one, more slowly. The
  interval is `vcsPollSeconds` (default 60) and the remote is `gitRemote`
  (default `origin`). Which branch is watched: the card's `branch` property if
  it has one, otherwise the branch the card's own work is on, which the card
  never names itself. A fresh config is seeded with three routes — «Фича»,
  «Хотфикс» and «Только ревью» — and the «Разработка» board template ships
  the columns they name plus a «Сценарий» property to pick one with, so a new
  board runs them without any setup. Picking a route stays optional: a card with
  no «Сценарий» option takes none, and the trigger columns work as they always
  did. The editor draws the route as a graph and offers whichever shipped route
  the registry is missing. A card shows its own route: which stage it stands on
  and what that stage is waiting for. Routes belong to the board they were made
  on, and a board made from the «Разработка» template arrives with them:
  the template carries its columns and routes in the board's own properties, and
  the first card moved on it — or opening the editor — takes them into the
  registry.
- **One editor for both halves** (board menu → *«Как работает эта доска…»*).
  The canvas is the board: every column of the chosen select property is a box
  on it, and choosing a route draws that route's arrows over the same boxes,
  fading the columns it does not use — clicking one, or drawing an arrow to it,
  is what puts it on the route. There is no "add a stage, then pick its column".
  The panel beside the canvas is about whatever is selected: a column (what
  happens there, the crew, the limit, the deploy target — the whole of what used
  to be a dialog of its own) or a transition (which event, and where it leads).
  What a card names its route with is checked too: a route with no option of its
  name is one no card can ever take, and the editor says so and offers the click
  that adds it. A palette beside the canvas holds the blocks a route is built
  from — «Агент», «Деплой», «Тест», a plain column — and dropping one makes a
  real column of the board where it landed, already doing what the block says.
- **Rules on the arrows.** A transition can be conditional on the card — «по
  успеху → Деплой, но только если Приоритет = Высокий», with the unconditional
  arrow as the fallback — or on the words the agent signed off with («ГОТОВО К
  ДЕПЛОЮ»), which is how the agent itself routes the card. A stage can also wait
  for an option set on the card («Одобрено = Да») and move the moment a person
  marks it — pushed by the board, nothing polled. The conditions are drawn on
  the arrows, spelled out in the card's flow strip, and the set is closed: the
  board picks from what the engine implements, nothing is a script.
- **Templates** (*«Сохранить как шаблон…»* in the board menu, the pencil in the
  template picker, or *«Колонки, маршруты и настройка…»* on the banner of a
  template being edited). A template is a board that has not been made yet, and
  what makes it worth choosing is not on the board: the same editor writes its
  columns and routes into the template's own properties, and below it the
  template names the questions a new board should ask about this machine — the
  closed set of setup steps, each with a line of the template's own and a "cannot
  be skipped" flag. Saving a working board as a template reads its automation
  back out of the registry into the copy, so the template arrives with the
  columns *doing* something rather than merely drawn. Templates somebody made
  are offered beside the ones the install ships.

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
wails3 task build:server && SERVER_PORT=8099 bin/XCIII-server
```

For pure webapp/CSS iteration the browser loop is still faster than the webview:
run the server build above, then `cd webapp && npm run dev` for HMR at
http://localhost:5173.

## Cut a release

A release is a tag. `.github/workflows/release.yml` builds all four platforms
natively, signs the update manifest and publishes the lot:

```
wails3 task version:set VERSION=1.1.0   # every file that states a version
go test .                               # the guard: they all have to agree
git commit -am "Release 1.1.0"
git tag -a v1.1.0                       # the annotation is the release notes
git push && git push --tags
```

`docs/release.md` is the whole of it — the signing key, what is built where,
and how to dry-run the workflow without publishing anything.

## Build release installers by hand

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
`SERVER_HOST`/`SERVER_PORT` (default `localhost:8080`) and
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

- [docs/guide/](docs/guide/index.md) — руководство пользователя, по-русски:
  как этим пользоваться, а не как это устроено. Это же и сайт — VitePress,
  разделами и с поиском; как он собирается — [docs/guide-site.md](docs/guide-site.md).
- [docs/flows.md](docs/flows.md) — how a card gets worked on, for somebody using the
  board rather than working on it.
- [docs/templates.md](docs/templates.md) — what a template carries, how it is edited,
  and how a working board becomes one.
- [docs/build-and-platforms.md](docs/build-and-platforms.md) — what to run to get a
  binary on each of the three platforms, which build tags do what, and the traps
  already stepped in.
- [docs/verifying.md](docs/verifying.md) — how a change is actually checked here:
  which level proves what, driving the headless build and a browser, and the
  traps of the harness itself.
- [docs/release.md](docs/release.md) — cutting a release: the version, the signing
  key updates are verified against, what the workflow builds where, and how to
  run it without publishing.
- [docs/webapp.md](docs/webapp.md) — the page: the store that replaced Redux, what
  each React library was replaced by, and how its tests are written.
- [docs/local-and-shared-state.md](docs/local-and-shared-state.md) — which of the
  things this app stores belong to the machine and which to the board. A note to
  think about later: nothing in it bites while the app is one process.
- [docs/sources.md](docs/sources.md) — how an outside event (a mailbox, a Kaiten
  board, a notification from a phone) becomes a card, and the plugin protocol a
  source is written against in Go or TypeScript.
- [docs/deferred.md](docs/deferred.md) — work that was thought through and then put
  down on purpose, with the reasoning that put it down.
- [docs/spec-acp.md](docs/spec-acp.md) — the original specification the agent
  integration was written from. Kept for the reasoning; the implementation has
  moved past parts of it.
