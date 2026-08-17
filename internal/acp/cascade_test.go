package acp

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/artipop/xciii/internal/appschema"
)

// enforcingStore is a store on a database with the foreign keys enforced, the
// way the application enforces them.
func enforcingStore(t *testing.T) (*Store, func(cardID string)) {
	t.Helper()
	db, err := appschema.OpenEnforcing(filepath.Join(t.TempDir(), "xciii.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := appschema.AddCard(db, "board-1", "card-1"); err != nil {
		t.Fatal(err)
	}
	remove := func(cardID string) {
		t.Helper()
		if _, err := db.Exec(`DELETE FROM blocks WHERE id=?`, cardID); err != nil {
			t.Fatal(err)
		}
	}
	return NewStore(db, ""), remove
}

// Deleting a card takes everything this application knew about it. This is the
// whole reason the tables moved into the board's database (docs/store-plan.md):
// deleting a card is a real DELETE FROM blocks, this side never heard about it —
// BlockChanged handles only notify.Update — so every deleted card left its
// conversations, its place on a route, its stall and its queue slot behind for
// ever, in a file where no foreign key could reach them.
func TestADeletedCardTakesWhatWeKnewAboutIt(t *testing.T) {
	st, deleteCard := enforcingStore(t)

	if err := st.InsertTerminal(TerminalRecord{
		ID: "t1", CardID: "card-1", BoardID: "board-1", NodeID: "opt-work",
		StartedAt: time.Now(),
	}); err != nil {
		t.Fatal(err)
	}
	if err := st.SaveFlowState(FlowState{
		CardID: "card-1", BoardID: "board-1", Flow: "feature", NodeID: "opt-work",
	}); err != nil {
		t.Fatal(err)
	}
	if err := st.SetStall(StallRecord{CardID: "card-1", Reason: "стоит"}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.EnqueueStage(QueuedStage{
		CardID: "card-1", BoardID: "board-1", ColumnKey: "board-1|opt-work",
	}); err != nil {
		t.Fatal(err)
	}

	deleteCard("card-1")

	if rows, err := st.TerminalsForCard("card-1"); err != nil || len(rows) != 0 {
		t.Errorf("the card's conversations outlived it: %+v %v", rows, err)
	}
	if _, ok, err := st.FlowStateForCard("card-1"); err != nil || ok {
		t.Errorf("the card's place on its route outlived it: %v %v", ok, err)
	}
	if _, ok, err := st.Stall("card-1"); err != nil || ok {
		t.Errorf("the card's stall outlived it: %v %v", ok, err)
	}
	if _, ok, err := st.NextQueuedStage("board-1|opt-work"); err != nil || ok {
		t.Errorf("the card's place in the queue outlived it: %v %v", ok, err)
	}
}

// A source's log is the exception, and deliberately: what a source decided is a
// fact about the source, so the line stays and only the card reference goes.
func TestASourcesLogSurvivesTheCardItMade(t *testing.T) {
	db, err := appschema.OpenEnforcing(filepath.Join(t.TempDir(), "xciii.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := appschema.AddCard(db, "board-1", "card-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO source_event (id, source, outcome, card_id, created_at)
		VALUES (?,?,?,?,?)`, newID(), "почта", "created", "card-1", time.Now().UnixMilli()); err != nil {
		t.Fatal(err)
	}

	if _, err := db.Exec(`DELETE FROM blocks WHERE id='card-1'`); err != nil {
		t.Fatal(err)
	}

	var count int
	var cardID any
	if err := db.QueryRow(`SELECT COUNT(*), MAX(card_id) FROM source_event`).Scan(&count, &cardID); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("the log line went with the card: %d rows left", count)
	}
	if cardID != nil {
		t.Errorf("the log still points at a card that is gone: %v", cardID)
	}
}

// A workspace a card is still working in cannot be deleted out from under it:
// there is a copy on disk, and it has to be folded away first.
func TestAWorkspaceInUseCannotBeDeleted(t *testing.T) {
	db, err := appschema.OpenEnforcing(filepath.Join(t.TempDir(), "xciii.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := appschema.AddCard(db, "board-1", "card-1"); err != nil {
		t.Fatal(err)
	}
	st := NewStore(db, "")
	if err := st.SaveWorkspace(WorkdirEntry{ID: "ws-1", Name: "код", Path: "/repo", BoardID: "board-1"}); err != nil {
		t.Fatal(err)
	}
	if err := st.SaveCheckout(Checkout{
		WorkspaceID: "ws-1", CardID: "card-1", Mode: WorkModeWorktree, Branch: "feat/x",
	}); err != nil {
		t.Fatal(err)
	}

	if err := st.DeleteWorkspace("ws-1"); err == nil {
		t.Error("a folder with work in it was deleted anyway")
	}

	// The card going is what releases it — and then the folder can go.
	if _, err := db.Exec(`DELETE FROM blocks WHERE id='card-1'`); err != nil {
		t.Fatal(err)
	}
	if err := st.DeleteWorkspace("ws-1"); err != nil {
		t.Errorf("nothing holds the folder now, and it still would not go: %v", err)
	}
}
