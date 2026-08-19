package acp

import (
	"path/filepath"
	"testing"
)

// The crew used to be the agent's name, so renaming one emptied the crew of
// every column and every route on every board — silently.
func TestRenamingAnAgentKeepsTheCrewsItIsOn(t *testing.T) {
	m := agentManager(t, filepath.Join(t.TempDir(), "config.json"),
		AgentEntry{Name: "клаус", Kind: AgentKindClaude})

	agent := m.Agents()[0]
	if agent.ID == "" {
		t.Fatal("a registered agent has no id for a crew to point at")
	}

	spec, err := m.SaveColumn(ColumnSpec{
		BoardID: "board1", OptionID: "opt-work", PropertyID: "prop",
		Property: "Статус", Column: "В работе",
		Action: FlowActionAgent, AgentIDs: []string{agent.ID},
	})
	if err != nil {
		t.Fatal(err)
	}

	renamed := agent
	renamed.Name = "клаус второй"
	if _, err := m.UpdateAgent(renamed); err != nil {
		t.Fatalf("an agent could not be renamed: %v", err)
	}

	crew, err := crewOf(spec.AgentIDs, m.Agents())
	if err != nil {
		t.Fatalf("the column lost its crew when the agent was renamed: %v", err)
	}
	if len(crew) != 1 || crew[0].Name != "клаус второй" {
		t.Errorf("crew is %+v, want the renamed agent", crew)
	}
}

// A card names its agent through «Кто занимается», which stores the board
// account's id. Matching on the username derived from the agent's name meant a
// rename unassigned every card the agent was working on.
func TestAnAssignedCardFindsItsAgentByAccount(t *testing.T) {
	m := agentManager(t, "", AgentEntry{Name: "клаус", Kind: AgentKindClaude})
	m.recordAgentAccounts([]AgentUser{{Name: "клаус", UserID: "user-1"}})

	agent := m.Agents()[0]
	if agent.UserID != "user-1" {
		t.Fatalf("the account was not recorded on the entry: %+v", agent)
	}

	renamed := agent
	renamed.Name = "не клаус"
	if _, err := m.UpdateAgent(renamed); err != nil {
		t.Fatal(err)
	}

	// The card says nothing but the account id — which is all it ever stored.
	got, busy, err := m.resolveSessionAgent(CardMoved{PersonIDs: []string{"user-1"}}, nil)
	if err != nil || busy {
		t.Fatalf("the assigned card did not resolve: %v, busy=%v", err, busy)
	}
	if got.Name != "не клаус" {
		t.Errorf("resolved %q, want the renamed agent the card is assigned to", got.Name)
	}
}

// A board written before crews were ids names its agents; the names are folded
// once and never written back, and one this machine cannot resolve is refused
// so the board keeps its own copy untouched (rememberUnadopted).
func TestALegacyCrewIsFoldedIntoIDs(t *testing.T) {
	agents := []AgentEntry{{ID: "ag-1", Name: "клаус"}}

	spec := ColumnSpec{Column: "В работе", Agents: []string{"КЛАУС", "клаус", " "}}
	if !bindColumnRefs(&spec, agents, nil) {
		t.Fatal("a legacy crew was not folded")
	}
	if len(spec.AgentIDs) != 1 || spec.AgentIDs[0] != "ag-1" || len(spec.Agents) != 0 {
		t.Errorf("got ids=%v names=%v, want one id and no names", spec.AgentIDs, spec.Agents)
	}

	unknown := ColumnSpec{Column: "В работе", Agents: []string{"somebody else's"}}
	bindColumnRefs(&unknown, agents, nil)
	if len(unknown.Agents) != 1 {
		t.Error("a name this machine cannot resolve was dropped, so registering the agent can no longer fix the board")
	}
	if _, err := validateColumn(unknown, agents, nil); err == nil {
		t.Error("a column naming an agent nobody registered was accepted")
	}
}
