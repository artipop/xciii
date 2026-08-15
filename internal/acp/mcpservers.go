package acp

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"

	acpsdk "github.com/coder/acp-go-sdk"

	"github.com/artipop/xciii/internal/dokku"
)

// A session can offer its agent extra tools through MCP servers, and they come
// from three owners: ours — the dokku deploy server, this binary re-invoked as
// `<self> mcp <name>` and configured entirely through its environment, so the
// model picks steps but never targets — the agent's own registry entry, and the
// column the card landed in (ColumnSpec.MCPServers, columns.go), which is how
// one agent works «QA» with a browser and «В работе» without one.
//
// Every agent takes the same description by the same road: session/new, where
// the protocol has a field for them. That is one of the things the vendor
// adapters bought — the CLI-specific ways of declaring a server (a --mcp-config
// flag, a set of -c overrides) are gone along with the bridges that needed them.

// builtinMCPNames are the servers a session spawns itself, with per-session
// configuration the agent must not be able to supply: the deploy target, the
// folder and the branch arrive in the dokku server's environment, which is
// what leaves the model choosing the branch and nothing else. An agent's own
// entry may not take one of these names.
var builtinMCPNames = []string{dokku.ServerName}

// mcpServerSpec is one stdio MCP server offered to an agent.
type mcpServerSpec struct {
	Name    string
	Command string
	Args    []string
	Env     map[string]string
}

// sessionMCPServers returns the MCP servers a session runs with: the deploy
// server we spawn ourselves for a deploy column, plus whatever the agent
// carries of its own — which is what a test session drives the browser with.
func sessionMCPServers(s *Session, _ Config) ([]mcpServerSpec, error) {
	// What this run was handed comes first: the column's own tools (StageMCP), a
	// source's service and the tool it files through — none of which belongs to
	// the agent's registry entry, since the next column or source would want
	// different ones. First because a name that appears twice is answered by
	// the more specific owner: a column that names `playwright` means *its*
	// playwright, and one server per name is all the config file and
	// `session/new` can carry.
	specs := append([]mcpServerSpec(nil), s.extraMCP...)
	// Then the agent's own, which travel with every session it runs whatever
	// the column started it: they are part of how that agent works.
	specs = dedupeMCP(append(specs, agentMCPServers(s)...))
	if s.Deploy != nil {
		self, err := os.Executable()
		if err != nil {
			return nil, fmt.Errorf("не удалось определить путь к приложению для MCP-сервера: %w", err)
		}
		target, err := json.Marshal(s.Deploy.Target)
		if err != nil {
			return nil, fmt.Errorf("не удалось сериализовать цель деплоя: %w", err)
		}
		specs = append([]mcpServerSpec{{
			Name:    dokku.ServerName,
			Command: self,
			Args:    []string{"mcp", dokku.ServerName},
			Env: map[string]string{
				dokku.EnvTarget:    string(target),
				dokku.EnvRepo:      s.WorkdirPath,
				dokku.EnvBranch:    s.DeployBranch,
				dokku.EnvArtifacts: s.Artifacts,
			},
		}}, specs...)
	}
	if len(specs) > 0 {
		// Whoever configured a server — us or the user — consented to it being
		// launched, so the agent's "may I start MCP?" prompt is ours to answer.
		s.markMCPConfigured()
	}
	return specs, nil
}

// agentMCPServers turns the agent's registry entries into specs and records
// their tool prefixes on the session: wiring a server to an agent is consent to
// use it, and a card-triggered session has no console to ask.
func agentMCPServers(s *Session) []mcpServerSpec {
	if len(s.Agent.MCPServers) == 0 {
		return nil
	}
	// Sorted, because a map has no order and the agent's command line should
	// not change between two runs of the same configuration.
	names := make([]string, 0, len(s.Agent.MCPServers))
	for name := range s.Agent.MCPServers {
		names = append(names, name)
	}
	sort.Strings(names)

	specs := make([]mcpServerSpec, 0, len(names))
	for _, name := range names {
		srv := s.Agent.MCPServers[name]
		specs = append(specs, mcpServerSpec{
			Name:    name,
			Command: srv.Command,
			Args:    append([]string(nil), srv.Args...),
			Env:     srv.Env,
		})
		s.allowToolPrefix("mcp__" + name + "__")
	}
	return specs
}

// dedupeMCP keeps the first server of each name, which is what makes the order
// above a rule rather than an accident: the run's own answer wins over the
// agent's standing one.
func dedupeMCP(specs []mcpServerSpec) []mcpServerSpec {
	seen := make(map[string]bool, len(specs))
	out := specs[:0]
	for _, spec := range specs {
		key := strings.ToLower(spec.Name)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, spec)
	}
	return out
}

// stageMCPSpecs turns a column's or a stage's servers into specs. Sorted, for
// the same reason the agent's own are: a map has no order, and two runs of one
// configuration should hand the agent the same command line.
func stageMCPSpecs(servers MCPServerSet) []mcpServerSpec {
	if len(servers) == 0 {
		return nil
	}
	names := make([]string, 0, len(servers))
	for name := range servers {
		names = append(names, name)
	}
	sort.Strings(names)
	specs := make([]mcpServerSpec, 0, len(names))
	for _, name := range names {
		srv := servers[name]
		specs = append(specs, mcpServerSpec{
			Name:    name,
			Command: srv.Command,
			Args:    append([]string(nil), srv.Args...),
			Env:     srv.Env,
		})
	}
	return specs
}

// acpMCPServers renders the servers for session/new.
func acpMCPServers(specs []mcpServerSpec) []acpsdk.McpServer {
	servers := make([]acpsdk.McpServer, 0, len(specs))
	for _, s := range specs {
		env := make([]acpsdk.EnvVariable, 0, len(s.Env))
		for _, name := range sortedEnvNames(s.Env) {
			env = append(env, acpsdk.EnvVariable{Name: name, Value: s.Env[name]})
		}
		servers = append(servers, acpsdk.McpServer{Stdio: &acpsdk.McpServerStdio{
			Name:    s.Name,
			Command: s.Command,
			Args:    s.Args,
			Env:     env,
		}})
	}
	return servers
}

// sortedEnvNames keeps generated argv stable between runs (map order is not).
func sortedEnvNames(env map[string]string) []string {
	names := make([]string, 0, len(env))
	for k := range env {
		names = append(names, k)
	}
	sort.Strings(names)
	return names
}
