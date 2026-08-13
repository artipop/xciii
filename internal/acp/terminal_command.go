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
// than an adapter), the flags that continue the last conversation in this
// directory when we are resuming one, and — when the terminal has tools of ours
// to offer — the kind's own way of taking a file of MCP servers.
//
// Nothing else is passed. A model, a mode, a system prompt — everything an ACP
// session negotiates over the protocol — is the CLI's own business here,
// configured the way its user configured it, and guessing another agent's flags
// is how a terminal would fail to open at all. The MCP flag is not a guess: it
// is a column of the same table that already knows which binary to run, and a
// kind that has not filled it in gets no flag and no tools.
// prompt is the first message of the conversation, for a terminal a stage of a
// route opened rather than a person. It is taken only when the CLI is starting a
// conversation of its own — a resumed one already has a transcript, and putting a
// task on that command line is a flag combination no vendor documents. The
// second return value says whether it was taken; when it was not, the caller
// pastes the task in once the CLI has settled (deliverPrompt).
func terminalCommand(a AgentEntry, resume bool, mcpConfig, prompt string) ([]string, bool, error) {
	// An explicit argv is the whole command, exactly as Command is for ACP:
	// with it set nothing of ours is appended, resume flags included, since we
	// cannot know whether a wrapper would pass them on.
	if len(a.TerminalCommand) > 0 {
		return append([]string(nil), a.TerminalCommand...), false, nil
	}
	adapter, known := acpNative[a.Kind]
	if !known {
		// The generic kind is an argv somebody wrote for ACP-over-stdio; the
		// same argv would put the CLI back into a mode with no terminal in it.
		return nil, false, fmt.Errorf("для агента %q (kind %q) не известен интерактивный CLI — укажите terminalCommand или возьмите kind claude, codex, antigravity, copilot или junie", a.Name, a.Kind)
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
	if mcpConfig != "" && adapter.cliMCPArgs != nil {
		argv = append(argv, adapter.cliMCPArgs(mcpConfig)...)
	}
	// The entry's CLI arguments are arguments for the vendor CLI, and here the
	// vendor CLI is what is being started — no adapter in between to hand them
	// to (clihandoff.go). Remote Control is why this field exists, and a stage
	// that now runs as a terminal would otherwise quietly lose it.
	argv = append(argv, a.CLIArgs...)
	if prompt != "" && !resume && adapter.cliPromptArgs != nil {
		return append(argv, adapter.cliPromptArgs(prompt)...), true, nil
	}
	return argv, false, nil
}

// terminalTakesMCP reports whether this entry's terminal can be handed tools of
// ours at all — the caller asks before minting a grant nobody would use.
func terminalTakesMCP(a AgentEntry) bool {
	if len(a.TerminalCommand) > 0 {
		return false
	}
	return acpNative[a.Kind].cliMCPArgs != nil
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
	if landed := workLanded(ctx, t); landed != "" {
		b.WriteString("\n")
		b.WriteString(landed)
	}
	return strings.TrimSpace(b.String())
}

// workLanded is what the conversation left behind: the branch, the commits it
// added and what is still uncommitted. Separate from the report above because a
// stage of a route says the same thing under a heading of its own
// (stageComment) — the facts are the conversation's, the heading is the
// caller's.
func workLanded(ctx context.Context, t *TerminalSession) string {
	var b strings.Builder
	if t.Branch != "" {
		fmt.Fprintf(&b, "Ветка: `%s`", t.Branch)
	}

	commits := gitLines(ctx, t.Cwd, "log", "--oneline", "--no-decorate", t.startSHA+"..HEAD")
	switch {
	case t.startSHA == "":
		// A folder with no commits yet, or one git would not talk about.
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
