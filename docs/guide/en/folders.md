# Folders and branches

An agent always works in some folder on your machine. The list of them is in the
board's menu → **"Folders…"**. A card picks one of them with its «Папки» field.

Which items a board's menu has is decided by the template it was made from: the
«Разработка» board asks about a folder, a deploy host and a browser, so its menu
has "Folders…" and "Where to deploy…"; a board of household chores asks about a
folder alone.

A folder is one of two kinds, and the list says which:

- **folder** — an ordinary directory: notes, texts, lists. The agent works in it
  as it stands, one card at a time;
- **repository** — a directory under git. Here every card gets a branch of its
  own, and the card shows it in its «Ветка» field.

The kind is not recorded once and for all: the app asks git every time it lists
them. Run `git init` in a folder you added a month ago and it is a repository —
nothing to reconfigure.

A folder is added with one button, **Add a folder…**, and repositories stand in
the same list as plain folders — including where the agent asks "Which folder
will you work in?".

## The base branch

A repository has one setting beside its name — the **base branch**. Work on a
card starts from it, and the "branch merged into the main one" transitions wait
for it.

The value is filled in when the folder is added: the app asks git which branch
the repository treats as its main one. Change it if you work off another —
`develop`, say.

## How an agent works in a repository

This is a choice about **that folder on this board** — two buttons on the
repository's row in "Folders…". A folder belongs to one board anyway, so for it
this reads as "how this folder works"; a folder marked «на всех досках» can be
used differently by two boards.

**"in a copy of its own"** (the default) — the card gets its own copy of the
repository and its own branch in it.

- several cards of one repository go at once;
- your own working directory is left alone: the agent never switches branches
  under you;
- the copy lives in the app's data and is not underfoot.

**"in the folder itself"** — the card's branch is made right in your folder.

- you see the agent's work in your editor as it happens, without going to
  another directory;
- one card at a time: until the first card's branch is merged, the next one
  waits and says on its strip what it is waiting for;
- if the folder has uncommitted changes, the agent will not start: the app will
  not switch a branch under your unsaved work. Commit or stash it.

There is no third answer for a repository: "work on whatever is checked out" is
what an ordinary folder already does.

A card that has already started stays where it started: its work is in that copy
or on that branch. The new answer applies to the cards that come after.

## The card's branch

One card, one branch — however many stages of a route it travels and however
many terminals you open beside it. The branch reads like the task:
`log-in-via-sso-1a2b`.

The branch is written into the card's «Ветка» field, so it travels with the card
to another board and is visible on another machine. The copy's directory is not
written to the card — a path means nothing on another machine; it is shown on
the card's stamp and in the terminal panel.

When a stage is finished and everything is committed, the copy's directory is put
away and the branch stays: the next terminal on that card remakes the copy from
the branch. A copy with uncommitted changes — or one a CLI is still running in —
is left exactly where it is.

## Where a stage of a route works

By default: an agent works on the card's own branch, a deploy and a test in the
folder itself (a deploy publishes a branch that already exists, a test checks
something already published).

A stage can say otherwise: select it in the route editor, open "Only on this
route…" and set **The stage works**. That is how you build a route where QA
checks the card's code *before* the merge: the QA stage works on the card's own
branch, and a "branch merged into the main one" transition after it leads to the
deploy.
