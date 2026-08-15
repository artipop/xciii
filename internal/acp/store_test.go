package acp

import (
	"path/filepath"
	"testing"
	"time"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	st, err := OpenStore(filepath.Join(t.TempDir(), "acp.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func TestStoreSessionRoundTrip(t *testing.T) {
	st := openTestStore(t)
	rec := SessionRecord{
		ID: "s1", CardID: "c1", BoardID: "b1", AgentKind: "claude",
		Status: StatusQueued, StartedAt: time.Now(),
	}
	if err := st.InsertSession(rec); err != nil {
		t.Fatal(err)
	}
	if err := st.AppendEvent("s1", 1, "chunk", map[string]any{"text": "hi"}); err != nil {
		t.Fatal(err)
	}
	if err := st.SetSessionStatus("s1", StatusDone, ""); err != nil {
		t.Fatal(err)
	}

	sessions, events, err := st.SessionsForCard("c1")
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 || sessions[0].Status != StatusDone || sessions[0].FinishedAt == nil {
		t.Fatalf("unexpected sessions: %+v", sessions)
	}
	if len(events) != 1 || events[0].Kind != "chunk" {
		t.Fatalf("unexpected events: %+v", events)
	}
}

func TestStoreStaleSessions(t *testing.T) {
	st := openTestStore(t)
	for id, status := range map[string]SessionStatus{
		"q": StatusQueued, "r": StatusRunning, "w": StatusWaitingPermission, "d": StatusDone,
	} {
		if err := st.InsertSession(SessionRecord{ID: id, CardID: "c", BoardID: "b", AgentKind: "claude", Status: status, StartedAt: time.Now()}); err != nil {
			t.Fatal(err)
		}
	}
	stale, err := st.StaleSessions()
	if err != nil {
		t.Fatal(err)
	}
	if len(stale) != 3 {
		t.Fatalf("expected 3 stale sessions, got %d", len(stale))
	}
}

func TestClaimIdempotency(t *testing.T) {
	st := openTestStore(t)
	window := 10 * time.Second

	fresh, err := st.ClaimIdempotency("k1", "s1", window)
	if err != nil || !fresh {
		t.Fatalf("first claim: fresh=%v err=%v", fresh, err)
	}
	fresh, err = st.ClaimIdempotency("k1", "s2", window)
	if err != nil || fresh {
		t.Fatalf("duplicate claim within window must not be fresh: fresh=%v err=%v", fresh, err)
	}
	// A different key is independent.
	fresh, err = st.ClaimIdempotency("k2", "s3", window)
	if err != nil || !fresh {
		t.Fatalf("independent key: fresh=%v err=%v", fresh, err)
	}
	// Expired keys can be claimed again.
	fresh, err = st.ClaimIdempotency("k1", "s4", -time.Second)
	if err != nil || !fresh {
		t.Fatalf("expired key should be claimable: fresh=%v err=%v", fresh, err)
	}
}

func TestOpenStoreIdempotentMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "acp.db")
	st, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	st.Close()
	st, err = OpenStore(path)
	if err != nil {
		t.Fatalf("second open failed: %v", err)
	}
	st.Close()
}

// The board draws a paused terminal button on cards whose conversation was cut
// off, and on no others: the rest of what is recorded here is about a column, a
// folder or a route, and none of those is opened by opening a terminal.
func TestOnlyACutOffConversationIsOfferedToTheBoard(t *testing.T) {
	st := openTestStore(t)
	if err := st.SetStall(StallRecord{CardID: "c1", NodeID: "n1", Kind: StallKindConversation,
		Reason: "терминал закрыт, а о результате не сказано"}); err != nil {
		t.Fatal(err)
	}
	if err := st.SetStall(StallRecord{CardID: "c2", NodeID: "n1", Reason: "в колонке нет свободного места"}); err != nil {
		t.Fatal(err)
	}

	cut, err := st.StallsOfKind(StallKindConversation)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := cut["c2"]; ok {
		t.Error("a column with no free place was offered as a conversation to reopen")
	}
	if cut["c1"] == "" {
		t.Fatalf("the cut-off conversation is missing: %v", cut)
	}
}

// Any progress on a card drops the reason, and the button has to go with it —
// a card being worked must not look like a card nobody picked up.
func TestProgressTakesThePausedCardOffTheList(t *testing.T) {
	st := openTestStore(t)
	if err := st.SetStall(StallRecord{CardID: "c1", Kind: StallKindConversation, Reason: "прервано"}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ClearStall("c1"); err != nil {
		t.Fatal(err)
	}
	cut, err := st.StallsOfKind(StallKindConversation)
	if err != nil {
		t.Fatal(err)
	}
	if len(cut) != 0 {
		t.Fatalf("the card still reads as cut off: %v", cut)
	}
}

// A newer reason replaces the old one whole — the kind included, or a card that
// stalled once on its conversation would go on offering a terminal for a reason
// that is now about a folder.
func TestANewerReasonReplacesTheKindToo(t *testing.T) {
	st := openTestStore(t)
	if err := st.SetStall(StallRecord{CardID: "c1", Kind: StallKindConversation, Reason: "прервано"}); err != nil {
		t.Fatal(err)
	}
	if err := st.SetStall(StallRecord{CardID: "c1", Reason: "папку держит другая карточка"}); err != nil {
		t.Fatal(err)
	}
	cut, err := st.StallsOfKind(StallKindConversation)
	if err != nil {
		t.Fatal(err)
	}
	if len(cut) != 0 {
		t.Fatalf("the old kind outlived the reason it belonged to: %v", cut)
	}
}

// A database written before the column existed must open and keep working: an
// install is somebody's boards, and a schema change is not a reason to ask them
// to delete it.
func TestAStallTableFromBeforeTheKindColumnStillOpens(t *testing.T) {
	path := filepath.Join(t.TempDir(), "acp.db")
	st, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.db.Exec(`DROP TABLE card_stall`); err != nil {
		t.Fatal(err)
	}
	// The table exactly as it shipped, without kind.
	if _, err := st.db.Exec(`CREATE TABLE card_stall (
		card_id TEXT PRIMARY KEY,
		node_id TEXT NOT NULL DEFAULT '',
		reason TEXT NOT NULL,
		created_at INTEGER NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := st.db.Exec(`INSERT INTO card_stall VALUES ('c1','n1','нет перехода',0)`); err != nil {
		t.Fatal(err)
	}
	st.Close()

	st, err = OpenStore(path)
	if err != nil {
		t.Fatalf("an older database would not open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	r, ok, err := st.Stall("c1")
	if err != nil || !ok {
		t.Fatalf("the reason recorded before the migration is gone: %v %v", ok, err)
	}
	if r.Kind != "" {
		t.Errorf("a reason from before the column reads as kind %q", r.Kind)
	}
}
