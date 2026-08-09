package sources

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"text/template"
	"time"

	"github.com/artipop/xciii/internal/sources/mcp"
	"github.com/artipop/xciii/internal/sources/plugin"
)

// An MCP server as a source.
//
// docs/sources.md §22 left this open — "probably an adapter plugin rather than
// a property of the protocol" — and what it turned into is smaller than that: a
// *manifest*. There is nothing to write per service. An MCP server already
// reaches the tracker or the mailbox; what it lacks is the one thing MCP does
// not have a word for, which tool is the feed and how to read a row of it. That
// is exactly what a manifest can say, so a new MCP source is a JSON entry and
// not a program:
//
//	{"name": "kaiten", "kind": "mcp",
//	 "command": "bun", "args": ["run", "kaiten/server.ts"],
//	 "mcp": {"tool": "list_my_cards",
//	         "arguments": {"boardId": "{{.Config.boardId}}"},
//	         "itemsAt": "cards",
//	         "item": {"id": "{{.id}}", "title": "{{.title}}", "url": "{{.url}}"}}}
//
// Everything after the mapping is the ordinary pipeline: rules decide, the
// unclaimed lands in «Входящие», and (source, external id, version) is what
// keeps the next poll from making the same card again.

// MCPSpec is how one MCP server is read as a feed.
type MCPSpec struct {
	// Tool is the one to call, and Arguments are what to call it with —
	// templated over the source entry, so a board id typed into the source
	// dialog reaches the tool as {{.Config.boardId}}.
	Tool      string            `json:"tool"`
	Arguments map[string]string `json:"arguments,omitempty"`

	// ItemsAt is where the list is inside what the tool returned, as a dotted
	// path: "cards", "data.items", or empty when the tool returns the array
	// itself. Named rather than guessed, because a tool that returns one object
	// with three arrays in it is the normal case and guessing would pick the
	// wrong one silently.
	ItemsAt string `json:"itemsAt,omitempty"`

	// Item maps one row onto an item. Every field is a text/template over the
	// row, the same language a rule's properties are written in.
	Item ItemTemplate `json:"item"`

	// Noisy says what an item that matched no rule does: dropped rather than
	// filed. It belongs to the feed, not to the person — a notification shade
	// is noisy whoever is reading it — which is why it is here and not only on
	// the entry.
	Noisy bool `json:"noisy,omitempty"`
}

// ItemTemplate is one row of a tool's answer, written as an item.
//
// It is deliberately the item's own fields and nothing more: a mapping language
// that could compute would be a program in a config file, and the thing being
// mapped is a row of JSON with names on it.
type ItemTemplate struct {
	ID      string            `json:"id"`
	Version string            `json:"version,omitempty"`
	Title   string            `json:"title"`
	Body    string            `json:"body,omitempty"`
	URL     string            `json:"url,omitempty"`
	At      string            `json:"at,omitempty"`
	Props   map[string]string `json:"props,omitempty"`
	Labels  []string          `json:"labels,omitempty"`
}

// Validate refuses a mapping that cannot produce an item worth having.
func (s MCPSpec) Validate() (MCPSpec, error) {
	s.Tool = strings.TrimSpace(s.Tool)
	if s.Tool == "" {
		return s, fmt.Errorf("не сказано, какой инструмент MCP-сервера читать (mcp.tool)")
	}
	s.ItemsAt = strings.TrimSpace(s.ItemsAt)
	s.Item.Title = strings.TrimSpace(s.Item.Title)
	if s.Item.Title == "" {
		return s, fmt.Errorf("инструмент %q: не сказано, что в записи заголовок (mcp.item.title)", s.Tool)
	}
	// The id may be left out — an item without one is identified by the hash of
	// what it says (Item.WithFallbackID), which is what every source with no
	// ids of its own gets. A version without an id, though, promises change
	// detection that cannot work: the pair is the key.
	s.Item.ID = strings.TrimSpace(s.Item.ID)
	s.Item.Version = strings.TrimSpace(s.Item.Version)
	if s.Item.ID == "" && s.Item.Version != "" {
		return s, fmt.Errorf("инструмент %q: версия без id ничего не опознаёт (mcp.item.id)", s.Tool)
	}
	return s, nil
}

