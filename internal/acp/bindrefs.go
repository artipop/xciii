package acp

import "strings"

// Binding a board's automation to registry ids.
//
// This is for data the app does not insert: columns and routes live in the
// board's JSON, written by a template, by another machine, or by an older
// version, so there is no write that could have handed out an id. Everything
// here runs once, where a board is read (boardseed.go), and what it resolves is
// written back to the board.
//
// An unresolvable name is left alone rather than cleared: a board from another
// machine names a target registered there, and erasing it would turn "register
// this target" into "set this column up again from memory". validateColumn
// then refuses it, which is what routes the column into rememberUnadopted.

// bindColumnRefs folds a column's legacy name references into ids. It reports
// whether anything changed, which is what tells the caller the board is worth
// writing back.
func bindColumnRefs(c *ColumnSpec, agents []AgentEntry, deploys []DeployEntry) bool {
	changed := false
	if id, ok := bindDeploy(c.DeployID, c.DeployName, deploys); ok {
		c.DeployID, c.DeployName = id, ""
		changed = true
	}
	// Assigned whether or not anything resolved: what could not be folded has
	// to end up in the name field, which is where the caller looks for it.
	ids, kept, folded := bindCrew(c.AgentIDs, c.Agents, agents)
	c.AgentIDs, c.Agents = ids, kept
	changed = changed || folded
	return changed
}

// bindFlowRefs folds a route's legacy name references into ids, stage by stage.
func bindFlowRefs(f *FlowEntry, agents []AgentEntry, deploys []DeployEntry) bool {
	changed := false
	for i := range f.Nodes {
		n := &f.Nodes[i]
		if id, ok := bindDeploy(n.DeployID, n.DeployName, deploys); ok {
			n.DeployID, n.DeployName = id, ""
			changed = true
		}
		// The singular field is folded into the plural one first, so a stage
		// written either way arrives here as one list to bind.
		names := n.AgentNames
		if n.AgentName != "" {
			names = append(append([]string(nil), names...), n.AgentName)
		}
		ids, kept, folded := bindCrew(n.AgentIDs, names, agents)
		n.AgentIDs, n.AgentNames, n.AgentName = ids, kept, ""
		changed = changed || folded
	}
	return changed
}

// bindDeploy answers with the id a legacy deploy name resolves to, and false
// when there is nothing to do — an id is already recorded, no name was written,
// or this machine has no such target and the name has to stay for whoever
// registers it.
func bindDeploy(id, name string, deploys []DeployEntry) (string, bool) {
	if strings.TrimSpace(id) != "" || strings.TrimSpace(name) == "" {
		return "", false
	}
	entry, ok := deployByName(deploys, name)
	if !ok {
		return "", false
	}
	return entry.ID, true
}

// deployByName finds a registry entry by the name a person typed. This is the
// last place a deploy target is looked up by name, and it exists only to stop
// looking one up by name: everything it resolves is written back as an id.
func deployByName(deploys []DeployEntry, name string) (DeployEntry, bool) {
	name = strings.TrimSpace(name)
	for _, d := range deploys {
		if strings.EqualFold(strings.TrimSpace(d.Name), name) {
			return d, true
		}
	}
	return DeployEntry{}, false
}

// bindAgentRefs folds an agent entry's legacy proxy name into a proxy id.
func bindAgentRefs(a *AgentEntry, proxies []ProxyEntry) bool {
	if strings.TrimSpace(a.ProxyID) != "" || strings.TrimSpace(a.ProxyName) == "" {
		return false
	}
	p, ok := proxyByName(proxies, a.ProxyName)
	if !ok {
		return false
	}
	a.ProxyID, a.ProxyName = p.ID, ""
	return true
}

// bindCrew folds a list of agent names into ids, keeping the order somebody
// listed them in — the crew is tried in that order, so it is a setting and not
// a set. A name this machine cannot resolve is kept, exactly as a deploy
// target's is.
func bindCrew(ids, names []string, agents []AgentEntry) (bound, kept []string, changed bool) {
	bound = ids
	for _, name := range names {
		// A blank is not a name: the editor's own empty row and a hand-edited
		// list both produce one, and refusing it would make an empty field an
		// error message about an agent called " ".
		if strings.TrimSpace(name) == "" {
			changed = true
			continue
		}
		a, ok := agentByName(agents, name)
		if !ok || a.ID == "" {
			// An entry with no id cannot be pointed at, so it is not an answer
			// to "who works here" even though the name matches something.
			kept = append(kept, name)
			continue
		}
		if !containsString(bound, a.ID) {
			bound = append(bound, a.ID)
		}
		changed = true
	}
	return bound, kept, changed
}

