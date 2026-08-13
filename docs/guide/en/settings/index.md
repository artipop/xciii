# Settings

App settings live in one window: at the bottom of the left-hand list, under
"+ Add board", the **"Settings"** button with a cog. They apply to all boards.
Sections:

- **"The app itself"** — theme, language, help and feedback;
- **"Agents"** — this machine's agents and what launches them, see
  [Agents, npx and Node.js](./agents.md);
- **"Proxy configurations"** — named network settings that agents refer to;
- **"Access from a phone"** — see below;
- **"Import and export"** — board archive export and import, see
  [Moving](../transfer.md);
- **"Other"** — the instruction for conversations without a card, "Notify me
  when an agent is waiting", and install details.

Sections this build does not support are not shown: on a machine without
agents, "The app itself", "Import and export" and "Other" remain.

## The app itself: theme, language, help

- **Theme** — "Light theme", "Dark theme", "System theme". Applies
  immediately.
- **Language** — the list of app languages. When none was ever picked, the
  system language applies.
- **Help** — "The guide and the source", with an "Open" button. Below it —
  "Give feedback": a link to the issue tracker.

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

## What is not here

Settings of a specific board — columns, routes, project folders, agent
instructions — are set on the board itself, in the
["How this board works"](../automation/index.md) window.

**"Where to deploy"** is there too: deploy targets are only shown on a board
that has a deploy column, because no other board has any use for them.
