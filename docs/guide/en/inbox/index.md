# Inbox

Cards can arrive on the board by themselves: a task from Kaiten, a link from
the browser, a notification from a phone. Everything that arrives is filed in
one place — the inbox. How to connect sources is on
[the next page](./sources.md).

## Where it is

The inbox is a **view of the board**, not a column: it is in the sidebar under
the board's name, next to the other views. It holds only what has arrived, one
column per source. (The app names the view and the column **Входящие**; the
name is not translated.)

Cards cannot be dragged between these columns: a column here shows who brought
the card.

The board also has the inbox column itself — a card must stand somewhere — but
it is hidden from the kanban, so unsorted cards do not take space among the
working columns.

There is no separate "source" field: the source is recorded as the card's
author, and the board groups by "created by". If what arrived has an address,
it is saved on the card in a link field; the field is found by its type and can
be named anything.

A board made from a template shows the inbox right away, still empty. A board
created empty gets it with its first source or the first shared link.

## A task of your own

The **"New"** button in the inbox creates a card in the **Мои задачи** ("my
tasks") column rather than in the inbox: the inbox holds what came from outside,
and this card is yours.

Мои задачи is an ordinary column of the board, first on the kanban: a card is
dragged from it into work like any other. In the inbox view it stands in the
column with your name — the columns there are authors.

## Sorting it out

- **On a computer**: open the inbox view and a card in it — like any other.
  Drag it into a working column — it disappears from the inbox. If the card
  belongs on another board: card menu → **"Move to a board…"** — it moves
  together with its comments.
- **On a phone**: `/m`, the Inbox tab. A card is moved to a board and a column
  in two taps.

## If nothing arrives

| What you see | Why |
|---|---|
| No inbox in the sidebar | The board was created empty and has no source — the view appears with the first one; until then "Sources" is in the board's own menu |
| No "Sources" in the board menu | The board has an inbox — the setting moved to that view's menu |
| "needs a token" next to a source | The token was not saved or was revoked — "Remove" and set the source up again |
| "failed" and an error text | Usually a wrong service address or token; the error is quoted from the service |
| "dropped" in the log | "keep only what a rule asks for" is on, and there are no rules |
| Cards arrive on the wrong board | A source belongs to the board it was created on; make another source for another board |
| A shared link made no card | The same link was already sent to this board — it is in the inbox |
