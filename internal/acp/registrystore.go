package acp

import (
	"encoding/json"
	"time"
)

// The registries — folders, agents, proxies, deploy targets — as tables rather
// than as arrays in config.json (docs/store-plan.md, step 2).
//
// Why they moved: a settings file is a thing nothing can point at. A card named
// its folder by an id that happened to be written in that file, a column named
// its agent by the name a person typed, and a route's stage named a deploy
// target the same way — so renaming an agent broke the crew of every route on
// every board, silently, and moving a folder orphaned every checkout in it.
// Neither could be checked, because there is no constraint to check between a
// JSON array and a database.
//
// What is *not* here: the in-memory shape. Config still holds these entries as
// slices, because the flow engine reads them on every card move and a query per
// move is a query per drag. The table is the truth and the slice is the cache,
// which is the arrangement the board's own automation already has
// (persistBoardLocked in boardseed.go).

// SaveWorkspace writes one registry entry, inserting or replacing it by id.
func (s *Store) SaveWorkspace(e WorkdirEntry) error {
	if e.ID == "" {
		e.ID = newID()
	}
	_, err := s.exec(`INSERT INTO workspace
		(id, name, path, board_id, global, kind, base_branch, branch_prefix, created_at)
		VALUES (?,?,?,?,?,?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET
			name=excluded.name, path=excluded.path, board_id=excluded.board_id,
			global=excluded.global, kind=excluded.kind,
			base_branch=excluded.base_branch, branch_prefix=excluded.branch_prefix`,
		e.ID, e.Name, nullable(e.Path), nullable(e.BoardID), e.Global,
		nullable(e.Kind), nullable(e.BaseBranch), nullable(e.BranchPrefix),
		time.Now().UnixMilli())
	if err != nil {
		return err
	}
	return s.saveWorkspaceModes(e)
}

// saveWorkspaceModes replaces the per-board answers for one folder. Replaced
// rather than merged: the entry that arrives is the whole entry, and a mode
// somebody removed has to disappear.
func (s *Store) saveWorkspaceModes(e WorkdirEntry) error {
	if _, err := s.exec(`DELETE FROM workspace_board WHERE workspace_id=?`, e.ID); err != nil {
		return err
	}
	for boardID, mode := range e.Modes {
		if boardID == "" {
			continue
		}
		if _, err := s.exec(`INSERT INTO workspace_board (workspace_id, board_id, mode)
			VALUES (?,?,?) ON CONFLICT(workspace_id, board_id) DO UPDATE SET mode=excluded.mode`,
			e.ID, boardID, nullable(mode)); err != nil {
			return err
		}
	}
	return nil
}

