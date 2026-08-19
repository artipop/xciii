# Working as a team

A board normally belongs to one person: the app never asks who you are, and
whoever opens it sees everything. The **«Работа командой»** section of the
settings window switches the install into the other mode — accounts, a password
to log in with, and an invitation link for the second person.

## What changes

- everybody who opens the board logs in under their own name;
- cards are assigned to people by name, in the same field agents are assigned in;
- terminals, agents and the machine's settings are reachable only once logged in.

This says **who** may open the board, not where it is visible from. A second
device still comes in through the tailnet («Доступ с телефона»), and the two are
unrelated: a team does not publish the board anywhere, and the tailnet creates no
accounts.

## Turning it on

1. Open **Настройки → «Работа командой»**.
2. Fill in a **username** and a **password** (at least six characters). This is
   your own account — the one you have been working under all along: every
   board, folder and assignment stays yours, and nothing is moved.
3. Press **«Работать командой»**.
4. **Restart the app.** Until you do, the section keeps saying
   «Перезапустите приложение…»: the mode is written down, but the board server
   is still running in the old one.

After the restart the app opens on the login page.

## Inviting somebody

The section grows a line — **«Отправьте это тому, кто присоединяется»** — with a
link of the form `…/register?t=…`. Copy it with **«Скопировать»** and send it
however you like. They open it, pick a username and a password, and land on
whichever boards you add them to.

Without such a link nobody can register.

**«Новая ссылка»** issues a different one and retires the old. That is how a
link sent to the wrong person is taken back.

A new person sees no boards to begin with: access to a board is membership of
it, and members are added on the board itself.

## Going back to one person

**«Вернуться к одному человеку»**, then restart. The accounts and everything
made stay exactly where they are — the app simply stops asking who arrived and
opens the board straight away.

## A forgotten password

There is nothing to recover it with: the app knows no mail server and sends no
letters. A password is changed by whoever is logged in, on the change-password
page. So while you are the only person on the install you can always go back to
one person and turn the mode on again; an invited person who forgets theirs has
to be set up afresh, with a new link and a new name.
