package acp

import "fmt"

// Getting the registries out of config.json and into the tables
// (docs/model-graph.md), and keeping them there.
//
// The arrangement is the one the board's automation already has: the table is
// where the registry lives, and Config holds the same entries as a slice
// because the flow engine reads them on every card move and a query per move
// would be a query per drag. Every edit goes through persistRegistriesLocked,
// so the two cannot drift.
//
// The settings file keeps its copy of the keys for one version. That is the
// rollback path and nothing more — a person who installs this build and then
// goes back to the previous one should find their folders where they left them.
// The version after this deletes them from the file.

// loadRegistriesLocked settles which side is the truth, once, at startup.
//
// A database that already holds registries wins outright: it is where edits
// have been going. An empty database with a populated settings file is the
// install that has just upgraded, and its file is carried in. An empty pair is
// a fresh install and there is nothing to do.
//
// Called with cfgMu held.
func (m *Manager) loadRegistriesLocked() error {
	if m.store == nil {
		return nil
	}

	workspaces, err := m.store.Workspaces()
	if err != nil {
		return fmt.Errorf("read the folder registry: %w", err)
	}
	agents, err := m.store.Agents()
	if err != nil {
		return fmt.Errorf("read the agent registry: %w", err)
	}
	proxies, err := m.store.Proxies()
	if err != nil {
		return fmt.Errorf("read the proxy registry: %w", err)
	}
	deploys, err := m.store.DeployTargets()
	if err != nil {
		return fmt.Errorf("read the deploy registry: %w", err)
	}

	if len(workspaces) == 0 && len(agents) == 0 && len(proxies) == 0 && len(deploys) == 0 {
		// Nothing has been written yet. Either this is a fresh install, in
		// which case the file is empty too and this writes nothing, or it is
		// the upgrade and the file is what there is.
		return m.persistRegistriesLocked()
	}

	m.cfg.Workdirs = workspaces
	m.cfg.Agents = agents
	m.cfg.Proxies = proxies
	m.cfg.Deploys = deploys
	// An agent saved before proxies had ids still names its configuration; fold
	// it once, here, so nothing downstream has to know the name was ever a way
	// of pointing at one.
	bound := false
	for i := range m.cfg.Agents {
		if bindAgentRefs(&m.cfg.Agents[i], m.cfg.Proxies) {
			bound = true
		}
	}
	if bound {
		return m.persistRegistriesLocked()
	}
	return nil
}

// persistRegistriesLocked writes the four registries through to their tables.
//
// The whole registry each time, not the entry that changed: these are a handful
// of rows written only when somebody edits the settings, and "save what is
// there now" cannot leave a half-applied edit behind the way a diff can. Rows
// that have gone from the slice are deleted, which is what makes removing a
// folder in the dialog remove it here.
//
// Called with cfgMu held.
func (m *Manager) persistRegistriesLocked() error {
	if m.store == nil {
		return nil
	}

	// The rows already there, by name. An entry that arrives without an id is
	// matched against them rather than inserted afresh — which is what carries
	// a registry written before ids existed, and what stops a caller who
	// rebuilt an entry from its fields silently creating a second one under a
	// name that is unique.
	//
	// This is the last thing the name is used for, and it is a transition: once
	// nothing rebuilds an entry without its id, the lookup answers nobody.
	existing, err := m.registryIDs()
	if err != nil {
		return err
	}
	adopt := func(table, name string, id *string) {
		if *id == "" {
			*id = existing[table][name]
		}
	}

	// Proxies first: an agent points at one, and a foreign key wants its target
	// to exist by the time it is written.
	proxyIDs := map[string]string{}
	takenProxy := map[string]bool{}
	for i := range m.cfg.Proxies {
		if !m.registrable("proxy", m.cfg.Proxies[i].Name, takenProxy) {
			continue
		}
		adopt("proxy", m.cfg.Proxies[i].Name, &m.cfg.Proxies[i].ID)
		saved, err := m.store.SaveProxy(m.cfg.Proxies[i])
		if err != nil {
			return fmt.Errorf("save the proxy %q: %w", m.cfg.Proxies[i].Name, err)
		}
		m.cfg.Proxies[i] = saved
		proxyIDs[saved.Name] = saved.ID
	}
	if err := m.pruneRegistry("proxy", proxyIDs, m.store.DeleteProxy); err != nil {
		return err
	}

	agentIDs := map[string]string{}
	takenAgent := map[string]bool{}
	for i := range m.cfg.Agents {
		if !m.registrable("agent", m.cfg.Agents[i].Name, takenAgent) {
			continue
		}
		adopt("agent", m.cfg.Agents[i].Name, &m.cfg.Agents[i].ID)
		// The account is still found by username here. Joining the two by key
		// is the other half of contradiction 2 and lands with the crews.
		saved, err := m.store.SaveAgent(m.cfg.Agents[i], proxyIDs[m.cfg.Agents[i].ProxyName], "")
		if err != nil {
			return fmt.Errorf("save the agent %q: %w", m.cfg.Agents[i].Name, err)
		}
		m.cfg.Agents[i] = saved
		agentIDs[saved.Name] = saved.ID
	}
	if err := m.pruneRegistry("agent", agentIDs, m.store.DeleteAgent); err != nil {
		return err
	}

	deployIDs := map[string]string{}
	takenDeploy := map[string]bool{}
	for i := range m.cfg.Deploys {
		if !m.registrable("deploy_target", m.cfg.Deploys[i].Name, takenDeploy) {
			continue
		}
		adopt("deploy_target", m.cfg.Deploys[i].Name, &m.cfg.Deploys[i].ID)
		saved, err := m.store.SaveDeployTarget(m.cfg.Deploys[i])
		if err != nil {
			return fmt.Errorf("save the deploy target %q: %w", m.cfg.Deploys[i].Name, err)
		}
		m.cfg.Deploys[i] = saved
		deployIDs[saved.Name] = saved.ID
	}
	if err := m.pruneRegistry("deploy_target", deployIDs, m.store.DeleteDeployTarget); err != nil {
		return err
	}

	workspaceIDs := map[string]string{}
	takenWorkspace := map[string]bool{}
	for i := range m.cfg.Workdirs {
		if !m.registrable("workspace", m.cfg.Workdirs[i].Name, takenWorkspace) {
			continue
		}
		adopt("workspace", m.cfg.Workdirs[i].Name, &m.cfg.Workdirs[i].ID)
		if m.cfg.Workdirs[i].ID == "" {
			m.cfg.Workdirs[i].ID = newID()
		}
		if err := m.store.SaveWorkspace(m.cfg.Workdirs[i]); err != nil {
			return fmt.Errorf("save the folder %q: %w", m.cfg.Workdirs[i].Name, err)
		}
		workspaceIDs[m.cfg.Workdirs[i].Name] = m.cfg.Workdirs[i].ID
	}
	return m.pruneRegistry("workspace", workspaceIDs, m.store.DeleteWorkspace)
}