// crewNames turns a roster of ids into the names to show. A crew is stored by
// id and read by a person — or by a model, which is told the board in the
// vocabulary a person uses — so the two directions are separate on purpose. An
// id nothing answers to is dropped: it names an agent this machine has not got,
// and printing the id would say less than saying nothing.
func (m *Manager) crewNames(ids []string) []string {
	if len(ids) == 0 {
		return nil
	}
	m.cfgMu.RLock()
	agents := append([]AgentEntry(nil), m.cfg.Agents...)
	m.cfgMu.RUnlock()
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if a, ok := agentByID(agents, id); ok {
			out = append(out, a.Name)
		}
	}
	return out
}

// bindFlowWorkspace folds a route's legacy folder name into the registry id.
func bindFlowWorkspace(f *FlowEntry, workdirs []WorkdirEntry) bool {
	if strings.TrimSpace(f.WorkspaceID) != "" || strings.TrimSpace(f.WorkdirName) == "" {
		return false
	}
	w, ok := workdirNamed(workdirs, f.WorkdirName)
	if !ok {
		return false
	}
	f.WorkspaceID, f.WorkdirName = w.ID, ""
	return true
}

func workdirNamed(workdirs []WorkdirEntry, name string) (WorkdirEntry, bool) {
	name = strings.TrimSpace(name)
	for _, w := range workdirs {
		if strings.EqualFold(strings.TrimSpace(w.Name), name) {
			return w, true
		}
	}
	return WorkdirEntry{}, false
}

func workdirByID(workdirs []WorkdirEntry, id string) (WorkdirEntry, bool) {
	id = strings.TrimSpace(id)
	if id == "" {
		return WorkdirEntry{}, false
	}
	for _, w := range workdirs {
		if w.ID == id {
			return w, true
		}
	}
	return WorkdirEntry{}, false
}

func proxyByName(proxies []ProxyEntry, name string) (ProxyEntry, bool) {
	name = strings.TrimSpace(name)
	for _, p := range proxies {
		if strings.EqualFold(strings.TrimSpace(p.Name), name) {
			return p, true
		}
	}
	return ProxyEntry{}, false
}

func proxyByID(proxies []ProxyEntry, id string) (ProxyEntry, bool) {
	id = strings.TrimSpace(id)
	if id == "" {
		return ProxyEntry{}, false
	}
	for _, p := range proxies {
		if p.ID == id {
			return p, true
		}
	}
	return ProxyEntry{}, false
}

func agentByID(agents []AgentEntry, id string) (AgentEntry, bool) {
	id = strings.TrimSpace(id)
	if id == "" {
		return AgentEntry{}, false
	}
	for _, a := range agents {
		if a.ID == id {
			return a, true
		}
	}
	return AgentEntry{}, false
}

func agentByName(agents []AgentEntry, name string) (AgentEntry, bool) {
	name = strings.TrimSpace(name)
	for _, a := range agents {
		if sameAgentName(a.Name, name) {
			return a, true
		}
	}
	return AgentEntry{}, false
}

// deployByID finds a registry entry by id — how a column and a stage name their
// target now that binding has run.
func deployByID(deploys []DeployEntry, id string) (DeployEntry, bool) {
	id = strings.TrimSpace(id)
	if id == "" {
		return DeployEntry{}, false
	}
	for _, d := range deploys {
		if d.ID == id {
			return d, true
		}
	}
	return DeployEntry{}, false
}

// bindColumnOption gives a spec the option id it always meant. A spec written
// before columns carried ids knows the column's name and nothing else, and that
// name is what three separate places were still matching on (contradiction 5).
func bindColumnOption(c *ColumnSpec, boardID string, options []Column) bool {
	if c.OptionID != "" || len(options) == 0 {
		return false
	}
	opt, ok := optionNamed(options, c.Column)
	if !ok {
		return false
	}
	c.BoardID, c.PropertyID, c.OptionID = boardID, opt.PropertyID, opt.OptionID
	return true
}

// bindStageOptions is the same for every stage of a route.
func bindStageOptions(f *FlowEntry, options []Column) bool {
	changed := false
	for i := range f.Nodes {
		if f.Nodes[i].OptionID != "" {
			continue
		}
		if opt, ok := optionNamed(options, f.Nodes[i].Column); ok {
			f.Nodes[i].OptionID = opt.OptionID
			changed = true
		}
	}
	return changed
}

// optionNamed is the last place a column is found by its name, and it exists
// only to stop finding one that way: what it resolves is written back as an id.
func optionNamed(options []Column, name string) (Column, bool) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Column{}, false
	}
	for _, o := range options {
		if strings.EqualFold(strings.TrimSpace(o.Name), name) {
			return o, true
		}
	}
	return Column{}, false
}

// workdirForPath is the registry entry that lives at this path.
func workdirForPath(workdirs []WorkdirEntry, path string) (WorkdirEntry, bool) {
	if strings.TrimSpace(path) == "" {
		return WorkdirEntry{}, false
	}
	for _, w := range workdirs {
		if w.Path == path {
			return w, true
		}
	}
	return WorkdirEntry{}, false
}
