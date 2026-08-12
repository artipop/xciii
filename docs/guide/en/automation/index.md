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

Three parts, left to right.

**The palette** — blocks: "Agent", "Deploy", "Test", "Column". Drag a block
onto the canvas and a new column with that action appears on the board. There
is no separate "create a stage" step: a route stage is always a board column.

**The canvas** — the board as a diagram, each column a box. Tabs on top:
**"Columns"** — all columns and their actions; a route tab — the same boxes
with that route's arrows (columns outside the route are faded and join it on
click); **"+ route"** — a new route.

**The panel** — on the right, shows what is selected: a column, an arrow or the
route.

## Column settings

Select a column — in the panel:

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
stage panel, under "Only on this route…".

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

## What else is in this window

- **"Projects"** — folders on your machine where this board's agents work; a
  card picks its folder with the "Projects" field;
- **"Where to deploy"** — deploy targets: the Dokku host, the SSH user and
  key, the preview domain. The section only appears on a board that has a
  deploy column — a board that deploys nothing has no use for it. The targets
  themselves are shared by the whole machine: one added here is visible to any
  other deploying board;
- **"What every agent on this board is told first"** — the board's instruction,
  added before the card description.

## Saving

- changes to the board itself — a new column from the palette, a rename — apply
  immediately;
- column actions and routes are written with the **"Save"** button. Everything
  is checked before writing: a transition to nowhere, two stages on one column,
  an empty condition or an unknown agent is rejected with an explanation.

"Close" without saving discards unsaved changes (except changes to the board
itself — those already applied).

## Templates

All of the above can also be edited in a template: the pencil on your template
in the template list, or the board menu → "Save as a template…". The one
difference: under the canvas a template lists the **questions** the setup
wizard will ask when a board is created from it — project folder, agent, deploy
target, browser for tests. Until set explicitly, the questions are derived from
the automation.
