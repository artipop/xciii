# Agents: adapters, npx and Node.js

Claude and Codex do not speak ACP themselves — between the app and their CLIs
stands an **adapter**, published on npm:
`@agentclientprotocol/claude-agent-acp` and `@agentclientprotocol/codex-acp`.
That is why these two kinds need **Node.js** on the machine. Antigravity,
GitHub Copilot and JetBrains Junie speak ACP themselves and need no adapter;
the "ACP (other)" kind is launched by whatever you put in the "Launch command
(argv)" field.

## Installing the adapter

You do not have to install the adapter in advance: if it is missing but `npx`
is present, the app launches the adapter through it. Under the "Kind" field in
the "Agents" section there is then a line like:

> `codex-acp` is not installed — it will run through npx (the first run takes
> longer)

The first run downloads the package from the network; after that it comes from
the npm cache. The **"Install adapter"** button next to it does the same as

```bash
npm install -g @agentclientprotocol/codex-acp
```

While installing, the button reads "Installing…"; when done — "Adapter
installed: …". After installation the line under "Kind" disappears.

If neither the adapter nor `npx` was found, the line is red and says what is
missing:

> neither `codex-acp` nor `npx` was found — install Node.js and run
> `npm install -g @agentclientprotocol/codex-acp`

## Where the app looks for `npx` and the CLIs

An app started from Finder or the Dock does not inherit your PATH: macOS gives
it only `/usr/bin:/bin:/usr/sbin:/sbin`. So at startup the app asks your login
shell (the one in `$SHELL`) for its PATH once, as if you had opened a
terminal, — and searches there. This is also the answer to "why does the
terminal have `npx` but the app cannot see it".

The search order:

1. **"Binary path"** and **"Launch command (argv)"** on the agent itself — if
   filled in, they are used and nothing is guessed;
2. **your shell's PATH** — the same thing `which npx` prints in a terminal.
   Version managers (nvm, fnm, mise, asdf, volta) land here if they are hooked
   up in `~/.zshrc`, `~/.bashrc` or `~/.zprofile`;
3. if the shell could not be asked — **`~/.local/bin`, `/opt/homebrew/bin`,
   `/usr/local/bin`**, the usual install locations.

What the app will not find:

- **a node that lives in one directory only** — `direnv`, `mise` or an
  `.nvmrc` giving a version only inside the project folder. The app asks the
  shell outside your project, so it sees the default version only: make it
  global (`nvm alias default …`) or fill in "Binary path";
- **a PATH added by the terminal rather than the shell** — an iTerm profile or
  a VS Code setting. The login shell has no such PATH even though the terminal
  window works; move the line into `~/.zshrc`;
- **the PATH of a shell that does not answer** — `$SHELL` is unset, the shell
  does not understand `-ilc`, or the rc file takes more than ten seconds. Then
  only the three directories of point 3 remain.

After changing your PATH, restart the app: the shell is asked once, at
startup.

The same applies to [the terminal with an agent](../agent.md): it launches the
CLI itself (`claude`, `codex`) rather than an adapter, and looks for it in the
same places. Windows does not have this problem — there the app gets your
whole environment.
