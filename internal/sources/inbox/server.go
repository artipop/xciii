// Package inbox is the MCP server an agent source files through: one tool,
// `file_item`, which posts to that source's own ingest route.
//
// It exists so that an agent bringing things in cannot write to the board. Everything
// it finds goes down the pipeline every other source goes down — the rules,
// «Входящие», the event log, and the (source, external id, version) key that
// makes filing the same thing twice a no-op. The agent is therefore allowed to
// be dumb: the prompt tells it to file everything it sees rather than to work
// out what is new, because deciding that is what it would get wrong and the
// pipeline already knows.
//
// The address, the source name and the token arrive in the environment rather
// than as tool arguments, for the reason the dokku server's target does: the
// model picks what to file, never where.
package inbox

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// ServerName is how the tool appears to an agent: mcp__inbox__file_item.
const ServerName = "inbox"

// version tracks the tool surface, not the app.
const version = "0.1.0"

const instructions = `The tool that files what you found into «Входящие», the inbox.
File everything you found, even when it looks like it has been brought in before:
repeats are dropped by the (id, version) pair on the application's side. Take the
identifier from the service itself and never invent one — an invented id means a
new card on every poll.`

// Config is what the process is given.
type Config struct {
	// BaseURL is the front door this app is served on, Source is which source
	// is filing, and Token is that source's ingest token.
	BaseURL string
	Source  string
	Token   string
}

// Validate refuses a configuration that could not file anything.
func (c Config) Validate() (Config, error) {
	c.BaseURL = strings.TrimSuffix(strings.TrimSpace(c.BaseURL), "/")
	c.Source = strings.TrimSpace(c.Source)
	c.Token = strings.TrimSpace(c.Token)
	switch {
	case c.BaseURL == "":
		return c, fmt.Errorf("не задан адрес приёма")
	case c.Source == "":
		return c, fmt.Errorf("не задано имя источника")
	case c.Token == "":
		return c, fmt.Errorf("не задан токен источника")
	}
	return c, nil
}

// ingestURL is where one item is posted. The source is named in a person's own
// words, and those are usually Russian, so the segment is escaped.
func (c Config) ingestURL() string {
	return c.BaseURL + "/sources/ingest/" + url.PathEscape(c.Source)
}

// fileInput is one thing found. The field descriptions are the contract with
// the model, so they say the two things that actually go wrong.
type fileInput struct {
	ID      string            `json:"id" jsonschema:"the record's identifier in the service itself, exactly as written there; never invent one"`
	Version string            `json:"version,omitempty" jsonschema:"whatever changes along with the record (updated, etag, a hash); empty when there is no such field"`
	Title   string            `json:"title" jsonschema:"the title of the card this becomes"`
	Body    string            `json:"body,omitempty" jsonschema:"the description, in markdown"`
	URL     string            `json:"url,omitempty" jsonschema:"a link to the record in the service"`
	Props   map[string]string `json:"props,omitempty" jsonschema:"the card's properties by name, for example {\"Ссылка\": \"…\"}"`
	Labels  []string          `json:"labels,omitempty" jsonschema:"the record's labels; the source's rules may fire on them"`
}

// NewServer builds the server. client is left injectable so the tests can drive
// it against a real ingest route without a process.
func NewServer(cfg Config, client *http.Client) *mcp.Server {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	srv := mcp.NewServer(
		&mcp.Implementation{Name: ServerName, Title: "Входящие XCIII", Version: version},
		&mcp.ServerOptions{Instructions: instructions},
	)

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "file_item",
		Description: "File what you found into «Входящие», the inbox. Repeats are safe: the same (id, version) pair does not create a second card.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in fileInput) (*mcp.CallToolResult, any, error) {
		if strings.TrimSpace(in.Title) == "" && strings.TrimSpace(in.URL) == "" {
			return errorResult("there is nothing to file: neither a title nor a link"), nil, nil
		}
		result, err := file(ctx, client, cfg, in)
		if err != nil {
			// Returned as a tool error rather than as a protocol one: the model
			// is meant to read it and try the next item, not to stop.
			return errorResult("could not file it: %v", err), nil, nil
		}
		return textResult(result), nil, nil
	})
	return srv
}

// ServeStdio runs the server on stdio, which is how an agent starts it.
func ServeStdio(ctx context.Context, cfg Config) error {
	valid, err := cfg.Validate()
	if err != nil {
		return err
	}
	return NewServer(valid, nil).Run(ctx, &mcp.StdioTransport{})
}

// file posts one item and reports what the pipeline made of it, in the words a
// person would use — the model repeats this back at the end of its turn, and
// "already brought in" is the answer that keeps it from trying again.
func file(ctx context.Context, client *http.Client, cfg Config, in fileInput) (string, error) {
	body, err := json.Marshal(map[string]any{
		"v":       1,
		"id":      in.ID,
		"version": in.Version,
		"title":   in.Title,
		"body":    in.Body,
		"url":     in.URL,
		"props":   in.Props,
		"labels":  in.Labels,
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.ingestURL(), bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.Token)

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	answer, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("the ingest route answered %d: %s", resp.StatusCode, strings.TrimSpace(string(answer)))
	}

	var res struct {
		Created   int `json:"created"`
		Commented int `json:"commented"`
		Dropped   int `json:"dropped"`
		Skipped   int `json:"skipped"`
		Failed    int `json:"failed"`
	}
	if err := json.Unmarshal(answer, &res); err != nil {
		return "filed", nil
	}
	switch {
	case res.Created > 0:
		return "a card was created", nil
	case res.Commented > 0:
		return "the record changed, the card was commented on", nil
	case res.Skipped > 0:
		return "already brought in, nothing changed", nil
	case res.Dropped > 0:
		return "dropped by the source's rule", nil
	default:
		return "not filed: " + strings.TrimSpace(string(answer)), nil
	}
}

func textResult(text string) *mcp.CallToolResult {
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}
}

func errorResult(format string, args ...any) *mcp.CallToolResult {
	return &mcp.CallToolResult{
		IsError: true,
		Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf(format, args...)}},
	}
}
