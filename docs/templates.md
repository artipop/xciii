# Templates: a board that has not been made yet

A template is where a board comes from, and on this board what matters is rarely
the cards on it. It is the three things this product added around them: what
happens in each column, where a card goes next, and what the app has to be told
about **this machine** before any of that can run.

None of those are visible on a board, so a template is not edited by opening it
and moving cards about. It is edited in *«Шаблон»*, which is reached from:

- the template picker — the pencil on any template of yours;
- the banner on a template you already have open — *«Колонки, маршруты и
  настройка…»*;
- the ⋯ menu of an ordinary board — *«Сохранить как шаблон…»*, which copies
  the board and opens the copy.

## What a template carries

| | Where it comes from | What it does when a board is made |
|---|---|---|
| **Columns and their behaviour** | the canvas, the same one as [flows.md](flows.md) | the new board's columns already run an agent, deploy, test |
| **Routes** | the route tabs on that canvas | a card that names one moves along it by itself |
| **Rules** | conditions on the arrows | the same outcome forks on the card's own properties, or on what the agent wrote |
| **Questions to ask** | the list under the canvas | the setup wizard walks exactly these, in this order |

The first two live in the template board's own properties (`xciiiColumns`,
`xciiiFlows`), and a board made from it takes them into this machine's registry the
first time it is looked at. From then on they are the board's own: editing them
there does not touch the template, and editing the template does not reach back
into boards already made.

A fourth key sits beside them: **`xciiiProjectProperty`** is the id of the card
property that holds the projects. Making a board from a template duplicates it
without renumbering the card properties, so the id the template writes is the id
the new board has, and nothing has to recognise the field by what it is called —
the person who owns the board may rename it to anything. A board that has not
got the key has not got the field; the first project registered on it makes one
and writes the id down. Adding a *new* property to a template is still
hand-editing JSONL, which is what «[Свойства в шаблонах](deferred.md)» in the deferred work
is about.

## The questions

A board of household chores has nowhere to deploy to and nothing to test, and a
wizard that asks anyway reads as a broken feature. So the template names the
steps — from the closed set the app implements, because a template that could
invent a question would be a program:

- **Папка, в которой работать** — the project an agent writes in;
- **Агент, который берёт карточки**;
- **Куда деплоить** — only for a template that publishes a branch;
- **Браузер для тестов** — only for one that drives a browser;
- **Как этим пользоваться** — asks nothing; it is the last page.

Each step takes a line of the template's own beside the usual explanation
(«Папка с заметками по дому, подойдёт любая»), and an optional step can be marked
as one that cannot be skipped — a board whose route deploys cannot be set up
without somewhere to deploy to.

A template that names nothing has its steps **worked out from the automation**
above, which is the sensible default and is what the shipped templates other than
«Разработка» rely on. *«Назвать шаги»* takes over from that guess; *«Снова
выводить из автоматизации»* hands it back.

Whether a project has to be a git repository is never asked here and never
named by hand: it follows from what the board does. A board that publishes a
branch or waits for one needs git, and the wizard refuses a folder without it.

## Saving a working board as a template

Half of what a board does — what runs in each column, the routes — is registry
state of this machine rather than anything on the board, so an ordinary copy
would produce a template with the columns drawn and nothing happening in them.
*«Сохранить как шаблон…»* reads that half back out and writes it into the copy,
along with the questions the original declared. What it deliberately does not
carry is the machine: the agents and deploy targets it named live in
*«Настройки → Эта машина…»* and are this install's, the folders belong to the
board they were added on, and a board made from the template asks for them
again.

## What is offered in the picker

The templates the install ships — «Разработка», «Домашние дела», «Покупки и
меню» — and every template you have made. The rest of Focalboard's own defaults
are hidden: they know nothing about columns that run an agent, so a board made
from one arrives with no automation at all.
