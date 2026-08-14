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
["Columns and routes"](./automation/index.md).

## The terminal: discussing a card

Open a card: in the top right corner of the dialog, next to "Attach", there is
a "Terminal" button. It opens a panel on the right, and the terminal in it
starts by itself.

This is the **card's own conversation** — where you think about it: the wording,
the plan, the brief, whether it is worth doing at all. It asks nothing of the
card: no folder, no route, nobody assigned — you can open it the moment the card
exists. With no folder the conversation happens in the board's drafts; if the
card has been worked, it happens in the card's own working copy, beside the work.
It creates no branch of its own.

It is kept. Close the panel, close the app — next time the same conversation
opens and continues where it stopped.

The conversations a route opens are separate (see below). They used to be one
and the same, and a stage starting would type the card's task straight into what
you were discussing.

- if a terminal for this card is already running, the same one opens, with its
  history;
- if the card was worked before, the agent returns to the same place and
  continues the conversation (`--continue`);
- if there turned out to be nothing to continue — the terminal was opened last
  time and nothing was typed in it, so the CLI saved no conversation — the
  terminal says «Продолжить прошлый разговор не удалось — открыт новый» and
  starts a new conversation in the same folder;
- the open-in-new-window button in the panel header opens the same terminal
  in a separate window; it appears once the terminal is running;
- `✕` closes the panel. The terminal keeps running until the CLI in it exits,
  and opens in the same place next time.

The panel shows the CLI's own interface: the agent displays its progress and
asks its questions right there.

## The route's conversations

When a card lands in a column that does something, the route opens a
conversation of **its own** — one per stage, because different stages can be
worked by different agents. The panel lists them as chips under the header: the
column and the agent. They are history — what the route did and where; they
cannot be opened from the panel.

The way to a running one is the terminal button in the corner of the card on the
board: it turns amber when the agent is waiting, and it opens that terminal. If
the card returns to a passed stage, that stage's conversation becomes current
again and continues where it stopped; a running terminal of a passed stage stays
reachable until its CLI exits.

There is no "Terminal" button if no agent is registered on the machine. The
exception is a card that was already worked: it has a branch of its own, so
the button stays even after the agent is removed.

**If no folder resolves, the panel asks.** A card can be talked over without
code: wording, subtasks, a brief. When neither the «Папки» field nor the
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
- **grey** — a terminal is currently working on the card.

Clicking it opens the terminal in a separate window. There is no button when
nothing is running and there are no questions.

## Questions from the agent

The agent asks in the terminal — in its own interface, the same way it asks you
in an ordinary console: a choice of options, permission for a command, a
question about the task. That is where you answer.

The app only tells you about it. When the CLI stops drawing anything, the
terminal button on the card turns amber, a notification arrives, and the card
appears in "Waiting" on the phone. All three offer the same button — "Open the
terminal".

Notifications can be turned off in the
[settings](./settings/index.md#agent-notifications); the terminal button on
the card stays amber either way.

## When a stage ends

A stage of a route is a conversation in a terminal, and a terminal does not end
by itself: the CLI keeps running until it is closed. So the agent is the one
that declares the work over — through the board tool `finish_work`, which the
app hands it along with the rest. It says whether the work is done or could not
be done, and briefly what was done.

After that the card travels on along the route, the conversation is closed, and
a comment with that summary appears on the card.

If you close the terminal yourself before the agent has said this, the card
stays where it is: the route strip shows an amber line saying the result was
never reported. Open the terminal again and see the stage through.

That is how agent stages work. Deploys and tests are arranged differently —
there is no terminal there, the app talks to the agent directly and reads the
result itself.

## Comments

A stage leaves one comment on the card, at the end: what the agent did or why it
could not, and under that the branch, the commits that appeared and anything
left uncommitted. The branch and the directory are also shown in the line under
the card title, the position on the route — in the route strip.

If a stage could not start — no project found, the column is busy, the route
has no transition — the reason is shown in amber on the route strip and
disappears once the card moves on. For a card outside a route the same reason
is shown by the terminal panel, together with the choice that fixes it.
