package dokku

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// ServerName is how the tools appear to an agent: mcp__dokku__deploy_branch etc.
const ServerName = "dokku"

// Environment the MCP process is configured through. Everything it may touch —
// which host, which project, which branch — arrives here rather than as tool
// arguments, so the model cannot point a deploy somewhere else.
const (
	EnvTarget = "XCIII_DOKKU_TARGET" // JSON Target
	EnvRepo   = "XCIII_DOKKU_REPO"   // local project the branch is pushed from
	EnvBranch = "XCIII_DOKKU_BRANCH" // default branch for tools that omit one
)

// version is reported to the client on initialize; it tracks the tool surface,
// not the app.
const version = "0.1.0"

// instructions tell the model what this server is for. They arrive with the
// tool list, before any prompt we write elsewhere.
const instructions = `Tools for deploying a branch to Dokku. One branch is one application,
served at «folder-branch.base-domain». The host, the key, the application name and
the domain are already set: the tools cannot override them, and the only thing you
choose is the branch. If a deploy fails, read app_logs — the build and application
output is there.`

// deployInput is shared by every tool: an explicit branch, or the session's own.
type deployInput struct {
	Branch string `json:"branch,omitempty" jsonschema:"a branch of the repository; the card's own branch by default"`
}

type logsInput struct {
	Branch string `json:"branch,omitempty" jsonschema:"a branch of the repository; the card's own branch by default"`
	Lines  int    `json:"lines,omitempty" jsonschema:"how many of the last log lines to return (200 by default)"`
}

type destroyInput struct {
	Branch  string `json:"branch,omitempty" jsonschema:"the branch whose preview to remove; the card's own branch by default"`
	Confirm bool   `json:"confirm" jsonschema:"confirmation of the removal; without it nothing happens"`
}

// NewServer builds the MCP server exposing cl's operations as tools. artifacts
// is where the deploy outcome is recorded for the session that spawned us; an
// empty path records nothing.
func NewServer(cl *Client, artifacts string) *mcp.Server {
	srv := mcp.NewServer(
		&mcp.Implementation{Name: ServerName, Title: "Dokku deploy", Version: version},
		&mcp.ServerOptions{Instructions: instructions},
	)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "deploy_branch",
		Description: "Deploy a branch to Dokku: create the application if it does not exist yet, give it a domain and push the branch. Returns the URL and the tail of the build log.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in deployInput) (*mcp.CallToolResult, any, error) {
		branch, err := cl.branch(ctx, in.Branch)
		if err != nil {
			return nil, nil, err
		}
		ctx, cancel := context.WithTimeout(ctx, cl.Target.Timeout())
		defer cancel()

		res, err := cl.Deploy(ctx, branch)
		recordOutcome(artifacts, res, branch, err)
		if err != nil {
			// The build log is the whole point of the failure report, so it goes
			// back to the model instead of a bare error string.
			return errorResult("The deploy failed: %v\n\n%s", err, logBlock(res.PushLog)), nil, nil
		}
		var b strings.Builder
		fmt.Fprintf(&b, "Branch `%s` deployed.\nURL: %s\nDokku application: %s", res.Branch, res.URL, res.App)
		if res.Created {
			b.WriteString("\n(this deploy created the application)")
		}
		for _, w := range res.Warnings {
			fmt.Fprintf(&b, "\n%s", w)
		}
		fmt.Fprintf(&b, "\n\n%s", logBlock(res.PushLog))
		return textResult(b.String()), nil, nil
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "deployment_status",
		Description: "The state of the branch application's processes on Dokku (dokku ps:report).",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in deployInput) (*mcp.CallToolResult, any, error) {
		branch, err := cl.branch(ctx, in.Branch)
		if err != nil {
			return nil, nil, err
		}
		out, err := cl.Status(ctx, AppSlug(branch))
		if err != nil {
			return errorResult("could not read the status: %v", err), nil, nil
		}
		return textResult(out), nil, nil
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "app_logs",
		Description: "The branch application's logs on Dokku: the build output and the running processes.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in logsInput) (*mcp.CallToolResult, any, error) {
		branch, err := cl.branch(ctx, in.Branch)
		if err != nil {
			return nil, nil, err
		}
		out, err := cl.Logs(ctx, AppSlug(branch), in.Lines)
		if err != nil {
			return errorResult("could not read the logs: %v", err), nil, nil
		}
		return textResult(out), nil, nil
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_deployments",
		Description: "The preview applications of this target on the Dokku host.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
		apps, err := cl.List(ctx)
		if err != nil {
			return errorResult("could not list the applications: %v", err), nil, nil
		}
		if len(apps) == 0 {
			return textResult("there are no preview applications"), nil, nil
		}
		return textResult(strings.Join(apps, "\n")), nil, nil
	})

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "destroy_deployment",
		Description: "Remove the branch's preview application from the Dokku host. Irreversible, requires confirm=true.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in destroyInput) (*mcp.CallToolResult, any, error) {
		if !in.Confirm {
			return errorResult("the removal is not confirmed: call again with confirm=true"), nil, nil
		}
		branch, err := cl.branch(ctx, in.Branch)
		if err != nil {
			return nil, nil, err
		}
		out, err := cl.Destroy(ctx, AppSlug(branch))
		if err != nil {
			return errorResult("could not remove the application: %v", err), nil, nil
		}
		return textResult(fmt.Sprintf("🗑 Application %s removed.\n%s", cl.Target.AppName(AppSlug(branch)), strings.TrimSpace(out))), nil, nil
	})

	return srv
}

// ServeStdio runs the MCP server on stdin/stdout until the client disconnects.
func ServeStdio(ctx context.Context, cl *Client, artifacts string) error {
	return NewServer(cl, artifacts).Run(ctx, &mcp.StdioTransport{})
}

// recordOutcome files what the attempt did. A failure to record is not worth
// failing the tool call over — the model already has the real answer — but it
// must not pass silently either, so it goes to stderr, which is the server's log.
func recordOutcome(dir string, res Result, branch string, deployErr error) {
	if dir == "" {
		return
	}
	o := Outcome{OK: deployErr == nil, App: res.App, Branch: res.Branch, URL: res.URL}
	if o.Branch == "" {
		o.Branch = branch
	}
	if deployErr != nil {
		o.Error = deployErr.Error()
	}
	if err := WriteOutcome(dir, o); err != nil {
		fmt.Fprintf(os.Stderr, "mcp dokku: не удалось записать %s: %v\n", OutcomeFile, err)
	}
}

// branch resolves the branch a tool call works on: the explicit argument, the
// branch the session was started for, or whatever the project has checked out.
func (c *Client) branch(ctx context.Context, explicit string) (string, error) {
	if b := strings.TrimSpace(explicit); b != "" {
		return b, nil
	}
	if c.Branch != "" {
		return c.Branch, nil
	}
	if c.Project == "" {
		return "", fmt.Errorf("no branch was given and there is nothing to work it out from — pass branch")
	}
	return CurrentBranch(ctx, c.Run, c.Project)
}

func textResult(text string) *mcp.CallToolResult {
	if strings.TrimSpace(text) == "" {
		text = "(empty answer)"
	}
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}
}

func errorResult(format string, args ...any) *mcp.CallToolResult {
	res := textResult(fmt.Sprintf(format, args...))
	res.IsError = true
	return res
}

func logBlock(log string) string {
	log = strings.TrimSpace(log)
	if log == "" {
		return "(the git push output is empty)"
	}
	return "--- git push ---\n" + log
}
