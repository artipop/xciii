# The agent on a card

This page covers how an agent works a card: who takes it, where the terminal
is, how to answer questions and what stays on the card.

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

**The list holds this board's agents.** The registry is one per machine, and a
board names its own in "Worked by" on its columns and stages; those are the ones
the assignment field offers. A board that names nobody offers every agent on the
machine — the same as before it was set up. People are untouched: the field
offers them always.

Who works this board's cards is asked by the setup wizard
([⋯ → "Walk the setup again…"](./automation/index.md)) on its "Agent" step: the
names are chips, clicking one turns it on and off, and several or none may be
chosen. The answer can be changed later in "Columns and routes…", the column's
"Worked by" field.

With exactly one agent registered, that agent takes the card and nothing has to
be assigned. With several, a card whose column has no crew and which is
assigned to nobody stops: the app cannot pick for you.

The agent reads its task from the **card description** — there is no separate
task field. The board's instruction, shared by all its agents, is added in
front of the description; it is set in
["Columns and routes"](./automation/index.md).

## The terminal: the column's conversation

Open a card: in the top right corner of the dialog, next to "Attach", there is
a "Terminal" button. It opens a panel on the right, and the terminal in it
starts by itself.

**A card has one conversation per column it has stood in.** The conversation
belongs to the column: wording and plans are talked over in «Не начата», the
work happens in «В работе», the review in «Ревью». The panel opens the
conversation of the column the card stands in now, and a person and the route's
agent in one column talk in **one** conversation — with that column's agent, in
its working folder, with its instructions (see
["Columns and routes"](./automation/index.md)).

It asks for nothing: a card with no column, no folder and nobody assigned can
be talked over at once — with no folder the conversation happens in the board's
drafts. A column that runs an agent works in the card's own working copy; every
other column's conversation stands beside the work and creates nothing.

**The conversation opens with what the card says**: the agent is handed its
title and description as the first message (and the column's instructions,
when there are any), and waits for your question. It is not handed them twice —
a conversation being continued already knows them.

It is kept. Close the panel, close the app, move the card away and back — the
column's conversation continues where it stopped. **A returning card brings the
new input with it**: sent back from «Ревью», the resumed conversation is told
why it is back and what the reviewer said — not the task again.

- if this column's terminal is already running, the same one opens, with its
  history;
- if there turned out to be nothing to continue — the terminal was opened last
  time and nothing was typed in it, so the CLI saved no conversation — the
  terminal says «Продолжить прошлый разговор не удалось — открыт новый» and
  starts a new conversation in the same folder;
- `✕` in the header closes the panel. The terminal keeps running until the CLI
  in it exits, and opens in the same place next time.

The panel shows the CLI's own interface: the agent displays its progress and
asks its questions right there.

### The list of conversations

The panel reads top to bottom: a **"Terminals"** plate with a ✕ that closes the
panel itself; under it the card's conversations; and below that the conversation
being read, with a head of its own. That head's ✕ puts the terminal away without
ending it: the CLI keeps running, the row keeps its green dot.

Conversations are of two kinds, and a glyph on the row says which:

- **«Обсуждение»** (a speech glyph) — the card itself: the wording, the plan,
  the brief. It is always first, it asks nothing of the card — no folder, no
  route, nobody assigned — and no route ever runs in it. It opens where it
  started: a discussion held in the board's drafts stays there even after the
  card gains a folder;
- **work** (a console glyph) — one conversation per column the card has worked
  in, the current one first. This is where you sit down to watch an agent, and
  where a stage of the route arrives.

A row is built the same way as in "Talk it over with an agent":

- **the name** — clicking it opens the conversation in the panel; the dot on
  the left is green while a CLI is running in it. Until somebody names it, a
  conversation is called after its column; a conversation of a card that had no
  column is "No column";
- **the line under the name** — what the conversation is doing: the agent
  writes it;
- **who and where** — the agent and the conversation's folder;
- **⧉** — open the same terminal in a separate window (the head of the open
  conversation offers the same). The panel then gives way to the window: two
  views of one terminal argue about its size;
- **✎** — rename the conversation;
- **✨** — ask the agent to name it. The request is typed into the conversation
  itself, because only the one having it can name it; the answer appears in the
  row. The button is there while the CLI is running and was given the board's
  tools;
- **the bin** — delete the conversation. It asks first: the CLI ends and the
  record of the conversation goes with it, so the column's next conversation
  starts on a blank screen. Every row has it except the conversation a route is
  running right now — that one cannot be deleted, the route is waiting on it.

A click opens «Обсуждение», the current column's conversation, and any one with
a CLI running in it. A past column's conversation cannot be opened — it
continues when the card comes back to that column.

The terminal button in the corner of the card on the board also leads to a
running one: it turns amber when the agent is waiting, and it opens that
terminal.

There is no "Terminal" button if no agent is registered on the machine. The
exception is a card that was already worked: it has a branch of its own, so
the button stays even after the agent is removed.

**If no folder resolves, the panel asks.** A card can be talked over without
code: wording, subtasks, a brief. When neither the «Папка» field nor the
registry names a folder, the question "Which folder will the agent work in?"
appears, and the answers are chips:

- **the board's folders** by name: the one you pick becomes the conversation's
  working folder;
- **"The board’s drafts"** — the board's own folder in the app's data: its
  agents keep what they write for its cards there — briefs, drafts, notes.
  There is no code in it, and it is one per board: what was written for one
  card is on hand when another is talked over;
- **"Add a folder…"** — the usual folder pick; it joins the board's projects
  and the conversation starts in it.

