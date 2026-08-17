# Mail

The **"Mail (IMAP)"** source brings mail from a mailbox into the board's
[inbox](./index.md): one message, one card.

Any mailbox you can sign in to over IMAP with a login and a password works:
Gmail, Yandex Mail, Mail.ru, mail on your own server. Signing in with one
button ("Sign in with Google") is not built yet — services with two-factor
authentication need an **app password**, see [below](#known-mail-services).

## What to have ready

1. **The IMAP server's address** and port — the mail service publishes them;
   for the well-known ones they are [below](#known-mail-services).
2. **The login** — usually the mailbox's full address.
3. **The password.** If the account has two-factor authentication on, the
   ordinary password will not work over IMAP: you need a separate app password,
   issued in the account's security settings.
4. **IMAP switched on.** Gmail and Yandex have IMAP access off by default; it
   is switched on in the mail settings.

## Setting it up

1. Open the inbox view, ⋯ in its header → **"Sources"**. If the board has no
   inbox yet, the same item is in the board's own menu.
2. Give the source a name — say, `mail` or `support`. The name is visible on
   the cards: it becomes a column in the inbox and the cards' author.
3. Pick **"Mail (IMAP)"** from the list.
4. Fill in the fields and press **"Add"**.

| Field | What to put in |
|---|---|
| **The server** | The IMAP server's address, e.g. `imap.yandex.ru`. No `https://` and no port |
| **The port** | `993` by default — right for almost everyone |
| **The login** | The mailbox's full address, e.g. `me@example.com` |
| **The folder** | `INBOX` by default. For another folder, write it as the server names it |
| **"Token from the service"** | The mailbox's password or an app password. Stored in the keychain, not in a settings file |

Leave the **"A stream of notifications: keep only what a rule asks for"**
tickbox alone — it turns itself off for plugins, and mail goes to the inbox.

Once added, the source's state is shown next to its name — "working", "needs a
token", "failed". The **"Log"** button shows what the source has brought.

## The port and encryption

The connection is always encrypted — a mail password is never sent over an open
channel.

- **993** — encryption starts with the connection. Almost every mail service
  works this way, and this is the default.
- **any other port** (usually 143) — the app connects and negotiates encryption
  with a separate command (STARTTLS).

The server's certificate is checked the way a browser checks it. **A
self-signed certificate will not do**: the source will show "failed". For your
own server that means it needs a real certificate — from Let's Encrypt, for
instance.

## Known mail services

| Service | Server | Port | Password |
|---|---|---|---|
| Gmail | `imap.gmail.com` | 993 | An app password |
| Yandex Mail | `imap.yandex.ru` | 993 | An app password |
| Mail.ru | `imap.mail.ru` | 993 | A password for an external app |

Microsoft 365 and Outlook.com cannot be connected at the moment: they require
signing in through OAuth, which the app does not have yet.

### Gmail

1. Switch on two-factor authentication in the Google account — app passwords
   are not issued without it.
2. Issue an app password in the account's security settings and copy it: it is
   shown once.
3. Check that IMAP is on: Gmail settings → "Forwarding and POP/IMAP".
4. Put the app password into **"Token from the service"**, not the account
   password.

Gmail's labels are IMAP folders. To take mail from under a label rather than
from the inbox, write the label's name into **the folder**.

### Yandex Mail

1. Switch IMAP on: Yandex Mail settings → "Mail clients".
2. Issue an app password in Yandex ID, in the security section. With two-factor
   authentication on, this is the only way that works.
3. The login is the mailbox's full address, domain included.

### Your own server

Any IMAP server will do — poste.io, mailcow, Dovecot and the like. Two things
are needed:

- port **993** (or 143, and then STARTTLS is used);
- **a certificate issued by a known authority**. A fresh install usually has a
  self-signed one, and the connection will not go through until a domain is set
  up and a real certificate issued.

## What lands on the card

| On the card | From the message |
|---|---|
| The title | The subject |
| The text | The message's text part. If the message is HTML only, the markup is stripped |
| The date | The date it was sent |
| The author | The source — that is, the name you gave it |

Besides that the card remembers the sender, the recipient and the folder — they
are visible among the card's properties.

A message flagged in the mailbox brings a `flagged` label onto the card.

Not brought over: **attachments** and **mail that was already in the mailbox
when the source was set up**.

## How often mail is checked

Every five minutes. If the server does not answer, the following attempts come
further apart until it does.

The first check **brings nothing**: the source notes what is already in the
mailbox and from then on brings only the mail that arrives afterwards. This is
deliberate — otherwise setting up a source would dump the whole mailbox onto
the board.

Checking again creates no duplicates: a message is recognised by its own
identifier, which the mail service assigns.

## Several mailboxes

One source is one mailbox and one folder. For a second mailbox add a second
source under a different name; each gets its own column in the inbox.

A second folder of the same mailbox is added the same way: the same server and
login, a different value in **the folder**.

## If something does not work

| What you see | What to do |
|---|---|
| "needs a token" | The password was refused. For Gmail and Yandex, check it is an app password and not the account password |
| "failed", the text mentions a certificate | The system does not trust the server's certificate. For your own server, issue a real one |
| "failed", the text mentions the connection | Wrong address or port, or the server is unreachable. Check the address has no `https://` |
| An error on **the folder** field | There is no such folder on the server. Write the name as the server names it |
| The source works, no mail arrives | Check that mail arrives in that exact folder, and that the message came after the source was set up |
| No cards, though the mailbox is full | That is by design: only mail that arrives after the setup is brought over |
| Mail stopped arriving after the folder was recreated on the server | The source starts counting again — from that moment, as at setup |
