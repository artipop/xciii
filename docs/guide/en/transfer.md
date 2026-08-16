# Moving a board, and backups

A board is exported and imported as one `.boardarchive` file. The same file is
the backup.

- **one board** — the board's ⋯ menu → "Export board archive";
- **all at once** — "Settings" → "Import and export" → "Export";
- **loading** — "Import", in the same place. Boards from an archive are added
  to the existing ones, nothing is replaced; the same archive imported twice
  gives two boards.

Below in the same section — **Trello, Notion, Todoist**. These are not
migration buttons: the export is done on the service's side and turned into an
archive, which is then imported here; each card opens the instructions.

## What moves with a board

Everything configured on the board itself: columns and their actions; routes
and conditions on transitions; the agent instruction; the setup wizard's
questions; cards, attachments, members and views, the inbox included; each
card's position on its route.

A board opened on the new machine looks and behaves the same.

## What needs to be set up again

Everything that belongs to the machine rather than the board: folder paths,
SSH keys, tokens and environment variables are not valid on another computer.

| What | Where to set it up after the move |
|---|---|
| Agents — model, environment, MCP servers, proxies | "Settings" → [Agents](./settings/agents.md) |
| Where to deploy — the Dokku host and the SSH key | on the deploying board: ["Columns and routes"](./automation/index.md) → "Where to deploy" |
| Proxies | "Settings" → "Proxy configurations" |
| Access from a phone | "Settings" → [Access from a phone](./settings/index.md#access-from-a-phone) |
| Project folders | in ["Columns and routes"](./automation/index.md) |
| Theme and language | "Settings" → "The app itself" |
| Sources — the token is issued anew | the board's setup wizard, or [Sources](./inbox/sources.md) |

The setup wizard asks only for what is missing; it can be walked again any
time: ⋯ → "Columns and routes…" → "Walk the setup again…".

Agent names are remembered: the assignment field travels with the card, so
registering an agent under the same name is enough. A column that refers to an
unregistered agent is kept and waits for the registration.

## What does not move

- **Sources and their rules** — set up again. There will be no duplicates:
  cards remember what they were created from, and a reconnected source will
  not create them a second time.
- **The project name.** You point at the folder yourself; name the project as
  before — cards refer to it by name.
- **Session and terminal history.** Conversations with an agent belong to this
  machine and do not move; on the new machine a card starts a fresh one.
