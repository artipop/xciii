# How a card gets worked on

What happens between dropping a card into a column and getting a comment back:
which agent takes it, where it writes, which branch it commits to, and what
moves the card on. Written for a person using the board; the code is in
`internal/acp`.

## The three things that decide everything

| | Where it lives | What it answers |
|---|---|---|
| **Column** | board menu → *«Как работает эта доска…»*, or the column's own menu | what happens when a card lands here, who works it, how many at once |
| **Flow (route)** | the same editor, a route tab | where the card goes next, and on what event |
| **Registries** | sidebar → *«Настройки → Эта машина…»*; folders in the board's own screen | the machine: which agents exist, where to deploy, how they reach the network |

The split is worth holding onto: a **column says what is done**, a **route says
where the card goes afterwards**. A board with columns but no route still works
— cards are worked on where they stand and moved by hand. A board with routes
but no columns moves cards around without doing anything.

The registries live on the machine, the columns and routes belong to a board. A
board made from any of the offered templates brings its own columns and routes;
the first time it is opened on a machine with empty registries, the setup wizard
asks for the rest.

## Where a setting lives

Three kinds of thing get set up, and each is edited where it belongs:

| What | Where | Why there |
|---|---|---|
| Which agents are installed, where they deploy, how they reach the network, whether the board is on your tailnet | *«Настройки → Эта машина…»* in the sidebar | none of it is about a board, so none of it needs one open |
| What each column does, where a card goes next, which folders this board's agents work in, what they are told first | *«Как работает эта доска…»* in the board's ⋯ menu | all of it is this board's, and changing it changes only this board |
| Which folder and which agent *this card* uses | the card itself | asked when a terminal is opened and the answer is not already known |

Карточка называет своего агента **исполнителем** — каждый зарегистрированный
агент становится участником доски под своим именем, так что «Кто занимается»
отвечает на этот вопрос тем же полем, которым доска и так пользуется. Отдельного
поля «Agent» больше нет: два поля на один вопрос — это два ответа, и правило о
том, какой из них главнее. Доска, у которой это поле ещё осталось, теряет его
при первом же открытии.

The board's menu holds nothing else: export, this screen, and saving the board
as a template. Registering an agent or a folder does not need the settings —
both are offered where the choice is made, on a card and in the column's «Кем
делается», and take a name and a kind. Everything more about an agent — model,
environment, MCP servers, proxy, CLI arguments — is in the machine's settings
and has a working default until you go there.

Folders are part of *running an agent*, not part of having a board. A board with
no agent column is never asked for one, gets no «Проекты» field, and shows no
«Проекты» section.

## Where both halves are edited

*«Как работает эта доска…»* is one screen for the two of them, and the picture on
it is the board itself: **every column is a box on the canvas**, whatever
happens in it. Along the top are the routes; **«Колонки»** is the same canvas
with no route chosen, which is where you say what each column does.

- **choose a column** and the panel on the right is about it: what happens when a
  card lands there, who works it, how many at once, where it deploys. That
  answer holds for every route at once, because it is the column's;
- **choose a route** and its arrows are drawn over the same boxes. The columns
  the route does not use stay on the canvas, faded — **clicking one puts it on
  the route**, and so does drawing an arrow to it. There is no separate "add a
  stage and then pick its column": a stage a card can stand on *is* a column;
- **draw a transition** by pulling from a box's right edge — the upper point is
  "when this succeeded", the lower "when it failed" — or from the bottom point
  for something to wait for, like a merged branch. Click an arrow to change what
  it waits for or where it leads;
- **drop a block from the palette** — «Агент», «Деплой», «Тест» or a plain
  column — and a new column of the board appears where it landed, already doing
  what the block says. Rename it in the panel; the routes and specs follow the
  option, not the name;
- a stage may differ from its column on one route only — «Только в этом
  маршруте…» in the panel — but that is the exception, folded away.

## Rules: when one event is not one arrow