// registrable reports whether an entry is one a person could ever pick, and
// remembers the names already taken.
//
// Both refusals exist because config.json is hand-edited on purpose (CLAUDE.md:
// "часть настроек агентов в окно не вынесена") and is never validated, so it can
// hold what the editor would have refused. A nameless entry is not a registry
// entry — nothing can name it, and every list on screen would show a blank row.
// A second entry under a name already taken is the ambiguity the whole registry
// is keyed against, and the table now says so with a unique index.
//
// Skipped and said out loud rather than refused: the alternative is an app that
// will not start because of one bad line in a file, which is the worst possible
// place to discover a typo.
func (m *Manager) registrable(kind, name string, taken map[string]bool) bool {
	if name == "" {
		m.log.Warn("acp: a registry entry with no name is ignored", "registry", kind)
		return false
	}
	if taken[name] {
		m.log.Warn("acp: two registry entries share a name; the second is ignored",
			"registry", kind, "name", name)
		return false
	}
	taken[name] = true
	return true
}

// registryIDs reads what each registry already holds, as table → name → id.
func (m *Manager) registryIDs() (map[string]map[string]string, error) {
	out := map[string]map[string]string{}
	for _, table := range []string{"proxy", "agent", "deploy_target", "workspace"} {
		rows, err := m.store.query(`SELECT name, id FROM ` + table)
		if err != nil {
			return nil, fmt.Errorf("read the %s registry: %w", table, err)
		}
		byName := map[string]string{}
		for rows.Next() {
			var name, id string
			if err := rows.Scan(&name, &id); err != nil {
				rows.Close()
				return nil, err
			}
			byName[name] = id
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
		out[table] = byName
	}
	return out, nil
}

// pruneRegistry deletes the rows of one registry that the slice no longer has.
//
// It is a read of the table rather than a record of what was removed, because
// the slice is the thing every dialog edits and it is edited in place: there is
// no single place a removal passes through that could be told.
func (m *Manager) pruneRegistry(table string, keep map[string]string, remove func(string) error) error {
	live := map[string]bool{}
	for _, id := range keep {
		live[id] = true
	}
	rows, err := m.store.query(`SELECT id FROM ` + table)
	if err != nil {
		return err
	}
	var gone []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		if !live[id] {
			gone = append(gone, id)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, id := range gone {
		if err := remove(id); err != nil {
			return fmt.Errorf("remove the %s that is no longer registered: %w", table, err)
		}
	}
	return nil
}
