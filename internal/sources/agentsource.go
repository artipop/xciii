package sources

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/artipop/xciii/internal/sources/plugin"
)

// A source an agent brings in.
//
// The mapping kind (mcpsource.go) is cheaper and deterministic, and it is the
// right answer whenever the service has a tool that returns a list. This one is
// for when it does not — a server whose only tools are `search` and `get`, an
// answer whose shape changes, a feed where "does this actually need me" is a
// judgement. The agent is given the service's MCP server and one tool of ours,
// and told what to look for.
//
// **It does not write to the board.** `file_item` posts to this source's own
// ingest route, so the whole pipeline is still in the way: rules, «Входящие»,
// the event log, and the (source, external id, version) key. That key is what
// makes an agent tolerable here at all — filing the same thing twice is a
// no-op, so the prompt tells it to file everything it sees rather than to work
// out what is new. Deciding what is new is exactly what it would get wrong, and
// the pipeline already knows.
//
// What it costs is a session per poll, so the schedule is the person's to set
// and the default is slower than a plugin's.

// AgentRunner runs one turn of an agent. It is an interface for the reason
// BoardWriter is one: this package must keep working with the agent integration
// switched off, and internal/acp is where agents live.
type AgentRunner interface {
	// RunForSource runs the prompt with the given MCP servers attached and
	// returns the agent's last message, which is only ever logged.
	RunForSource(ctx context.Context, run AgentRun) (string, error)
}

// AgentRun is one turn: which agent, where, what to ask, and what tools to
// hand it.
type AgentRun struct {
	Agent   string
	Dir     string
	Prompt  string
	Servers []AgentServer
}

// AgentServer is one MCP server offered to the agent for this run.
type AgentServer struct {
	Name    string
	Command string
	Args    []string
	Env     map[string]string
}

// SetAgentRunner supplies the way to run an agent. Without it an agent source
// says so instead of failing halfway.
func (m *Manager) SetAgentRunner(r AgentRunner) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.agents = r
}

func (m *Manager) agentRunner() AgentRunner {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.agents
}

// SetIngestURL records the address the front door serves this app under, which
// is where the agent's `file_item` posts. Without it an agent source cannot
// run: there would be nowhere to file to.
func (m *Manager) SetIngestURL(base string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ingestURL = strings.TrimSuffix(strings.TrimSpace(base), "/")
}

func (m *Manager) ingestBase() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.ingestURL
}

// InboxServerName is what the tool-filing server is called on the agent's side.
// Its tools arrive prefixed with it, which is how they are allowed without
// allowing everything else the agent can reach.
const InboxServerName = "inbox"

// Environment the `<self> mcp inbox` server reads. It takes the address and the
// token rather than finding them, so the agent's own process has no way to
// reach anything else this app serves.
const (
	EnvInboxURL    = "XCIII_INBOX_URL"
	EnvInboxSource = "XCIII_INBOX_SOURCE"
	EnvInboxToken  = "XCIII_INBOX_TOKEN"
)

// agentConn is an agent behind the interface the runner polls. Poll runs one
// turn and returns nothing: what the agent found arrives through the ingest
// route while the turn is still running, which is the same path a phone uses.
type agentConn struct {
	mgr      *Manager
	entry    SourceEntry
	manifest Manifest
	spec     AgentSpec
}

// agentPollTimeout bounds one turn. Far longer than a plugin's poll, because a
// turn is a conversation with a model and a tool call to somebody's API — and
// still bounded, because a session that never ends would hold the source for
// ever.
const agentPollTimeout = 10 * time.Minute

// newAgentConn is the real dialler, closing over the manager because everything
// this kind of source needs — the agent runner, the ingest address, a token —
// belongs to the app rather than to the manifest.
func (m *Manager) newAgentConn(entry SourceEntry, manifest Manifest) (conn, error) {
	spec, err := manifest.AgentOr().Validate()
	if err != nil {
		return nil, err
	}
	if m.agentRunner() == nil {
		return nil, fmt.Errorf("интеграция агента выключена, а источник %q читается агентом", entry.Name)
	}
	if m.ingestBase() == "" {
		return nil, fmt.Errorf("неизвестен адрес приёма, некуда складывать найденное")
	}
	return &agentConn{mgr: m, entry: entry, manifest: manifest, spec: spec}, nil
}

// Capabilities: it answers when asked, like the mapping kind. Noisy stays off —
// an agent that was told what to look for has already filtered, and dropping
// what it did bring would waste the turn that found it.
func (c *agentConn) Capabilities() plugin.Capabilities {
	return plugin.Capabilities{Poll: true}
}

func (c *agentConn) Close() {}

