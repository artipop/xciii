# XCIII on a phone

One window onto the board, for iOS and Android.

The phone runs nothing. The board, its API, its sockets and the agent bindings
are all served by the front door on the desktop, and this app is a window onto
it — exactly what the desktop app's own window is, which is also pointed at the
front door rather than at a `wails://` origin. The page it opens is `/m`, the
board's phone view: what is waiting for a person, and the terminals it is
waiting in.

Getting there is Tailscale's job. The desktop publishes the front door on the
user's own tailnet (`tsnetdoor.go` in the parent module) and checks the caller's
tailnet identity; the phone has the Tailscale app and an address like
`board.tail1234.ts.net`. Nothing of ours is on the public internet, and nothing
of ours asks for a password.

## Why it is a module of its own

The mobile build compiles **package main from the module root** — `wails3 ios
overlay:gen` injects a `main_ios.gen.go` beside it that calls `main()`. The
desktop `main` is the board server with cgo SQLite, git and a pty; none of it
builds for iOS and none of it belongs on a phone. So the phone app is its own
module, with its own `go.mod`, outside the parent's `./...`.

What it carries is small enough to read in one sitting:

- `main.go` — the app and its one window.
- `board.go` — what somebody typed (`board`, `board.tail1234.ts.net`,
  `https://…`) becomes the address to load. Pure, and tested.
- `settings.go` — the service the setup page calls, and where the address is
  kept: the platform's own secure store, since a phone has no config file to
  hand-edit. A navigation that fails brings the setup page back, which is the
  only way back once the window is on the board — a different origin, and a
  phone has no address bar.
- `store_ios.go` / `store_android.go` / `store_desktop.go` — the one call that
  differs between the platforms (iOS takes a key and a value, Android takes
  JSON), plus a stub so the package builds and tests on the machine it is
  written on.
- `frontend/index.html` — the single page this app has of its own, asking where
  the board is. Plain HTML: pulling a framework onto a phone to ask one question
  would be absurd, and everything after it is the board's own page.

## Build & run

From this directory:

- `wails3 task ios:run` — simulator. Needs full Xcode **and an installed
  simulator runtime** (`xcrun simctl list runtimes` must not be empty).
- `wails3 task ios:package` — a signed `.app` bundle in `bin/`; add
  `IOS_PLATFORM=device CODESIGN_IDENTITY="Apple Development: …"` for a device,
  `ios:package:ipa` for an `.ipa`. `wails3 task ios:xcode` opens the generated
  Xcode project, which is the way to automatic signing and TestFlight.
- `wails3 task android:run` — emulator. Needs the Android SDK **and the NDK**
  (`ANDROID_NDK_HOME`, or one installed under `$ANDROID_HOME/ndk`).
  `android:package` builds the APK.
- `go test ./...` — the address rules and what the app opens with, on the
  machine you are writing on.

There is no npm project here: `build:frontend` is a no-op, and `go:embed
all:frontend` is the whole of the frontend build.

## Not done yet

- **Notifications.** `application.IOS.PostNotification` is there, and the event
  socket the board's page listens on would feed it, but nothing wires the two
  yet — and a phone that is asleep cannot be woken over a tailnet at all, so
  what is possible here is "while the app is alive", not push.
- **Android has not been run.** The Go code compiles for iOS and the bundle
  links; the Android half needs an NDK to say the same.
