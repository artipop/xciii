// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package acp

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// terminalCommand is the argv of the agent's interactive CLI: the binary from
// the kind's table (or the entry's own binPath, when that is the CLI rather
// than an adapter), plus the flags that continue the last conversation in this
// directory when we are resuming one.
//
// Nothing else is passed. A model, a mode, a system prompt — everything an ACP
// session negotiates over the protocol — is the CLI's own business here,
// configured the way its user configured it, and guessing another agent's flags
// is how a terminal would fail to open at all.
func terminalCommand(a AgentEntry, resume bool) ([]string, error) {
	// An explicit argv is the whole command, exactly as Command is for ACP:
	// with it set nothing of ours is appended, resume flags included, since we
	// cannot know whether a wrapper would pass them on.
	if len(a.TerminalCommand) > 0 {
		return append([]string(nil), a.TerminalCommand...), nil
	}
	adapter, known := acpNative[a.Kind]
	if !known {
		// The generic kind is an argv somebody wrote for ACP-over-stdio; the
		// same argv would put the CLI back into a mode with no terminal in it.
		return nil, fmt.Errorf("для агента %q (kind %q) не известен интерактивный CLI — укажите terminalCommand или возьмите kind claude, codex, antigravity, copilot или junie", a.Name, a.Kind)
	}
	bin := adapter.cliBin
	if bin == "" {
		bin = adapter.bin
	}
	// binPath names the CLI itself for a kind whose adapter *is* the CLI; for
	// claude and codex it names the vendor adapter, which is a different
	// program, so it is not what a terminal should run.
	if custom := strings.TrimSpace(a.BinPath); custom != "" && adapter.cliBin == "" {
		bin = custom
	}
	argv := []string{bin}
	if resume {
		argv = append(argv, adapter.cliResumeArgs...)
	}
	return argv, nil
}

// canResumeTerminal reports whether the kind can continue a conversation at
// all, which is what the UI offers "продолжить" for.
func canResumeTerminal(kind string) bool {
	return len(acpNative[kind].cliResumeArgs) > 0
}

// terminalCanResume is canResumeTerminal for an entry, which may have replaced
// the CLI with an argv of its own — and then we no longer know how to continue
// anything.
func terminalCanResume(a AgentEntry) bool {
	if len(a.TerminalCommand) > 0 {
		return false
	}
	return canResumeTerminal(a.Kind)
}

// environ is os.Environ, wrapped so a test can see what a terminal inherits.
var environ = os.Environ

// headSHA is the commit the terminal starts on, so the report at the end can
// say what was added rather than what exists.
func headSHA(ctx context.Context, dir string) string {
	cmd := exec.CommandContext(ctx, "git", "rev-parse", "HEAD")
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// terminalReport is what the card is told when a terminal closes: the commits
// the session made and how the files stand. This is the whole point of a
// terminal being ours rather than a window somebody opened themselves — the
// work lands on the card either way.
func terminalReport(ctx context.Context, t *TerminalSession) string {
	var b strings.Builder
	b.WriteString("Терминал агента ")
	b.WriteString(t.AgentName)
	if t.exitCode == 0 {
		b.WriteString(" закрыт.")
	} else {
		fmt.Fprintf(&b, " закрыт с кодом %d.", t.exitCode)
	}
	if t.Branch != "" {
		fmt.Fprintf(&b, "\nВетка: `%s`", t.Branch)
	}

	commits := gitLines(ctx, t.Cwd, "log", "--oneline", "--no-decorate", t.startSHA+"..HEAD")
	switch {
	case t.startSHA == "":
		// A repository with no commits yet, or one git would not talk about.
	case len(commits) == 0:
		b.WriteString("\n\nНовых коммитов нет.")
	default:
		fmt.Fprintf(&b, "\n\nКоммиты (%d):\n", len(commits))
		for _, line := range commits {
			b.WriteString("- `" + line + "`\n")
		}
	}
	if dirty := gitLines(ctx, t.Cwd, "status", "--porcelain"); len(dirty) > 0 {
		fmt.Fprintf(&b, "\nНезакоммиченных изменений: %d\n", len(dirty))
		for i, line := range dirty {
			if i == 20 {
				b.WriteString("- …\n")
				break
			}
			b.WriteString("- `" + line + "`\n")
		}
	}
	return strings.TrimSpace(b.String())
}

// gitLines runs git in dir and returns its non-empty output lines.
func gitLines(ctx context.Context, dir string, args ...string) []string {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	var lines []string
	for _, line := range strings.Split(string(out), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}
