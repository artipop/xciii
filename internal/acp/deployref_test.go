package acp

import (
	"path/filepath"
	"testing"
)

// The pin used to be the target's name, so renaming one silently unpinned every
// column that published there.
func TestRenamingADeployTargetKeepsWhatPointsAtIt(t *testing.T) {
	m := agentManager(t, filepath.Join(t.TempDir(), "config.json"))

	target, err := m.AddDeploy(deployEntry("staging"))
	if err != nil {
		t.Fatal(err)
	}
	if target.ID == "" {
		t.Fatal("a registered target has no id to point at")
	}

	spec, err := m.SaveColumn(ColumnSpec{
		BoardID: "board1", OptionID: "opt-deploy", PropertyID: "prop",
		Property: "Статус", Column: "Публикация",
		Action: FlowActionDeploy, DeployID: target.ID,
	})
	if err != nil {
		t.Fatal(err)
	}

	renamed := target
	renamed.Name = "прод"
	if _, err := m.UpdateDeploy(renamed); err != nil {
		t.Fatal(err)
	}

	found, err := m.resolveDeployTargetPinned(CardMoved{CardID: "card-1", BoardID: "board1"}, spec.DeployID)
	if err != nil {
		t.Fatalf("the column lost its target when it was renamed: %v", err)
	}
	if found.Name != "прод" {
		t.Errorf("resolved %q, want the renamed target", found.Name)
	}
}

func TestALegacyDeployNameIsFoldedIntoItsID(t *testing.T) {
	deploys := []DeployEntry{{ID: "dep-1", Name: "staging"}}

	spec := ColumnSpec{Column: "Публикация", DeployName: "STAGING"}
	if !bindColumnRefs(&spec, nil, deploys) {
		t.Fatal("a legacy name was not folded")
	}
	if spec.DeployID != "dep-1" || spec.DeployName != "" {
		t.Errorf("got id=%q name=%q, want the id alone", spec.DeployID, spec.DeployName)
	}

	// A board from another machine names targets registered there, so an
	// unresolvable name is kept: registering it here is what fixes the board.
	unknown := ColumnSpec{Column: "Публикация", DeployName: "somebody else's"}
	if bindColumnRefs(&unknown, nil, deploys) {
		t.Error("a name this machine cannot resolve was folded anyway")
	}
	if unknown.DeployName == "" {
		t.Error("the name was cleared, so registering the target here can no longer fix the board")
	}
}
