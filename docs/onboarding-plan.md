# Onboarding: a first run that works

What a person should understand in their first ten minutes, and how to get
them there. Written after an attempt that failed, so it starts with why.

## What went wrong, and the rules that come out of it

Focalboard's tour was resurrected: a `/welcome` screen offering to show
somebody around, and nine tips over the board. Driven through a browser
against a real first launch, the button led to nothing — no tip appeared,
and what opened on the new board was `boardSetupWizard`, asking for the
project, the agent, the deploy target and the QA server. A full-screen
greeting had been put in front of a working wizard.

Three things were wrong, and each is a rule for the next attempt.

**The tour was about another product.** Views, links, sharing a board,
sidebar categories: kanban furniture anyone who has seen a board already
knows, and none of it is why this app exists. What is worth explaining is
the one thing no other board does — a card lands in a column and an agent
does the work.

**It described instead of doing.** A tip saying "open a card to explore the
powerful ways this can help you organise your work" teaches nothing. The
moment a person understands this product is the moment they watch an agent
finish something they asked for.

**It was not run before it was called done.** The entry point was tested;
what was behind it was not. Onboarding work is finished when a clean data
directory has been driven end to end in a browser, not when tests pass.

## What already exists

Most of the first run is built. None of it needs replacing.

- **`boardSetupWizard.tsx` + `internal/acp/setup.go`** — the real first run.
  Go resolves a plan out of what the board's automation implies and what the
  machine already has: `project → agent → deploy? → browser? → source? →
  done`. The board opens it itself. This is the spine; everything below
  hangs off it.
- **The templates carry content.** All three ship three cards, and every one
  of them opens with a card called «С чего начать» whose body is prose about
  how that board works. Explanation as data, in the
  board: it survives translation, it is editable, and it costs no UI.
- **`tutorial_tour_tip/`** — the drawing half of a coach mark: a positioned
  bubble and a hole punched over a real element, measured from a selector.
  Mechanically fine. It is the linear nine-step *script* around it that is
  not.
- **`components/acp/attention.ts` and the event socket** — how the page
  already learns that something happened to a card, without polling.
- **`docs/guide/`** — the manual. Onboarding points into it, never
  duplicates it.

## What success is

A person who has just installed this, with an agent already on their
machine, should within ten minutes have **watched an agent finish a task
they typed**, and be able to say where the result went and what decides
where the card goes next.

That is the measure — not "saw nine tips". A change that does not move
somebody closer to that moment is not onboarding.

## The plan

Six pieces, each shippable on its own, in dependency order.

### 1. Delete the Focalboard tour

`webapp/src/components/onboardingTour/` (twelve steps), `pages/welcome/`,
`static/boards-welcome*.png`, the gifs the tips used, and — decided
separately — the server's `POST /teams/{teamID}/onboard` with
`server/app/onboarding.go`, which duplicates a demo board this app never
makes.

Nothing routes any of it. It has now cost two rounds of work to rediscover
that; leaving it in the tree guarantees a third. The `tutorial_tour_tip/`
drawing code stays — step 4 uses it.

The old preferences (`onboardingTourStarted`, `onboardingTourStep`,
`tourCategory`) go too; step 4 says what replaces them.

### 2. End the wizard with a first task

The wizard's last step is `done` and only says so. Instead it should offer
the one action that explains the product: **«Поставить первую задачу»** —
one field, one sentence from the person, and the app makes a card in the
board's trigger column and opens it.

- The trigger column is already known: `xciiiColumns` on the board says
  which column starts an agent. No new configuration.
- The offer appears **only if the agent step passed**. The wizard already
  knows; an offer that fails because nothing is installed is worse than no
  offer at all.
- **It spends the person's own quota**, so it asks first and says so.
- A board with no agent column gets no offer. It ends by pointing at its own
  «С чего начать» card instead.

This is the highest-value piece and could ship alone.

### 3. Say what is happening while the first card runs

Somebody watching a card they just created does not yet know that the
comments are where the agent talks, or that the column decides what happens
next.

One dismissible strip above the board while **their first card** is running:
what the agent is doing, that it writes into the comments, and that the
column decides where the card goes after. It disappears when the card leaves
the column, and never comes back.

Driven by the events already on the socket — the same ones
`components/acp/attention.ts` subscribes to. No polling, no new API.

### 4. Contextual hints, one at a time, never a tour

Everything else worth learning happens at a moment that arrives on its own.
Tie each hint to its moment rather than to a position in a script:

| Moment | What the hint says |
|---|---|
| An agent asks its first question | the amber dot, and that the options *are* the answer — on the card or from the notification |
| A terminal opens for the first time | the agent's own CLI in this card's worktree, and it survives the window closing |
| A card first arrives in «Входящие» | something outside the board brought this in; it is a view, not a place |
| A route first sends a card back on failure | why that arrow points backwards |

Each is independent, shown once, drawn with `tutorial_tour_tip/`.

**Store them as a set, not a counter.** The old design had `tourCategory`
plus `onboardingTourStep`, which forced a total order and made "show me that
one again" meaningless. A `shownHints` preference holding ids lets hints be
added, removed and reordered without a migration, and lets one be cleared
alone.

One trap to remember, because it will bite again: `patchProps` used
`setState('users', 'myConfig', obj)`, and `setState` with a plain object
*merges* — a preference deleted server-side lived on in the page for ever.
It reconciles now, and `appStore.test.ts` holds the line.

### 5. Make «С чего начать» the reading surface — done

Every template opens with it now, written for that board's own work: the
developer one got the card it never had, and each board ships two example
tasks beside it rather than five placeholders. What is left of this item is
the pointing: step 2's fallback and step 3's strip should lead to that card.

Content in a template is data: no code path, no message id, editable by
whoever edits the template, and it arrives with the board rather than being
layered over it. Prose belongs there; the app itself stays short.

### 6. Only then, a settings entry

Once hints exist as a set, **«Настройки» → «Приложение»** can carry a row
that clears `shownHints`, and it will mean something. Adding it before there
was anything to replay is what produced a button that cleared four
preferences and navigated to a route that no longer existed.

## How each piece gets verified

- **A browser against a real build, from an empty data directory.** A build
  without the `production` tag uses `XCIII-dev`, so this never touches a
  real install: `wails3 task build:server DEV=true`, or `go build` with
  `server,json1,sqlite3,frontend`. A throwaway cypress project pointed at
  `http://localhost:8080` drives it; the session token is in the bootstrap
  script the front door injects into the page.
- **The whole path, not the entry point.** Template → wizard → first task →
  the agent's comment on the card. Every failure described at the top would
  have been caught by walking one step further than the change itself.
- **`docs/guide/`** gets its page in the same change, per the repository's
  rule, and every string it quotes is checked against `webapp/i18n/ru.json`.

## Open questions

- **What does the first task say?** A prefilled suggestion per template
  would be concrete, but one that does not fit the person's project is worse
  than an empty field. Probably an empty field with the template's own
  placeholder.
- **No agent installed at all.** Steps 2 and 3 need one. The wizard already
  offers to install an adapter through npx; whether onboarding waits for
  that or teaches the board without an agent is a product decision.
- **What carries to the landing.** `site/` has no mention of «Входящие» —
  mail, Kaiten, share-from-a-phone, webhooks — which is half the product.
  The first-task flow, once it exists, is also the most demonstrable thing
  here.