// Workspaces is the whole registry, oldest first — the order entries were added
// in, which is the order every list on screen shows them in.
func (s *Store) Workspaces() ([]WorkdirEntry, error) {
	rows, err := s.query(`SELECT id, name, COALESCE(path,''), COALESCE(board_id,''), global,
		COALESCE(kind,''), COALESCE(base_branch,''), COALESCE(branch_prefix,'')
		FROM workspace ORDER BY created_at, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WorkdirEntry
	byID := map[string]int{}
	for rows.Next() {
		var e WorkdirEntry
		if err := rows.Scan(&e.ID, &e.Name, &e.Path, &e.BoardID, &e.Global,
			&e.Kind, &e.BaseBranch, &e.BranchPrefix); err != nil {
			return nil, err
		}
		byID[e.ID] = len(out)
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// The modes in one query rather than one per folder: this is read at
	// startup and on every folders dialog, and a registry has as many entries
	// as somebody has folders.
	modes, err := s.query(`SELECT workspace_id, board_id, COALESCE(mode,'') FROM workspace_board`)
	if err != nil {
		return nil, err
	}
	defer modes.Close()
	for modes.Next() {
		var workspaceID, boardID, mode string
		if err := modes.Scan(&workspaceID, &boardID, &mode); err != nil {
			return nil, err
		}
		i, ok := byID[workspaceID]
		if !ok {
			continue
		}
		if out[i].Modes == nil {
			out[i].Modes = map[string]string{}
		}
		out[i].Modes[boardID] = mode
	}
	return out, modes.Err()
}

// DeleteWorkspace removes a registry entry. A folder a card is still working in
// is refused by the foreign key from checkout once those are enforced; until
// then the caller checks, as it always has.
func (s *Store) DeleteWorkspace(id string) error {
	_, err := s.exec(`DELETE FROM workspace WHERE id=?`, id)
	return err
}

// SaveProxy writes one named network configuration, giving it an id if it
// arrived without one.
func (s *Store) SaveProxy(e ProxyEntry) (ProxyEntry, error) {
	if e.ID == "" {
		e.ID = newID()
	}
	_, err := s.exec(`INSERT INTO proxy (id, name, url, no_proxy, ca_cert, username, password, created_at)
		VALUES (?,?,?,?,?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET
			name=excluded.name, url=excluded.url, no_proxy=excluded.no_proxy,
			ca_cert=excluded.ca_cert, username=excluded.username, password=excluded.password`,
		e.ID, e.Name, nullable(e.Proxy), nullable(e.NoProxy), nullable(e.CACert),
		nullable(e.Username), nullable(e.Password), time.Now().UnixMilli())
	return e, err
}

// Proxies is the registry.
func (s *Store) Proxies() ([]ProxyEntry, error) {
	rows, err := s.query(`SELECT id, name, COALESCE(url,''), COALESCE(no_proxy,''),
		COALESCE(ca_cert,''), COALESCE(username,''), COALESCE(password,'')
		FROM proxy ORDER BY created_at, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ProxyEntry
	for rows.Next() {
		var e ProxyEntry
		if err := rows.Scan(&e.ID, &e.Name, &e.Proxy, &e.NoProxy, &e.CACert,
			&e.Username, &e.Password); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// DeleteProxy removes one. An agent pointing at it is set to no proxy by the
// key, which is the right answer: the agent still works, over the app's own
// network.
func (s *Store) DeleteProxy(id string) error {
	_, err := s.exec(`DELETE FROM proxy WHERE id=?`, id)
	return err
}

// agentSettings is everything about starting the agent's process. It is one
// JSON column rather than nine, because none of it is referred to by anything
// and none of it is joined on — it is configuration, and the shape a person
// pastes from a server's README has to survive being stored.
type agentSettings struct {
	Env             map[string]string `json:"env,omitempty"`
	Args            []string          `json:"args,omitempty"`
	CLIArgs         []string          `json:"cliArgs,omitempty"`
	Options         map[string]string `json:"options,omitempty"`
	AutoAllowTools  []string          `json:"autoAllowTools,omitempty"`
	Command         []string          `json:"command,omitempty"`
	TerminalCommand []string          `json:"terminalCommand,omitempty"`
	MCPServers      MCPServerSet      `json:"mcpServers,omitempty"`
	// ProxyName is kept for one version so an entry written before proxies had
	// ids can still find its configuration; proxy_id is what is read.
	ProxyName string `json:"proxyName,omitempty"`
}

// SaveAgent writes one registered agent. proxyID and userID may be empty: an
// agent need not go through a proxy, and it has no board account until one is
// made for it.
func (s *Store) SaveAgent(e AgentEntry, proxyID, userID string) (AgentEntry, error) {
	if e.ID == "" {
		e.ID = newID()
	}
	settings, err := json.Marshal(agentSettings{
		Env: e.Env, Args: e.Args, CLIArgs: e.CLIArgs, Options: e.Options,
		AutoAllowTools: e.AutoAllowTools, Command: e.Command,
		TerminalCommand: e.TerminalCommand, MCPServers: e.MCPServers,
		ProxyName: e.ProxyName,
	})
	if err != nil {
		return e, err
	}
	_, err = s.exec(`INSERT INTO agent
		(id, name, kind, user_id, proxy_id, bin_path, model, prompt, settings, created_at)
		VALUES (?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET
			name=excluded.name, kind=excluded.kind, user_id=excluded.user_id,
			proxy_id=excluded.proxy_id, bin_path=excluded.bin_path,
			model=excluded.model, prompt=excluded.prompt, settings=excluded.settings`,
		e.ID, e.Name, e.Kind, nullable(userID), nullable(proxyID),
		nullable(e.BinPath), nullable(e.Model), nullable(e.Prompt),
		string(settings), time.Now().UnixMilli())
	return e, err
}

// Agents is the registry.
func (s *Store) Agents() ([]AgentEntry, error) {
	rows, err := s.query(`SELECT id, name, kind, COALESCE(bin_path,''), COALESCE(model,''),
		COALESCE(prompt,''), COALESCE(settings,'')
		FROM agent ORDER BY created_at, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AgentEntry
	for rows.Next() {
		var e AgentEntry
		var settings string
		if err := rows.Scan(&e.ID, &e.Name, &e.Kind, &e.BinPath, &e.Model, &e.Prompt, &settings); err != nil {
			return nil, err
		}
		if settings != "" {
			var st agentSettings
			if err := json.Unmarshal([]byte(settings), &st); err != nil {
				return nil, err
			}
			e.Env, e.Args, e.CLIArgs, e.Options = st.Env, st.Args, st.CLIArgs, st.Options
			e.AutoAllowTools, e.Command, e.TerminalCommand = st.AutoAllowTools, st.Command, st.TerminalCommand
			e.MCPServers, e.ProxyName = st.MCPServers, st.ProxyName
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// DeleteAgent removes one. A conversation it held keeps its own record: the
// conversation happened, and the key that points at the agent is SET NULL.
func (s *Store) DeleteAgent(id string) error {
	_, err := s.exec(`DELETE FROM agent WHERE id=?`, id)
	return err
}

// SetAgentAccount records which board account is this agent's, by key rather
// than by their names happening to match.
func (s *Store) SetAgentAccount(agentID, userID string) error {
	_, err := s.exec(`UPDATE agent SET user_id=? WHERE id=?`, nullable(userID), agentID)
	return err
}

// SaveDeployTarget writes one named Dokku destination.
func (s *Store) SaveDeployTarget(e DeployEntry) (DeployEntry, error) {
	if e.ID == "" {
		e.ID = newID()
	}
	_, err := s.exec(`INSERT INTO deploy_target
		(id, name, ssh_host, ssh_user, ssh_port, ssh_key, base_app, base_domain, created_at)
		VALUES (?,?,?,?,?,?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET
			name=excluded.name, ssh_host=excluded.ssh_host, ssh_user=excluded.ssh_user,
			ssh_port=excluded.ssh_port, ssh_key=excluded.ssh_key,
			base_app=excluded.base_app, base_domain=excluded.base_domain`,
		e.ID, e.Name, e.SSHHost, nullable(e.SSHUser), nullableInt(e.SSHPort),
		nullable(e.SSHKey), nullable(e.BaseApp), nullable(e.BaseDomain),
		time.Now().UnixMilli())
	return e, err
}

// DeployTargets is the registry.
func (s *Store) DeployTargets() ([]DeployEntry, error) {
	rows, err := s.query(`SELECT id, name, ssh_host, COALESCE(ssh_user,''), COALESCE(ssh_port,0),
		COALESCE(ssh_key,''), COALESCE(base_app,''), COALESCE(base_domain,'')
		FROM deploy_target ORDER BY created_at, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DeployEntry
	for rows.Next() {
		var e DeployEntry
		if err := rows.Scan(&e.ID, &e.Name, &e.SSHHost, &e.SSHUser, &e.SSHPort,
			&e.SSHKey, &e.BaseApp, &e.BaseDomain); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// DeleteDeployTarget removes one.
func (s *Store) DeleteDeployTarget(id string) error {
	_, err := s.exec(`DELETE FROM deploy_target WHERE id=?`, id)
	return err
}

// nullableInt is `nullable` for a number that means "not set" when it is zero —
// a port nobody chose, where the default is the protocol's and not ours.
// (`nullable` itself lives in legacystore.go, which needed it first.)
func nullableInt(v int) any {
	if v == 0 {
		return nil
	}
	return v
}
