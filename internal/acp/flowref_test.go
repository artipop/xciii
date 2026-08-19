package acp

import (
	"path/filepath"
	"testing"
)

// The route was keyed by its name, so renaming one lost the place of every card
// standing on it.
func TestRenamingARouteKeepsTheCardsOnIt(t *testing.T) {
	m := agentManager(t, filepath.Join(t.TempDir(), "config.json"))

	flow, err := m.AddFlow(sampleFlow())
	if err != nil {
		t.Fatal(err)
	}
	if flow.ID == "" {
		t.Fatal("a registered route has no id for a card to stand on")
	}

	renamed := flow
	renamed.Name = "фича, но иначе"
	if _, err := m.UpdateFlow(renamed); err != nil {
		t.Fatalf("a route could not be renamed: %v", err)
	}

	// The card's position points at the id, so it still finds its route.
	back, ok := m.FlowByID(flow.ID)
	if !ok {
		t.Fatal("the card's route was lost when it was renamed")
	}
	if back.Name != "фича, но иначе" {
		t.Errorf("resolved %q, want the renamed route", back.Name)
	}

	// Names stay unique, because a card names its route with an option a person
	// picks and two routes called one thing is a question nobody can answer.
	second := sampleFlow()
	second.Name = "фича, но иначе"
	if _, err := m.AddFlow(second); err == nil {
		t.Error("two routes took the same name")
	}
}

// A card parked before routes had ids records the route's name; it is folded
// into the id when the position is read, and the card keeps its place.
func TestACardParkedUnderARouteNameFindsItsRoute(t *testing.T) {
	m := agentManager(t, "")
	flow, err := m.AddFlow(sampleFlow())
	if err != nil {
		t.Fatal(err)
	}

	st := m.boundFlowState(FlowState{CardID: "card-1", Flow: "FEATURE", NodeID: "work"})
	if st.FlowID != flow.ID || st.Flow != "" {
		t.Errorf("the legacy route name was not folded: %+v", st)
	}

	// A name no route answers to is left alone rather than guessed at.
	unknown := m.boundFlowState(FlowState{CardID: "card-2", Flow: "чей-то чужой", NodeID: "work"})
	if unknown.FlowID != "" || unknown.Flow == "" {
		t.Errorf("an unresolvable route name was folded anyway: %+v", unknown)
	}
}
