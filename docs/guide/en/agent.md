# The agent on a card

This page covers how an agent works a card: who takes it, where the terminal
is, how to answer questions and what ends up in comments.

## Who gets a card

A card is worked by whoever it is assigned to. The assignment field is an
ordinary board field of the "person" type; templates name it differently:
«Исполнитель» on the developer board, «Кто делает» on chores, «Кто идёт» on
shopping.

You do not have to fill it in by hand. If a route stage has its own agent (in
the editor — "Worked by" on the column or "Worked here by" on the route stage),
the app sets the field itself when the card enters the stage. The field always
shows who is working the card now. A card assigned to a person is left alone.

To make an agent appear in the assignment list, register it in the settings —
the [Agents](./settings/agents.md) section. After registration it becomes a
board member under its own name: open the field and pick it.

The agent reads its task from the **card description** — there is no separate
task field. The board's instruction, shared by all its agents, is added in
front of the description; it is set in
["How this board works"](./automation/index.md).

## The terminal

Open a card: in the top right corner of the dialog, next to "Attach", there is
a "Terminal" button. It opens a panel on the right, and the terminal in it
starts by itself.

- if a terminal for this card is already running, the same one opens, with its
  history;
- if the card was worked before, the agent returns to the same worktree and
  continues the conversation (`--continue`);
- the open-in-new-window button in the panel header opens the same terminal
  in a separate window; it appears once the terminal is running;
- `✕` closes the panel. The terminal keeps running until the CLI in it exits,
  and opens in the same place next time.

The panel shows the CLI's own interface: the agent displays its progress and
asks its questions right there.

A card on a route can have several conversations — one per stage, because
different stages can be worked by different agents. The panel shows its stage
in the header ("Terminal · In progress") and the other conversations as chips
beside it. The conversation of the current stage is the one that opens. If the
card returns to a passed stage, that stage's conversation becomes current again
and continues where it stopped; a running terminal of a passed stage stays
reachable until its CLI exits. A conversation started before the route is
continued by the first stage.

There is no "Terminal" button if no agent is registered on the machine. The
exception is a card that was already worked: it has a branch and a worktree, so
the button stays even after the agent is removed.

**If no folder resolves, the panel asks.** A card can be talked over without
code: wording, subtasks, a brief. When neither the «Проекты» field nor the
registry names a folder, the question "The agent needs a folder to work in"
appears with two answers:

- **"Use the board's folder"** — the board's own folder in the app's data:
  its agents keep what they write for its cards there — briefs, drafts,
  notes. There is no code in it, and it is one per board: what was written
  for one card is on hand when another is talked over;
- **"Choose a folder…"** — the usual folder pick; it joins the board's
  projects and the conversation starts in it.

With more than one agent, the questions come one at a time and in order:
first "Who talks here?" — the names are the answers — then the folder; the
chosen name stays above the question and is the way back. The choice lasts
one conversation and does not change the card's assignment; a started
conversation continues in the same place with the same agent. A folder the
card names but which is missing on disk is still an error.

The agent in such a conversation has the board's tools: it can fill the card
in, split it into subtasks, set fields.

## The terminal button on a card

You do not need to open a card to reach its terminal. A terminal-icon button
appears in the top right corner of a card on the board:

- **amber, blinking** — the agent is asking something;
- **grey** — a terminal is currently working on the card.

Clicking it opens the terminal in a separate window. There is no button when
nothing is running and there are no questions.

## Questions from the agent

When the agent needs an answer, the question arrives as a notification with
answer options, and appears in "Waiting" on the phone. You can answer in either
place, or in the terminal window — the question is shown above the screen with
its options.

Notifications can be turned off in the
[settings](./settings/index.md#agent-notifications); the dot on the card stays
either way.

## Comments

A session leaves one comment on the card, at the end: what the agent did or why
it could not. The branch and the worktree are shown in the line under the card
title, the position on the route — in the route strip. When you exit the
terminal, it adds its report: which commits appeared and what was left
uncommitted.

If a stage could not start — no project found, the column is busy, the route
has no transition — the reason is shown in amber on the route strip and
disappears once the card moves on. For a card outside a route the same reason
is shown by the terminal panel, together with the choice that fixes it.