// mcpConn is an MCP server behind the interface the runner polls. It is the
// whole of the bridge: the client speaks MCP, the mapping turns rows into
// items, and everything the runner does afterwards has no idea which of the two
// kinds of plugin it is talking to.
type mcpConn struct {
	client *mcp.Client
	spec   MCPSpec
	entry  SourceEntry
}

// dialMCP starts an MCP server for a source and checks, once, that the tool the
// manifest names is really there. Checked at dial rather than at the first poll
// because a manifest is typed by hand: "kaiten has no tool list_my_cards, it
// has get_card, get_columns…" is an answer, and a poll failing every five
// minutes is not.
func dialMCP(ctx context.Context, entry SourceEntry, manifest Manifest, cred plugin.Credentials, _ plugin.Handler) (conn, error) {
	spec, err := manifest.MCPOr().Validate()
	if err != nil {
		return nil, err
	}
	env := make([]string, 0, len(manifest.Env)+1)
	for k, v := range manifest.Env {
		env = append(env, k+"="+v)
	}
	// The credential is handed over the way an MCP server takes one: an
	// environment variable it names. There is nothing else — MCP has no place
	// for a token — which is also why the variable is named by the manifest and
	// not by us.
	if cred.AccessToken != "" && strings.TrimSpace(manifest.TokenEnv) != "" {
		env = append(env, strings.TrimSpace(manifest.TokenEnv)+"="+cred.AccessToken)
	}

	client, err := mcp.Dial(ctx, mcp.Spec{
		Command:    manifest.Argv(),
		Env:        env,
		ClientName: "XCIII",
	})
	if err != nil {
		return nil, err
	}
	tools, err := client.Tools(ctx)
	if err != nil {
		client.Close()
		return nil, err
	}
	if !hasTool(tools, spec.Tool) {
		client.Close()
		return nil, fmt.Errorf("у MCP-сервера %q нет инструмента %q (есть: %s)",
			manifest.Name, spec.Tool, strings.Join(toolNames(tools), ", "))
	}
	return &mcpConn{client: client, spec: spec, entry: entry}, nil
}

func hasTool(tools []mcp.Tool, name string) bool {
	for _, tool := range tools {
		if strings.EqualFold(tool.Name, name) {
			return true
		}
	}
	return false
}

func toolNames(tools []mcp.Tool) []string {
	out := make([]string, 0, len(tools))
	for _, tool := range tools {
		out = append(out, tool.Name)
	}
	return out
}

// Capabilities is what this bridge can do, and it is the same for every MCP
// server: it answers when asked and never volunteers. There is no cursor —
// nothing in MCP carries one — so the tool reports what it can see each time,
// and the (id, version) pair is what keeps that from becoming duplicates.
func (c *mcpConn) Capabilities() plugin.Capabilities {
	return plugin.Capabilities{Poll: true, Noisy: c.spec.Noisy}
}

func (c *mcpConn) Close() { c.client.Close() }

// Poll calls the tool and reads its answer as items.
func (c *mcpConn) Poll(ctx context.Context, _ string) (plugin.PollResult, error) {
	args, err := c.spec.renderArguments(c.entry)
	if err != nil {
		return plugin.PollResult{}, err
	}
	payload, err := c.client.CallTool(ctx, c.spec.Tool, args)
	if err != nil {
		return plugin.PollResult{}, err
	}
	rows, err := rowsAt(payload, c.spec.ItemsAt)
	if err != nil {
		return plugin.PollResult{}, fmt.Errorf("%s: %w", c.spec.Tool, err)
	}
	items := make([]json.RawMessage, 0, len(rows))
	for _, row := range rows {
		item, err := c.spec.Item.render(row)
		if err != nil {
			// One row that cannot be read costs that row. A feed of fifty with
			// one oddity in it is still forty-nine cards, and the alternative
			// is a source that stops on the first surprise.
			continue
		}
		items = append(items, item)
	}
	return plugin.PollResult{Items: items}, nil
}

