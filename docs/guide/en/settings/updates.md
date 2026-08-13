# Updates

The app can replace itself with a newer version. The **"Updates"** section of
the settings window is the second one, right under "The app itself".

## What it shows

- **"Installed version X"** — the version running now.
- A status line: "Not checked yet", "This is the latest version", "Version Y is
  available", "Downloading…", "Checking the signature…", "Installing…",
  "Version Y is ready. It is installed on restart." or "The update failed".
- **"Last checked …"** — when the app last asked.

## Updating

1. Press **"Check for updates"** — or wait for the automatic check.
2. When a version is found, the release notes appear under it with **"Install"**
   and **"Skip this version"**. Nothing is downloaded until you press
   "Install".
3. "Install" downloads the release and checks its signature. The app stays
   usable while it downloads.
4. When **"Restart and update"** appears, press it: the app closes, replaces
   itself with the new version and opens again.

Nothing is replaced until you press "Restart and update".

## The automatic check

The **"Check for updates automatically"** switch at the bottom of the section.
It is on by default and checks every few hours. It only asks — downloading
always starts with your button.

When a new version is found, an amber dot appears next to "Settings" in the
left-hand list. Updates raise no notification: this is not something to
interrupt anybody over.

## "Skip this version"

The app stops offering that release, across restarts too. A line stays under
the switch — "Version Y is skipped…" — so that it does not read as a check that
stopped working. The next release is offered as usual.

## Signing

Every release is signed with a key whose public half is built into the app. The
app installs only what matches that key: a substituted file will not install,
even when it is served from the same address as the real one.

## What to know about each platform

- **macOS.** The app is currently only ad-hoc signed, without an Apple
  certificate. After an update, macOS may ask you to confirm launching it
  again — the same way it does on a first install. The update itself goes
  through.
- **Windows.** A per-user install updates itself — that is what the installer
  from our releases page sets up. An app moved into `Program Files` by hand
  cannot replace itself: that needs administrator rights.
- **Linux.** The unpacked `.tar.gz` in your home directory updates itself.
  `.deb` packages and AppImages installed into system directories are updated
  by their own tooling.
- **The headless server** (`XCIII-server`) does not update itself: its settings
  have no "Updates" section.

## Where this is kept

What you picked — whether the automatic check is on, which version is skipped,
when it last checked — lives in `updates.json` in the install directory:

- macOS — `~/Library/Application Support/XCIII/updates.json`;
- Windows — `%AppData%\XCIII\updates.json`;
- Linux — `~/.config/XCIII/updates.json`.