// PollTimeout is how long the runner gives one turn. A conversation with a
// model does not fit in a plugin's two minutes.
func (c *agentConn) PollTimeout() time.Duration { return agentPollTimeout }

// Poll runs one turn. It returns no items on purpose: the agent files what it
// finds through the ingest route as it goes, so items arrive one at a time and
// are already through the pipeline by the time this returns.
func (c *agentConn) Poll(ctx context.Context, _ string) (plugin.PollResult, error) {
	runner := c.mgr.agentRunner()
	if runner == nil {
		return plugin.PollResult{}, fmt.Errorf("интеграция агента выключена")
	}
	// A fresh token per turn, and only for the length of it: the agent's own
	// process is handed the plaintext, so the shorter it is good for the
	// better. Nothing else feeds this source, so nothing else is locked out.
	token, err := c.mgr.IssueToken(c.entry.Name)
	if err != nil {
		return plugin.PollResult{}, fmt.Errorf("не удалось выдать токен приёма: %w", err)
	}
	self, err := os.Executable()
	if err != nil {
		return plugin.PollResult{}, fmt.Errorf("не удалось найти путь к приложению: %w", err)
	}

	servers := []AgentServer{{
		// Ours: the only way this agent can write anything anywhere.
		Name:    InboxServerName,
		Command: self,
		Args:    []string{"mcp", InboxServerName},
		Env: map[string]string{
			EnvInboxURL:    c.mgr.ingestBase(),
			EnvInboxSource: c.entry.Name,
			EnvInboxToken:  token,
		},
	}}
	if strings.TrimSpace(c.manifest.Command) != "" {
		// The service's own server, exactly as the mapping kind would start it.
		env, err := c.manifest.RenderEnv(c.entry)
		if err != nil {
			return plugin.PollResult{}, err
		}
		if tokenEnv := strings.TrimSpace(c.manifest.TokenEnv); tokenEnv != "" {
			if cred, ok := c.mgr.refreshedToken(ctx, c.entry); ok && cred.Access != "" {
				env[tokenEnv] = cred.Access
			}
		}
		servers = append(servers, AgentServer{
			Name:    c.manifest.Name,
			Command: c.manifest.Command,
			Args:    c.manifest.Args,
			Env:     env,
		})
	}

	dir := strings.TrimSpace(c.spec.Dir)
	if dir == "" {
		// Nothing to be in: this agent reads a service and files cards, and a
		// scratch directory keeps it from starting in whatever the app's
		// working directory happens to be.
		dir = os.TempDir()
	}
	_, err = runner.RunForSource(ctx, AgentRun{
		Agent:   c.spec.Agent,
		Dir:     dir,
		Prompt:  c.prompt(),
		Servers: servers,
	})
	return plugin.PollResult{}, err
}

// prompt is the standing instructions plus what the person asked for.
//
// The standing half is short and says the two things an agent gets wrong here:
// file everything rather than deciding what is new (the pipeline deduplicates,
// and it is right), and never invent an id — a made-up one turns every poll
// into a new card.
func (c *agentConn) prompt() string {
	var b strings.Builder
	b.WriteString("Ты приносишь входящие. Задача — найти в сервисе то, что описано ниже, ")
	b.WriteString("и на каждую находку вызвать инструмент ")
	b.WriteString(InboxServerName)
	b.WriteString("/file_item. Правила, которые важнее удобства:\n\n")
	b.WriteString("1. Складывай всё, что нашёл, даже если кажется, что это уже было: ")
	b.WriteString("повторы отсекаются на нашей стороне по паре (id, version), и это надёжнее, чем твоя догадка.\n")
	b.WriteString("2. `id` — это идентификатор записи в самом сервисе, как он там записан. ")
	b.WriteString("Никогда не придумывай его: выдуманный id — это новая карточка на каждый опрос.\n")
	b.WriteString("3. `version` — то, что меняется вместе с записью (updated, etag, хэш). ")
	b.WriteString("Если такого поля нет, оставь пустым.\n")
	b.WriteString("4. Ничего не меняй в сервисе. Твои инструменты там — только для чтения, ")
	b.WriteString("даже если доступны другие.\n")
	b.WriteString("5. Ответ в конце — одна строка: сколько нашёл и сколько сложил.\n\n")
	if len(c.entry.Config) > 0 {
		b.WriteString("Настройки источника:\n")
		for key, value := range c.entry.Config {
			if strings.TrimSpace(value) == "" {
				continue
			}
			b.WriteString("- ")
			b.WriteString(key)
			b.WriteString(": ")
			b.WriteString(value)
			b.WriteString("\n")
		}
		b.WriteString("\n")
	}
	b.WriteString("Что искать:\n")
	b.WriteString(c.spec.Task)
	return b.String()
}
