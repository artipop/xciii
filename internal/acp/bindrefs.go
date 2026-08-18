package acp

import "strings"

// Binding a board's automation to the ids it should have been written with.
//
// A column's crew, a stage's deploy target and a route's folder were all
// written as *names* — the string a person typed into the editor — and a name
// is the one part of a registry entry somebody is entitled to change. Renaming
// a deploy target unpinned every column that sent work to it, silently, because
// nothing can check a name against a name (docs/model-graph.md).
//
// The entries have had ids since the registries became tables, so the fix is
// not to invent an identity but to start using the one that is already there.
// That leaves the automation already written on boards, which travels with the
// board and its templates and cannot simply be declared wrong. So the old name
// fields survive as read-once: bindRefs resolves each into its id the first
// time the board is read, the caller writes the board back, and nothing writes
// a name again. It is the shape FlowNode.AgentName → AgentNames already has.
//
// Unresolvable names are left exactly as they are rather than cleared. A board
// imported from another machine names a target registered there and not here,
// and that is the case rememberUnadopted exists for: the machine's ignorance is
// not the board's error, and erasing the name would turn "register this target"
// into "set this column up again from memory".

// bindColumnRefs folds a column's legacy name references into ids. It reports
// whether anything changed, which is what tells the caller the board is worth
// writing back.
func bindColumnRefs(c *ColumnSpec, deploys []DeployEntry) bool {
	changed := false
	if id, ok := bindDeploy(c.DeployID, c.DeployName, deploys); ok {
		c.DeployID, c.DeployName = id, ""
		changed = true
	}
	return changed
}

// bindFlowRefs folds a route's legacy name references into ids, stage by stage.
func bindFlowRefs(f *FlowEntry, deploys []DeployEntry) bool {
	changed := false
	for i := range f.Nodes {
		if id, ok := bindDeploy(f.Nodes[i].DeployID, f.Nodes[i].DeployName, deploys); ok {
			f.Nodes[i].DeployID, f.Nodes[i].DeployName = id, ""
			changed = true
		}
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