With more than one agent, the questions come one at a time and in order:
first "Choosing an agent" — the names are the answers — then the folder; the
chosen name stays above the question and is the way back. The choice lasts
one conversation and does not change the card's assignment; a started
conversation continues in the same place with the same agent. A folder the
card names but which is missing on disk is still an error.

The agent in such a conversation has the board's tools: it can fill the card
in, split it into subtasks, set fields.

## Talking it over before there is a card

A task can be talked through before it becomes a card: the arrow next to the
"New" button in the board header → **"Talk it over with an agent…"**.

At the top of the dialog: **"Open terminals"**. A conversation outlives its
window, and with no card behind it this is the only place to find it again.
Each row is one conversation:

- **the name** — clicking it opens the conversation; the ⧉ icon on the right
  does the same;
- **the line under the name** — what the conversation is doing: the agent
  writes it once it knows, and updates it when it moves on to something else;
- **who and where** — the agent and the conversation's folder;
- **✎** — rename: a conversation starts out named after its card, or called
  «Планирование», and what a list needs is what the conversation is about;
- **✨** — ask the agent to name it. The request is typed into the conversation
  itself, and the agent writes the name in the language the two of you are
  speaking;
- **✕** — end it: asks "End this terminal?", because this stops the CLI. It is also the
  only way to take a conversation off the list — the list is exactly the
  terminals that are running.

Below: **"A new conversation"** — the same stepped pick as the card's
terminal. "Choosing an agent" — the agents' names are the answers — then
"Which folder will the agent work in?" — the board's folders, "The board’s
drafts" or "Add a folder…". Answering the second question is what opens the
terminal in a window.

The agent changes nothing in the project — the instructions forbid it — and
the cards you agree on it creates right on this board.

## The terminal button on a card

You do not need to open a card to reach its terminal. A terminal-icon button
appears in the bottom right corner of a card on the board:

- **amber, blinking** — the agent is asking something;
- **grey** — a terminal is currently working on the card;
- **amber pause** — the work was cut off: the terminal was closed, or the app
  was, and the stage never reported a result.

Clicking it opens the terminal in a separate window. There is no button when
nothing is running and there are no questions.

The pause means the card is still on its step, waiting to be picked back up.
Hover the button and it says what happened. Clicking it continues the same
conversation from where it stopped, and the pause goes as soon as something
happens on the card again.

## Questions from the agent

The agent asks in the terminal — in its own interface, the same way it asks you
in an ordinary console: a choice of options, permission for a command, a
question about the task. That is where you answer.

The app only tells you about it. When the CLI stops drawing anything, the
terminal button on the card turns amber, a notification arrives, an amber dot
appears on the app's icon next to the clock, and the card appears in "Waiting"
on the phone. They all offer the same button — "Open the terminal".

If the app is minimised, the notification comes from the system. It names the
agent and the card, and clicking it opens the right terminal.

## Permissions can be granted without opening the terminal

There is one kind of question you can answer on the spot: when the agent asks
for permission — to run a command, write a file, reach the network. That
question arrives whole, in the notification and in "Waiting": which tool, and
what exactly it is about to do, with two buttons under it — "Allow" and "Deny".

The answer reaches the agent immediately; no terminal needed. On a phone this is
the main way to work: a permission is one tap.

The question does **not** leave the terminal either. The agent draws its own box
on screen at the same moment, so it can be answered there as well, and whichever
happened first is the one that counts.

An answer given in the terminal is seen: the CLI starts drawing again, and a
couple of seconds later the question leaves the card, the notification, the
system's notification and the icon next to the clock. Opening the terminal to
read the question is not an answer — the app tells the two apart. If you did
manage to press a button in the notification after answering in the terminal,
the app says "The agent is no longer waiting for this answer" — not an error,
the answer simply already arrived.

This works for Claude agents. Every other question — a plan, a clarification, a
choice between options — still lives in the terminal and is answered there.

A notification is shown once. The "Dismiss" cross and the "Open the terminal"
button put it away in the same way: both mean you know about this question. A
notification you have put away does not come back in another window, on the
phone, or after a page reload — not until the agent does something and stops
again. That is a new question, and it is announced afresh.

Notifications can be turned off in the
[settings](./settings/index.md#agent-notifications). The terminal button on the
card and the dot on the icon next to the clock stay either way — the
notification is about the question, they are about the agent still waiting.

## When a stage ends

A stage of a route is a conversation in a terminal, and a terminal does not end
by itself: the CLI keeps running until it is closed. So the agent is the one
that declares the work over — through the board tool `finish_work`, which the
app hands it along with the rest. It says whether the work is done or could not
be done, and briefly what was done.

After that the card travels on along the route and the conversation is closed.
What exactly was done is in the agent's closing words in the terminal — the
conditions on the route's arrows read the same words.

If you close the terminal yourself before the agent has said this, the card
stays where it is: the route strip shows an amber line saying the result was
never reported. Open the terminal again and see the stage through.

That is how agent stages work. Deploys and tests are arranged differently —
there is no terminal there, the app talks to the agent directly and reads the
result itself.

## What is shown on the card

The branch and the directory are in the line under the card title; where the
card stands on its route and what it waits for — in the route strip; the
conversation with the agent — in the terminal panel beside the card.

There are no comments on cards at the moment: the app is built for one person,
and everything that used to be written into a comment is either shown on the
card itself or said by the agent in the terminal.

If a stage could not start — no project found, the column is busy, the route
has no transition — the reason is shown in amber on the route strip and
disappears once the card moves on. For a card outside a route the same reason
is shown by the terminal panel, together with the choice that fixes it.
