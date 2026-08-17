package acp

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/artipop/xciii/internal/appschema"
)

// legacyDB writes an `acp.db` exactly as the previous version of this package
// made one: terminal_session rather than conversation, `key` and `at` for
// column names, autoincrement journals, and the empty string standing in for
// everything absent.
func legacyDB(t *testing.T, path string) {
	t.Helper()
	driver, ok := sqliteDriver()
	if !ok {
		t.Skip("no SQLite driver in this build")
	}
	db, err := sql.Open(driver, path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`
CREATE TABLE agent_session (id TEXT PRIMARY KEY, card_id TEXT NOT NULL, board_id TEXT NOT NULL,
	agent_kind TEXT NOT NULL, acp_session_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
	cwd TEXT NOT NULL DEFAULT '', worktree_path TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '',
	started_at INTEGER NOT NULL, finished_at INTEGER, error_text TEXT NOT NULL DEFAULT '');
CREATE TABLE session_event (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, seq INTEGER NOT NULL,
	kind TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE TABLE terminal_session (id TEXT PRIMARY KEY, card_id TEXT NOT NULL DEFAULT '', node_id TEXT NOT NULL DEFAULT '',
	column_name TEXT NOT NULL DEFAULT '', board_id TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
	repo_path TEXT NOT NULL DEFAULT '', cwd TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '',
	agent TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
	started_at INTEGER NOT NULL, ended_at INTEGER, exit_code INTEGER NOT NULL DEFAULT 0);
CREATE TABLE idempotency (key TEXT PRIMARY KEY, session_id TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE flow_state (card_id TEXT PRIMARY KEY, board_id TEXT NOT NULL DEFAULT '', flow TEXT NOT NULL,
	node_id TEXT NOT NULL, branch TEXT NOT NULL DEFAULT '', repo_path TEXT NOT NULL DEFAULT '', entered_at INTEGER NOT NULL);
CREATE TABLE flow_event (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT NOT NULL, flow TEXT NOT NULL,
	from_node TEXT NOT NULL DEFAULT '', to_node TEXT NOT NULL, on_kind TEXT NOT NULL,
	detail TEXT NOT NULL DEFAULT '', said TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE TABLE card_stall (card_id TEXT PRIMARY KEY, node_id TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '',
	reason TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE stage_queue (card_id TEXT PRIMARY KEY, board_id TEXT NOT NULL DEFAULT '', column_key TEXT NOT NULL,
	flow TEXT NOT NULL DEFAULT '', node_id TEXT NOT NULL DEFAULT '', queued_at INTEGER NOT NULL);
CREATE TABLE board_setup (board_id TEXT NOT NULL, step TEXT NOT NULL, status TEXT NOT NULL, at INTEGER NOT NULL,
	PRIMARY KEY (board_id, step));
CREATE TABLE vcs_seen (project TEXT NOT NULL, branch TEXT NOT NULL, kind TEXT NOT NULL,
	marker TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, PRIMARY KEY (project, branch, kind));
CREATE TABLE workdir_claim (workdir TEXT NOT NULL, owner TEXT NOT NULL, mode TEXT NOT NULL,
	branch TEXT NOT NULL DEFAULT '', path TEXT NOT NULL DEFAULT '', base TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL, released_at INTEGER, PRIMARY KEY (workdir, owner));

INSERT INTO agent_session VALUES ('s1','card-1','board-1','claude','acp-1','done','/w','/w','feat/x',1000,2000,'');
INSERT INTO session_event (session_id, seq, kind, payload_json, created_at) VALUES ('s1',1,'chunk','{"t":"a"}',1000);
INSERT INTO session_event (session_id, seq, kind, payload_json, created_at) VALUES ('s1',2,'chunk','{"t":"b"}',1001);
INSERT INTO terminal_session VALUES ('t1','card-1','opt-1','В работе','board-1','беседа','/repo','/w','feat/x','клаус','claude','пишет тест',1000,NULL,0);
INSERT INTO terminal_session VALUES ('t2','','@talk','','board-1','','','/drafts','','клаус','claude','',1100,1200,0);
INSERT INTO flow_state VALUES ('card-1','board-1','feature','opt-1','feat/x','/repo',1000);
INSERT INTO flow_event (card_id, flow, from_node, to_node, on_kind, detail, said, created_at) VALUES ('card-1','feature','','opt-1','','','',1000);
INSERT INTO flow_event (card_id, flow, from_node, to_node, on_kind, detail, said, created_at) VALUES ('card-1','feature','opt-1','opt-2','success','готово','сделал',1001);
INSERT INTO card_stall VALUES ('card-2','opt-1','conversation','терминал закрыт',1000);
INSERT INTO stage_queue VALUES ('card-3','board-1','board-1|opt-1','feature','opt-1',1000);
INSERT INTO board_setup VALUES ('board-1','folders','done',1000);
INSERT INTO vcs_seen VALUES ('/repo','feat/x','branch.merged','abc123',1000);

-- card-9 was deleted from the board months ago. Nothing told this side, so the
-- old file is still full of it: that is the leak the move into one database is
-- for, and the import must not carry it in as a dangling reference.
INSERT INTO terminal_session VALUES ('t9','card-9','opt-1','','board-1','','','/w','','клаус','claude','',1000,NULL,0);
INSERT INTO card_stall VALUES ('card-9','opt-1','conversation','что-то',1000);
INSERT INTO flow_event (card_id, flow, from_node, to_node, on_kind, detail, said, created_at) VALUES ('card-9','feature','','opt-1','','','',1000);
INSERT INTO board_setup VALUES ('board-нет','folders','done',1000);
`); err != nil {
		t.Fatal(err)
	}
}

