# Templates: a board that has not been made yet

A template is where a board comes from, and on this board what matters is rarely
the cards on it. It is the three things this product added around them: what
happens in each column, where a card goes next, and what the app has to be told
about **this machine** before any of that can run.

None of those are visible on a board, so a template is not edited by opening it
and moving cards about. *«Шаблон»* is the window that shows them, reached from:

- the ⋯ menu of an ordinary board — *«Сохранить как шаблон…»*, which copies
  the board, under the board's own name, and opens the copy;
- the template picker — the pencil on any template of yours;
- the banner on a template you already have open — *«Колонки, маршруты и
  настройка…»*.

**The columns and the routes are shown there and not edited there.** A template
is made by building a board and saving it, so what it carries is what already
worked; the way to change it is to change the board and save it as a template
again. That window held the whole route canvas of [flows.md](flows.md) inside a
scrolling dialog, which put a graph editor between somebody and the two fields
they came to fill in — and gave one set of routes two places to be edited, the
second of them a copy nobody was looking at.

## What a template carries

| | Where it comes from | What it does when a board is made |
|---|---|---|
| **Columns and their behaviour** | the board it was saved from | the new board's columns already run an agent, deploy, test |
| **Routes** | the same board's route tabs | a card that names one moves along it by itself |
| **Rules** | conditions on those arrows | the same outcome forks on the card's own properties, or on what the agent wrote |
| **Questions to ask** | the list in *«Шаблон»*, the one thing edited there | the setup wizard walks exactly these, in this order |

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

The browser step asks **who tests** before it asks what with, the way a card and
the planning dialog ask it — the registry as name chips, quick-add beside them —
because the answer is one agent and two writes: the server goes on that agent,
and that agent goes into the test column's crew. The two cannot be told apart at
run time, since a test session refuses to start unless the agent the column
resolved carries a browser server, and the wizard used to put the server on
whichever agent the registry listed first. The plan names the test column
(`SetupPlan.TestColumn`) so the question can say which column the answer crews.

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
along with the questions the original declared and the board's own name. The
registry is only asked first: a board reaches it when something first reads the
board's automation, so a board made from a template and saved straight back has
all of it on the board and none of it in the registry — and writing that empty
answer over the copy erased exactly what the template was being made for. What it deliberately does not
carry is the machine: the agents and deploy targets it named live in
*«Настройки → Эта машина…»* and are this install's, the folders belong to the
board they were added on, and a board made from the template asks for them
again.

## What is offered in the picker

The templates the install ships — «Разработка», «Контент», «Домашние дела»,
«Покупки и меню» — and every template you have made. The rest of Focalboard's
own defaults are hidden: they know nothing about columns that run an agent, so
a board made from one arrives with no automation at all.

«Контент» is also the smallest demonstration of setup following the flow: its
routes are «Через бриф» (Бриф → Черновик → На вычитке, failures to «Не пошло»)
and «Сразу черновик», both agent-written and person-read, with no deploy and
no browser test anywhere — so its `xciiiSetup` declares only
project/agent/done, and the wizard for a board made from it asks for a folder
and an agent and nothing else.
