# Build a route

[The previous page](./index.md) describes the editor window. This one shows how
to build a working route from scratch, step by step.

Example: an agent takes the card → a person reviews → the branch goes to a
preview → a browser test checks the preview → done. For a board without code it
is the same, just without the deploy.

## 1. Lay out the columns

The **"Columns"** tab. Drag the missing blocks from the palette: "Agent",
"Deploy", "Test", "Column". For the example: "In progress" (agent), "Review"
(nothing), "Deploy" (deploy), "QA" (test), "Done" (nothing).

Select "In progress" and in the panel on the right set "When a card lands
here" to "an agent works on the card", then "Worked by" and "At once". Pick a
target on the deploy column and what to check on the test column; anything
missing can be added right there.

The board already works at this point: drag a card into "In progress" and the
agent takes it. The route is for the steps after that.

## 2. Draw the route

The **"+ route"** tab. Drag from "In progress" by the upper right point to
"Review", from "Review" to "Deploy", then to "QA" and "Done". An arrow to a
faded column adds it to the route.

Draw the red arrows right away too: a failed step must lead somewhere, or the
card stops without warning. Usually back to work, or to "Did not pass".

## 3. A stage's own agent

Each stage can be worked by its own agent. Select a route stage, unfold "Only
on this route…" — there is "Worked here by" with agent tickboxes. If empty, the
stage uses its column's agents ("Worked by"). This way "In progress" is worked
by one agent and "QA" by another; when a card enters a stage, the app sets that
stage's agent in the assignment field.

## 4. Forks

When "passed" alone is not enough — [conditions on arrows](./rules.md): by a
card property, by what the agent wrote, or by a person's mark. Add the fallback
arrow without a condition right away.

## 5. Check

Save and walk one real card through the whole route. Watch two places: the
route strip on the card (where it stands, what it waits for) and the agent's
comment at the end (what it did or why it could not).

## If nothing moves

First look at the route strip on the card: if a stage could not start or the
route has nowhere to go, the reason is written there in amber.

| What you see | Why |
|---|---|
| The card stands, the strip shows nothing | The column does nothing, or the card picked no route and the column is not configured |
| On the strip: "the event arrived, but no condition held" | The fork has no fallback arrow and no condition matched |
| You ticked the option, the card did not move | The "the card was ticked" arrow waits for another property or value |
| "Save" refuses | The message says which arrow or condition is wrong; changes are written whole or not at all |
| There is a route, but a card cannot join it | The board has no option with the route's name — the route panel offers to add one |
| On the strip: "the stage did not start: …" | The reason is in the line: no project found, the column is busy, no agent. The card's terminal offers to pick a folder and an agent on the spot |
| The agent does not start at all | `npx` or the adapter was not found — see [Agents, npx and Node.js](../settings/agents.md) |
