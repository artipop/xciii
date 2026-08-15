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
Notifications are shown in the board's window; a terminal window has none — the
agent's question is right there on it.

When the app is minimised or behind another window, the notification comes from
the system instead: it names the agent that is asking and the card it is about.
Clicking it opens that agent's terminal — the same thing the "Open the terminal"
button does, and it counts the same way as knowing about the question.

When off, the switch removes only the notifications. The amber terminal button
on the card stays, and so does the dot on the app's icon next to the clock: they
say an agent is waiting, and they interrupt nobody.

On macOS the system asks for notification permission once — the first time an
agent is actually waiting. Without it you keep the notifications in the board's
window and the icon next to the clock.

## The icon next to the clock

The app keeps an icon in the menu bar (the system tray on Windows and Linux). An
amber dot appears on it while at least one agent is waiting for a person.

Clicking it opens a menu:

- **"Открыть"** — bring the board's window back, even from minimised or closed.
- The waiting agents, one per line: the agent's name and the card. Clicking one
  opens that agent's terminal.
- **"Выход"** — close the application entirely.

The icon cannot be turned off: it interrupts nobody, and it is there for exactly
the time when nobody is looking at the board.

## Closing the window is not quitting

The board's window can be closed: the application keeps running, and so do the
agents. A stage of a route sees its work through, sources bring cards in,
notifications arrive. What stays is the icon next to the clock — it says the
application is running, and it brings the window back.

The same window comes back with the same board, not a page loaded from scratch.
On macOS the Dock icon does the same thing.

To quit for real, use **"Выход"** in the icon's menu (or ⌘Q while the window is
open). Quitting closes every agent terminal: if a stage never reported a result,
its card stays on its step with the amber pause on its terminal button.

## The agent's instructions

The "Other" section holds the text an agent is given in a conversation with no
card. Like the rest of the application's instructions it is written in English:
the app is used in more than one language, and this text is read by a model.
Yours can be in any language — like the board's system prompt and the cards
themselves it is passed through as it is, and the agent answers in the language
of what it was given.

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
| `worktreeMode` | what to do in a repository on a board that was never asked: `always` — a copy of its own per card, `never` — a branch in the folder itself. The folder's own answer on this board (board menu → "Folders…") wins — see [Folders and branches](../folders.md) |
| `artifactsDir` | where screenshots and reports of test runs are kept |

Columns and routes are not in this file: the automation lives on the board
itself and travels with it into an export and into a template.

## What is not here

Settings of a specific board — columns, routes, project folders, agent
instructions — are set on the board itself, in the
["Columns and routes"](../automation/index.md) window.

**"Where to deploy"** is there too: deploy targets are only shown on a board
that has a deploy column, because no other board has any use for them.
