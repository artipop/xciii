# Columns and routes

The board's behaviour is configured in the **"How this board works"** window:
what each column does and where a card moves next. Two ways to open it:

- the board menu (⋯ in the header) → **"How this board works"**;
- any column's menu → **"What happens in this column…"** — the same window with
  that column already selected.

There are no scripts or formulas: everything is assembled from ready-made
actions.

## Basic terms

- **A column** — where a card stands. A column has an action: nothing, an
  agent, a deploy, a test. The action applies regardless of the route.
- **A route** — arrows between columns: where a card moves after a step passes
  or fails. There can be several routes; a card picks its own.
- **A stage** — a column within one route. Exceptions are configured here: "on
  this route this column behaves differently".

Configure in this order: column actions first, then arrows — an arrow fires on
the outcome of an action, so while a column does nothing, the arrow has nothing
to fire on.

## The editor window

Tabs on top: **"Columns"** — all the board's columns and their actions; a route
tab — the same boxes with that route's arrows (columns outside the route are
faded and join it on click); **"+ route"** — a new route.

**"Add a column"** — the row under the tabs: "Agent", "Deploy", "Test",
"Column". Click a kind and a new column with that action appears on the board;
drag the block onto the canvas instead if where it stands matters. There is no
separate "create a stage" step: a route stage is always a board column.

**The canvas** — the board as a diagram, each column a box.

**The panel** — on the right, shows what is selected. What it asks about
depends on the tab: on "Columns" it is about the column (true on every route),
on a route tab about that stage of the route.

## Column settings

The **"Columns"** tab, select a column — in the panel:

- **name** — edited here; routes are tied to the column, not its name, so
  renaming breaks nothing;
- **"When a card lands here"** — the action: nothing, an agent works, the
  branch is deployed, the preview is tested;
- **"Worked by"** — which agents take this column's cards. If none is ticked,
  the card determines the agent;
- **"At once"** — how many cards the column runs at a time; the rest queue and
  start as slots free up;
- **deploy target** — on a deploy column.

These settings apply on every route. An exception for one route is set in the
stage panel — select the stage on the route's tab.

## Stage settings

A route tab, select a box — in the panel:

- **"What happens at this stage"** — the action on this route alone. While it
  reads "— as the column: … —" the column's action runs, and the line names it;
- **"Worked here by"** — this stage's agents. While none is ticked, the line
  under the boxes says who works it instead — the column's crew. This is how
  one route runs "In progress" with one agent and another with a different one;
- **"The stage works"** — on the card's own branch, or in the folder itself. It
  matters for a repository: checking before the branch is merged happens on the
  card's branch, checking what is already published happens in the folder;
- **deploy target** — on a deploy stage;
- **"From here the card goes"** — this stage's arrows;
- **"Settings of the column itself…"** — over to the "Columns" tab, to what is
  true of the column on any route.

## Arrows

An arrow is drawn by dragging from the edge of a box. The point you drag from
sets the event:

- **upper right point** — "when the step passed" (green);
- **lower right point** — "when the step failed" (red);
- **bottom point** — "wait for an event": branch merged, pull request merged,
  checks passed (grey, dashed).

Clicking an arrow opens it in the panel: the event, the destination, the
[condition](./rules.md). Delete or Backspace removes the selection.

## How a card gets onto a route

Click an empty spot on a route tab — the panel shows the route itself: name,
project (optional) and the list of columns.

A card joins a route by picking the option with the route's name — usually in
the "Route" field. If the board has no such option, the editor warns you and
offers a button to add it.

A card without a route is still served by the columns, but does not move on its
own.

## What is set elsewhere

The board's other questions are their own items in the board menu (⋯ in the
header), and which of them a board has depends on the template it was made
from:

- **"The board's system prompt…"** — what is said first to every agent of this
  board, and what is said to one of them in particular (see
  [The board's system prompt](./prompt.md));
- **"Folders…"** — folders on your machine where this board's agents work, and
  how one that is a repository is worked in (see [Folders and branches](../folders.md));
- **"Where to deploy…"** — deploy targets: the Dokku host, the SSH user and
  key, the preview domain. The item is only on a board that asks about
  deploying — of the shipped templates that is «Разработка». The targets
  themselves are shared by the whole machine: one added here is visible to any
  other deploying board;
- **"Walk the setup again…"** — the same questions the board asked when it was
  first opened.

## Saving

- changes to the board itself — a new column, a rename — apply
  immediately;
- column actions and routes are written with the **"Save"** button. Everything
  is checked before writing: a transition to nowhere, two stages on one column,
  an empty condition or an unknown agent is rejected with an explanation.

"Close" without saving discards unsaved changes (except changes to the board
itself — those already applied).

## Templates

A board that is set up the way you want it is the template: the board menu →
**"Save as a template…"**. The board is copied with its columns and routes, and
the **"Template"** window opens: the name, the icon, what it is for, and the
**questions** the setup wizard will ask when a board is created from it —
project folder, agent, deploy target, browser for tests. Until set explicitly,
the questions are derived from the automation.

Columns and routes are only listed in that window. They are changed on a board
("How this board works…") and reach the template when the board is saved as a
template again. The pencil on your own template in the template list opens the
same window.
