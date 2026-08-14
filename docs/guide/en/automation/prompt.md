# The board's system prompt

The board menu (⋯ in the header) → **"The board's system prompt…"**. This is
what an agent is told before anything else: before the card's task, before the
deploy or test instructions, before the question you type in a terminal.

It is added to:

- a session a column starts (agent, deploy, test);
- a conversation opened by "Talk it over with an agent".

## Two fields

**"To every agent of this board"** — about the board itself: what it is and how
work is done on it. "Answer in Russian", "these are household chores, not code",
"the stack is Go and SolidJS, tests are required".

**"To one agent, on this board"** — about one agent here: "клаус writes tests
for every change", "кодекс only reviews and never edits code". Unfold the
agent's name and write the text; the ones that have any are marked "set".

Both may be left empty — the board still works, the agent simply gets the card's
task and nothing else.

## The order

The agent is given three texts in a row, widest first:

1. the board's prompt — to everybody working here;
2. the agent's own prompt — "Settings → Agents", which holds on **every** board;
3. this board's prompt for this agent.

The last one is last on purpose: it answers the narrowest question, so when the
texts disagree it is the one still in front of the model.

## Where each of them lives

The board's prompt lives **on the board**, with its columns and routes: it
travels with the board into an archive export and onto another machine. The
agent's own prompt lives in the machine's registry — it is about the agent
rather than about the board, and it does not travel.

If a board arrives with a text for an agent this machine has not got, the name
is still listed: the text came with the board, and the app will not drop it
silently.
