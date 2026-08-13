# Settings

App settings live in one window: at the bottom of the left-hand list, under
"+ Add board", the **"Settings"** button with a cog. They apply to all boards.
Sections:

- **"The app itself"** — theme, language, help and feedback;
- **"Updates"** — the app's version and moving to a newer one, see
  [Updates](./updates.md);
- **"Agents"** — this machine's agents and what launches them, see
  [Agents, npx and Node.js](./agents.md);
- **"Proxy configurations"** — named network settings that agents refer to;
- **"Access from a phone"** — see below;
- **"Import and export"** — board archive export and import, see
  [Moving](../transfer.md);
- **"Other"** — the instruction for conversations without a card, "Notify me
  when an agent is waiting", and install details.

Sections this build does not support are not shown: on a machine without
agents, "The app itself", "Updates", "Import and export" and "Other" remain.

## The app itself: theme, language, help

- **Theme** — "Light theme", "Dark theme", "System theme". Applies
  immediately.
- **Language** — the list of app languages. When none was ever picked, the
  system language applies.
- **Help** — "The guide", with an "Open" button: it opens this guide. Below
  it — "Give feedback", with a "Write" button: it opens your mail program
  addressed to `hello@deffun.com`. The address is also printed next to the
  button, to copy if the mail program does not open.

All of this is available before the first board is created. The picked theme
and language are kept by the install itself: they survive a restart and apply
on the phone too, through
["Access from a phone"](#access-from-a-phone).

## Access from a phone

The app can join your Tailscale network and serve the board to your devices.
Nothing is published to the internet; access is off by default.

1. Set **"Name of this machine in the network"**.
2. Press **"Publish the board"** and log the machine in through the link the
   app shows.
3. An address appears next to it ("Open this on your phone") with a copy
   button.

The phone needs the Tailscale app under the same account; the address works
only inside your network. It serves the board and `/m` — the phone version with
the Inbox, Cards, Waiting and Terminals tabs.

## Agent notifications

The **"Notify me when an agent is waiting"** switch is in the "Other" section.
When off, it removes only the notifications; the amber terminal button on
the card stays.

## The settings file

Some agent settings are not in the window: they are changed rarely, and they
are edited by hand in a file. It sits in the install's own directory:

- macOS — `~/Library/Application Support/XCIII/acp/config.json`;
- Windows — `%AppData%\XCIII\acp\config.json`;
- Linux — `~/.config/XCIII/acp/config.json` (or `$XDG_CONFIG_HOME`).

Close the app before editing the file: it reads the file at startup.

| Key | What it sets |
|---|---|
| `maxConcurrent` | how many sessions run at once on this machine (3 by default) |
| `sessionTimeoutMinutes` | how long one turn of an agent may take (15) |
| `testTimeoutMinutes` | how long one test run may take (30) |
| `sessionIdleMinutes` | how long a session waits between turns (30) |
| `autoAllowTools` | which tools an agent may use without asking. A session started by a card has nobody to ask, so anything not on the list is refused for it |
| `worktreeMode` | what to do in a repository on a board that was never asked: `always` — a copy of its own per card, `never` — a branch in the folder itself. The board's own answer (board menu → "How this board works…" → Folders) wins — see [Folders and branches](../folders.md) |
| `artifactsDir` | where screenshots and reports of test runs are kept |

Columns and routes are not in this file: the automation lives on the board
itself and travels with it into an export and into a template.

## What is not here

Settings of a specific board — columns, routes, project folders, agent
instructions — are set on the board itself, in the
["How this board works"](../automation/index.md) window.

**"Where to deploy"** is there too: deploy targets are only shown on a board
that has a deploy column, because no other board has any use for them.