// renderArguments expands the manifest's arguments over the source entry, so a
// value a person typed into the source dialog reaches the tool.
func (s MCPSpec) renderArguments(entry SourceEntry) (map[string]any, error) {
	out := make(map[string]any, len(s.Arguments))
	for name, tmpl := range s.Arguments {
		value, err := renderOver(tmpl, entry)
		if err != nil {
			return nil, fmt.Errorf("аргумент %q: %w", name, err)
		}
		if value = strings.TrimSpace(value); value == "" {
			// An argument that came out empty is one the person did not fill
			// in, and a tool asked for board "" answers for no board at all.
			continue
		}
		// Numbers arrive as strings from a form and a tool that declared a
		// number will refuse a string, so what looks like a number is sent as
		// one. Anything else is what it says.
		if n, err := strconv.ParseFloat(value, 64); err == nil && !strings.ContainsAny(value, " \t") {
			out[name] = n
			continue
		}
		out[name] = value
	}
	return out, nil
}

// render turns one row into the item JSON the pipeline reads. Both are JSON
// rather than a struct because that is what the runner is given by every other
// plugin, and one path through the decoder is one set of bugs.
func (t ItemTemplate) render(row any) (json.RawMessage, error) {
	item := Item{}
	fields := []struct {
		tmpl string
		into *string
	}{
		{t.ID, &item.ExternalID},
		{t.Version, &item.Version},
		{t.Title, &item.Title},
		{t.Body, &item.Body},
		{t.URL, &item.URL},
	}
	for _, field := range fields {
		value, err := renderOver(field.tmpl, row)
		if err != nil {
			return nil, err
		}
		*field.into = strings.TrimSpace(value)
	}
	if item.Title == "" {
		return nil, fmt.Errorf("в записи нет заголовка")
	}
	if t.At != "" {
		if at, err := renderOver(t.At, row); err == nil {
			if parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(at)); err == nil {
				item.At = parsed
			}
		}
	}
	for name, tmpl := range t.Props {
		value, err := renderOver(tmpl, row)
		if err != nil {
			continue
		}
		if value = strings.TrimSpace(value); value != "" {
			if item.Props == nil {
				item.Props = map[string]string{}
			}
			item.Props[name] = value
		}
	}
	for _, tmpl := range t.Labels {
		value, err := renderOver(tmpl, row)
		if err != nil {
			continue
		}
		for _, label := range strings.Split(value, ",") {
			if label = strings.TrimSpace(label); label != "" {
				item.Labels = append(item.Labels, label)
			}
		}
	}
	// The row itself is kept: the day the service changes shape, the only way
	// to find out what it now sends is to look at what it sent.
	if raw, err := json.Marshal(row); err == nil {
		item.Raw = raw
	}
	return json.Marshal(item)
}

// renderOver expands one template over a value. It is the rules' own renderer
// in every respect that matters — same language, same "a template that fails
// costs its field and not the item" — with one addition: a path that is not
// there renders empty rather than as Go's "<no value>", because a row of JSON
// from somebody else's service is *expected* to be missing fields.
func renderOver(text string, data any) (string, error) {
	if !strings.Contains(text, "{{") {
		return text, nil
	}
	t, err := template.New("mcp").Option("missingkey=zero").Parse(text)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, data); err != nil {
		return "", err
	}
	return strings.ReplaceAll(buf.String(), "<no value>", ""), nil
}

// rowsAt digs the list out of what the tool returned, following a dotted path.
// An answer that is a single object rather than a list is read as a list of
// one: a tool that returns "the card" is as useful a feed as one that returns
// "the cards", and refusing it would be pedantry.
func rowsAt(payload json.RawMessage, path string) ([]any, error) {
	var value any
	if err := json.Unmarshal(payload, &value); err != nil {
		return nil, err
	}
	for _, step := range strings.Split(path, ".") {
		if step = strings.TrimSpace(step); step == "" {
			continue
		}
		object, ok := value.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("по пути %q нет объекта", path)
		}
		value, ok = object[step]
		if !ok {
			return nil, fmt.Errorf("в ответе нет %q", path)
		}
	}
	switch rows := value.(type) {
	case []any:
		return rows, nil
	case map[string]any:
		return []any{rows}, nil
	case nil:
		return nil, nil
	default:
		return nil, fmt.Errorf("по пути %q не список записей", path)
	}
}
