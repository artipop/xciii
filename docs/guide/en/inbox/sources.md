# Sources

Sources are set up in the board menu: ⋯ in the header → **"Sources"**.
Everything they bring goes to [the inbox](./index.md). There are three ways.

## Share (macOS)

Sends a link to the board from any app.

1. Press **Share** (in Safari or another app) and pick **XCIII**.
2. In the **"Save to a board"** window the title is already filled in; add a
   note if you want and pick a board.
3. Press **"Save"** — the card goes to the chosen board's inbox.

Useful to know:

- the board you picked last time is offered first;
- the same link to the same board does not create a second card; to another
  board it does;
- if XCIII is not in the Share menu: start the app at least once and enable the
  extension in **System Settings → General → Login Items & Extensions →
  Sharing**.

From a phone the same window opens at `/share` of your board.

## Kaiten

Brings over the tasks assigned to you in Kaiten.

In the sources dialog set a name (say, `kaiten`), pick **Kaiten** from the list
and fill in:

- **the Kaiten address** — your company's, e.g. `https://company.kaiten.ru`;
- **the Kaiten board id** and **space id** — to narrow it to one board or
  space; the ids are visible in Kaiten's address bar;
- **only where I am responsible** — off by default, then tasks where you are
  merely a participant arrive too;
- **"Token from the service"** — a personal API token from your Kaiten
  profile. It is stored in the keychain, not in a settings file.

The app polls Kaiten every five minutes. One task — one card: repeated polling
creates no duplicates, and a changed task gets a comment.

Next to the source's name is its state — "working", "needs a token", "failed".
The **"Log"** button shows what the source has brought.

## HTTP: a script, a webhook, a phone

Accepts cards from anything that can send an HTTP request. Leave **"Fed from
outside (a script, a phone)"** selected, set a name and press "Add" — the
dialog shows an address like `http://127.0.0.1:PORT/sources/ingest/name` and a
token. **The token is shown once** — save it right away.

```bash
curl -X POST "http://127.0.0.1:PORT/sources/ingest/phone" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"v":1,"id":"n1","title":"Delivery tomorrow","body":"Order #123"}'
```

`id` is the identifier in your system: sending the same `id` again does not
create a second card. Besides `title` and `body`, `url` (becomes the link field
on the card), `at`, `labels` and `props` are supported. Several records at once
go as a batch:

```json
{"v": 1, "items": [{"id": "n1", "title": "First"}, {"id": "n2", "title": "Second"}]}
```

The **"A stream of notifications: keep only what a rule asks for"** tickbox
sets what happens to records that match no rule: on — they are dropped, off —
they go to the inbox. For Kaiten and other plugins it turns itself off.