A transition can ask about the card before it moves it. The condition sits on
the arrow, in the panel and on its caption, and there are exactly two questions
it can ask — both about the card, neither a script:

- **«только если на карточке…»** — a select property carries a value. Two
  arrows out of one event make a fork: «шаг прошёл» ведёт срочную карточку в
  «Деплой», остальные — в «На ревью». The first condition that holds wins, and
  the arrow without one is the fallback;
- **«только если агент написал…»** — the agent's closing comment contains a
  text. This is how the agent itself routes the card: попросите его закончить
  словами «ГОТОВО К ДЕПЛОЮ», и ветка с этим условием поедет, только когда он
  сам так решил. Только на исходах шага — там, где агент вообще говорил.

And one more thing a stage can wait for, beside the project's events:

- **«на карточке выбрано»** — a person (or an agent through the board's tools)
  sets an option on the card: «Одобрено = Да», скажем. The stage moves the card
  the moment the option is set — no polling, the board pushes. Setting any
  other option does nothing: the arrow names exactly what it waits for.

A card's own strip shows these waits with their conditions spelled out, so a
parked card always answers "what are you waiting for" precisely.

Two things are saved at different moments, and it is worth knowing which. A
**column of the board** — adding one, renaming one — is a change to the board and
lands at once, for everybody looking at it. **What happens in a column, and the
routes** are saved when you press *«Сохранить»*, because the engine checks the
whole picture before it takes it: a transition leading nowhere, two stages on one
column, an agent that is not registered are all refused with a sentence saying
which.

The editor also checks the one thing that silently costs an afternoon: a card
takes a route by **naming** it, so a route with no option of that name anywhere
on the board is a route no card can ever be put on. It says so where the route is
edited, and the button beside it adds the option.

A **project** is the exception, and deliberately: it belongs to the board it was
added on, and only that board offers it. The folder of household notes has no
business on the board about code, and vice versa — before this, opening the
projects list anywhere copied every project anybody had ever added into that
board's «Проекты» field. One checkout worked from several boards is a real case,
so the add form has **«На всех досках»** for it, and such a project is marked as
everyone's in the list. Such a project is still not pushed onto a board that
knows nothing about folders: it joins the «Проекты» field of a board that has
one already, and creates that field for nobody.

A project registered before boards owned them belongs to none of them, so no
board offers it — that is the whole point, and "it used to be everywhere" is the
state being fixed. It is not lost either: the «Проекты» section lists them under
**«Пока ни на одной доске»**, and one click makes them the board's. That click
is also the only way back in, since adding their folder again would be refused
as a duplicate path.

Three templates are offered. «Разработка» is the one written for code, with
the «Фича», «Хотфикс» and «Только ревью» routes across «В работе», «Деплой»
and «QA». The other two are the same machinery pointed at ordinary life
— «Домашние дела», «Покупки и меню» — and they are worth
reading as examples, because they show what is left when deploys and browser
tests are taken away: one column where an agent works, and a route that waits
for a person. There the agent writes into a folder of household notes — an
ordinary folder, added on the card or in «Проекты», with nothing to set up in it and no
git anywhere near it: a plan for the cleaning, a menu and a shopping list for
the week. When it is done the card moves itself to the
stage where somebody looks, and no further: «На проверке» and «Проверить список»
are ends of the automatic part, and you move the card on
yourself. The short routes («Сделать сразу», «Быстрый список») skip even that
and close the card as soon as the agent is done.

Git is asked for by what a board does, not by which template it came from. A
board that publishes a branch or waits for one — a deploy or test stage, or a
transition the VCS watcher has to poll for — needs its project under git, and
the setup wizard says so and refuses a folder that is not. A board that does
neither takes any folder, gets no worktree (the agent works in the folder
itself, one card at a time) and has no branch-driven transitions to miss.

## What happens when a card lands in a column

```mermaid
flowchart TD
    A["Card moved into a column"] --> B{"Is this column configured<br/>to do something?"}
    B -- no --> Z["Nothing happens"]
    B -- yes --> C{"Is the card assigned<br/>to a person?"}
    C -- yes --> Z2["Nothing starts.<br/>The card says why and waits for them"]
    C -- no --> D{"Column full?<br/>crew busy or limit reached"}
    D -- yes --> Q["Card waits in the queue.<br/>Starts by itself when a place frees up"]
    D -- no --> E["Pick an agent:<br/>assignee → the column's crew<br/>→ the only one registered"]
    E --> F["Find the project:<br/>project_path → Проекты option → source column name"]
    F --> G{"worktreeMode"}
    G -- always, the default --> H["Create a git worktree<br/>on a new branch acp/card-title-abcd1234"]
    G -- never --> I["Work in the project itself.<br/>A second card is refused while one is running"]
    H --> J["Session runs: the agent works,<br/>progress and result land as card comments"]
    I --> J
    J --> K{"Is the card on a route?"}
    K -- no --> L["Card stays where it is.<br/>A person moves it on"]
    K -- yes --> M["The route takes the outcome<br/>and moves the card to the next stage"]
```

Two things about that first step. The trigger is a **change** of the column
property on an existing card — a card created directly in a column starts
nothing. And a card dragged out of a column while its session runs cancels it.

## When a worktree appears, and what becomes of it

With `worktreeMode: "always"` (the default) every card-triggered coding session
gets its own git worktree:

- **created** when the session starts, under `~/Library/Application Support/XCIII/acp/worktrees`, on a new
  branch named `acp/<card title>-<session id>` — so the branch reads like the
  task and the preview address built from it does too;
- **based on** the card's `branch` property if it has one, otherwise on `HEAD`;
- **kept** when the session finishes successfully — the work is in it;
- **removed** when the session failed or was cancelled *and* the worktree is
  clean: no uncommitted changes and no commits ahead of its base. Anything the
  agent actually wrote survives even a failed session. `keepFailedWorktrees`
  keeps them all.

Three kinds of session never get a worktree, and run in the project itself: a
**deploy** (it publishes an existing branch), a **test** (it reads the code it
is checking), and a **planning** session (it changes nothing).

## Which branch is followed

The card rarely names its branch, and with worktrees the agent's branch is
invented by us — so anything that watches a project asks in this order:

```mermaid
flowchart LR
    A["Card property<br/>branch"] --> B["The branch this card's<br/>sessions worked on"]
    B --> C["What the route<br/>already carried"]
    C --> D["The project's<br/>checked-out branch"]
```

The second one is what makes worktrees and routes work together: without it a
stage waiting for a merge would watch whatever happened to be checked out. The
deploy column resolves its branch the same way, so it publishes what the agent
wrote — the same branch as the **Deploy** button next to it on the card.

## Waiting for the project

A stage can wait for something that happens outside the board:

| Trigger | Where it comes from | Needs |
|---|---|---|
| `branch.pushed`, `branch.merged` | local git | nothing |
| `pr.opened`, `pr.merged`, `pr.closed`, `review.approved`, `checks.passed`, `checks.failed` | GitHub API | a token in `githubToken` or `GITHUB_TOKEN` for private projects |

There is nowhere for a webhook to arrive on a laptop, so this is polling —
`vcsPollSeconds`, 60 by default — and **only for the branches a parked card is
actually waiting on**. An idle board makes no requests at all.

## The routes the template ships

### «Фича» — the long way round

```mermaid
flowchart LR
    P["В работе<br/>agent"] -->|done| R["На ревью"]
    P -->|failed| B["Заблокировано"]
    R -->|branch merged| D["Деплой<br/>deploy"]
    D -->|done| T["QA<br/>test"]
    D -->|failed| F["Не прошло"]
    T -->|passed| OK["Проверено"]
    T -->|failed| P
    T -->|could not test| B
```

The loop is the point: a failed check sends the card back to the agent rather
than to a person, and the next session opens a new branch which the route then
follows.

### «Хотфикс» — written and published

```mermaid
flowchart LR
    P["В работе<br/>agent"] -->|done| D["Деплой<br/>deploy"]
    P -->|failed| B["Заблокировано"]
    D -->|done| C["Готово"]
    D -->|failed| F["Не прошло"]
```

### «Только ревью» — never deployed from here

```mermaid
flowchart LR
    P["В работе<br/>agent"] -->|done| R["На ревью"]
    P -->|failed| B["Заблокировано"]
    R -->|branch merged| C["Готово"]
```

A card takes a route by naming it in its **«Сценарий»** field. A card that names
none is still worked on by the columns it passes through — it just does not move
by itself.

## Doing it by hand

Nothing here takes the board away from you:

- **assign a card to yourself** and no agent starts on it — deploy and test still
  run, since that is machine work. Assign an agent, or nobody, to hand it back;
- **drag a card anywhere** at any time: a running session is cancelled, and the
  stage you dropped it on starts as if the route had moved it;
- **open a console** on a card (*Open session*) to talk to an agent directly —
  that is asking for one outright, so the assignee rule does not apply;
- **Deploy** next to the branch publishes it without moving the card.

## What an agent can do to the board itself

An agent working in a terminal is given the board as tools, so the board is
something it can read and change rather than something it describes to you and
leaves you to do. Every one of them speaks in the names you see on the screen —
a column, a project, an agent, a route, an answer — and none of them takes a
board: an agent only ever reaches the board its terminal was opened on.

| What it can do | Tools |
|---|---|
| see the board | *list_columns* — the columns and what each one sets off; *list_flows* — the routes, their stages and what carries a card off each one |
| find a card | *list_cards*, optionally in one column; *get_card* for one card with its description and where it stands on its route |
| put work on the board | *create_card*, *create_cards* — how a planning conversation ends |
| change a card | *update_card* — its title, its project, its route, an answer a stage is waiting on; *comment_card* — a note in the card's own history |
| hand work on | *move_card* — the card goes into another column, **and the column starts** |

That last row is the one to know about. A card an agent moves is a card moved:
the column it lands in does what it always does, and the route takes it from
there, exactly as if you had dragged it yourself. So an agent that finishes what
a card asked for can put it into review, and the route carries it the rest of the
way without you.

Two things are deliberately not there. An agent **cannot rewrite a card's
description** — that is what you wrote, and what an agent has to say about a card
goes into the comments where the rest of its history already is. And a card an
agent asks about must be **on the same board**: a card id it read somewhere else
opens nothing.

The tools reach an agent you are talking to in a terminal. A session running a
card on its own does not get them — an agent moving its own card into the column
that starts it is a circle with nobody in it, and while that is worth having, it
is not worth having by accident.

## Settings an agent has of its own

Agents differ in what they can be told beyond the task: Claude has **Fast mode**,
an **effort** level and a permission **mode**; Codex has a mode and a model and
neither of the other two. Nothing about that is written down on our side — the
*«Эта машина…» → «Агенты»* panel starts the agent you are editing, asks it what it supports and
shows exactly that. So an agent without Fast mode has no Fast mode switch, and an
agent that gains a setting shows it after *Recheck* without an update here.

- the answer is remembered per agent, so opening the form is instant; **Recheck**
  asks again, which is what to press after changing an account or updating an
  adapter;
- a setting left at *As the agent has it* is not sent at all;
- a setting is applied after the model and the mode this app would have chosen,
  so what you pick here wins;
- "Could not ask the agent…" means the agent would not start — the adapter is
  missing or the account is not logged in. Everything else on the form still
  saves.

### When the agent asks you something

An agent that needs a decision — which database, which of two approaches, may it run a command it
was not given — asks, and waits: the question, the options with their explanations, and a box for
an answer in your own words if none of them fits. Answer it and the turn carries on from where it
stopped.

You do not have to be watching for it to reach you. The card grows a small amber dot on the
board, and the question itself arrives as a notification with its options on it — answer there,
or open the card and answer on it, whichever you happen to be looking at. Both are the same
question, and answering either one lets the agent go on.

Two things are worth knowing about the wait:

- only the thing that asked is waiting. The agent keeps working on everything else, and the card
  stays in its column, marked as waiting for you rather than done;
- nothing is decided for you by a timer. A question with no answer is answered when the session
  is cancelled or the app is closed, and "no answer" reaches the agent as a refusal — it then
  finishes without whatever it asked for, and the card's comments say what that was.

If a particular tool should never be asked about, put it in the column's allow list instead — the
agent stops asking and stops waiting.

### What the protocol has no word for

Remote control — driving an agent's sessions from claude.ai or the Claude app —
is not on that list: it is a flag of the CLI itself rather than a setting of the
protocol, so the agent cannot be asked about it. It is therefore named by hand:
a Claude agent has a **Remote control** checkbox in the same dialog and, if you
want one, a prefix for the session name it will appear under in claude.ai. It
works through a door the adapter documents for itself — the arguments reach the
real `claude` process when the session starts.

Next to it is **Arguments for the CLI behind the adapter**, where anything else
goes (`--fallback-model sonnet`). We keep no list of those flags: it is somebody
else's CLI and it changes without us. Getting one wrong is cheap — an argument
the CLI does not know fails the session start in its own words (`unknown option
'--nonsense'`), and you see it when the agent is rechecked rather than later on
a card.

For the other kinds the agent *is* the CLI, so its flags go in the ordinary
**Extra CLI args** field and there is no remote control checkbox — their
adapters have no such channel.

## When nothing happens

| What you see | Why |
|---|---|
| Card sits, no comment | The column is not configured, or the property that changed is not the one the columns are on |
| "Агент не запускается" | Somebody is assigned to the card |
| "Колонка занята" | The crew is busy or the limit is reached; it starts by itself later |
| "не задан ни project_path…" | The card matched no project: check the **Проекты** field against the registry |
| Card never leaves *In Review* | Nobody is watching its branch — see [which branch is followed](#which-branch-is-followed), or the route has no edge for what happened |
| Test stage refuses to start | The agent has no browser MCP server (*«Эта машина…» → «Агенты»* → MCP servers) |

Everything a session does is written to the card as comments, and the card shows
its route, the stage it is on and what that stage is waiting for.

## The knobs

`~/Library/Application Support/XCIII/acp/config.json`, all of it editable
by hand:

| | |
|---|---|
| `worktreeMode` | `always` (default) or `never` |
| `maxConcurrent` | how many sessions run at once on this machine (3) |
| `sessionTimeoutMinutes` / `testTimeoutMinutes` | one turn (15) and one browser pass (30) |
| `sessionIdleMinutes` | how long a console session sits between turns (30) |
| `boardPrompts` | what each board tells its agents first, keyed by board id — written by *«Как работает эта доска…»*, not by hand |
| `vcsPollSeconds` / `gitRemote` / `githubToken` | watching projects |
| `autoAllowTools` | what an agent may do without asking. A card-triggered session has nobody to ask, so anything not on the list is refused |
| `artifactsDir` | screenshots and verdicts of test runs |

Колонок и маршрутов в этом файле нет: **автоматика доски лежит на самой доске**,
в её собственных свойствах `xciiiColumns` и `xciiiFlows`, вместе со всем остальным,
что доске принадлежит. Поэтому она уезжает вместе с доской в экспорт архива и в
шаблон, копируется вместе с копией доски и исчезает вместе с удалённой — а файл
рядом с приложением хранит только машинное: агентов, папки, цели деплоя,
промпты. Установка, сделанная до этого, переносит своё на доски один раз, при
запуске.

See also [README.md](../README.md) for building and running the app.