// An install that predates the move keeps everything it had. This is the whole
// of what makes the move safe to ship: the file is somebody's work — which
// branch a card is on, what an agent said when it finished — and it is read
// once, at startup, and then put out of reach of a second read.
func TestAnAcpDatabaseFromBeforeTheMoveIsCarriedOver(t *testing.T) {
	dir := t.TempDir()
	legacy := filepath.Join(dir, "acp.db")
	legacyDB(t, legacy)

	db, err := appschema.Open(filepath.Join(dir, "xciii.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	// The cards the old file talks about, as the board still has them. card-9
	// is deliberately absent: the old file went on writing about it long after
	// somebody deleted it, because nothing ever told this side.
	for _, card := range []string{"card-1", "card-2", "card-3"} {
		if err := appschema.AddCard(db, "board-1", card); err != nil {
			t.Fatal(err)
		}
	}

	n, err := ImportLegacyStore(db, "", legacy)
	if err != nil {
		t.Fatal(err)
	}
	if n == 0 {
		t.Fatal("nothing was carried over")
	}

	st := NewStore(db, "")

	sessions, events, err := st.SessionsForCard("card-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 || sessions[0].Branch != "feat/x" || sessions[0].FinishedAt == nil {
		t.Fatalf("the session did not arrive whole: %+v", sessions)
	}
	if len(events) != 2 {
		t.Fatalf("the session's journal lost lines: %+v", events)
	}
	// The journal's order is the point of carrying it at all, and the old ids
	// were an autoincrement while the new ones are UUIDv7: the order has to
	// survive the change of key.
	if events[0].ID >= events[1].ID {
		t.Errorf("the journal came back out of order: %q then %q", events[0].ID, events[1].ID)
	}

	conversations, err := st.TerminalsForCard("card-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(conversations) != 1 || conversations[0].Summary != "пишет тест" {
		t.Fatalf("the conversation did not arrive: %+v", conversations)
	}

	// A conversation with no card had card_id '' in the old schema, which is a
	// card id that does not exist. It has to arrive as absence, or the foreign
	// key onto blocks can never be turned on.
	var cardID sql.NullString
	if err := db.QueryRow(`SELECT card_id FROM conversation WHERE id='t2'`).Scan(&cardID); err != nil {
		t.Fatal(err)
	}
	if cardID.Valid {
		t.Errorf("a card-less conversation arrived naming card %q", cardID.String)
	}

	if flow, ok, err := st.FlowStateForCard("card-1"); err != nil || !ok || flow.Branch != "feat/x" {
		t.Errorf("the card lost its place on the route: %+v %v %v", flow, ok, err)
	}
	if fe, err := st.FlowEvents("card-1"); err != nil || len(fe) != 2 || fe[1].Said != "сделал" {
		t.Errorf("the route history did not arrive: %+v %v", fe, err)
	}
	if stall, ok, err := st.Stall("card-2"); err != nil || !ok || stall.Kind != StallKindConversation {
		t.Errorf("the stall did not arrive: %+v %v %v", stall, ok, err)
	}
	if q, ok, err := st.NextQueuedStage("board-1|opt-1"); err != nil || !ok || q.CardID != "card-3" {
		t.Errorf("the queue did not arrive: %+v %v %v", q, ok, err)
	}
	if steps, err := st.SetupSteps("board-1"); err != nil || len(steps) != 1 {
		t.Errorf("the setup answers did not arrive: %+v %v", steps, err)
	}
	// The git latches are deliberately not carried: they name a folder by its
	// path and the table keys by the workspace's id, which nothing can resolve
	// this early. Losing them costs one event firing again on the first poll.
	// The checkout is not carried over: it is keyed by the workspace's id now,
	// and the old file knew the folder only by its path — a path this machine
	// may no longer have. What it held is remade the first time the card is
	// worked on again, from the branch, which the card itself carries.

	// A card the board no longer has takes everything about it with it — which
	// is what ON DELETE CASCADE would have done had the tables ever been in one
	// database. Carrying those rows in would write exactly the dangling
	// references the keys forbid, and step 4 would then fail on the import's own
	// output.
	for _, q := range []string{
		`SELECT COUNT(*) FROM conversation WHERE card_id='card-9'`,
		`SELECT COUNT(*) FROM card_stall WHERE card_id='card-9'`,
		`SELECT COUNT(*) FROM flow_event WHERE card_id='card-9'`,
		`SELECT COUNT(*) FROM board_setup WHERE board_id='board-нет'`,
	} {
		var count int
		if err := db.QueryRow(q).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Errorf("%s carried %d rows about something the board has not got", q, count)
		}
	}

	// The file is renamed rather than deleted: what it holds is a person's
	// work, and deciding it arrived safely is theirs.
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Errorf("the old file is still where a second import would find it: %v", err)
	}
	if _, err := os.Stat(legacy + ".migrated"); err != nil {
		t.Errorf("the old file was not kept: %v", err)
	}
}

// Every install made after the move has no such file, and that is not an error.
func TestNoLegacyDatabaseIsNothingToDo(t *testing.T) {
	n, err := ImportLegacyStore(nil, "", filepath.Join(t.TempDir(), "acp.db"))
	if err != nil || n != 0 {
		t.Fatalf("a missing file should be silent: %d %v", n, err)
	}
}
