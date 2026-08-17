package main

// appTables are the tables this application owns, moving into the board's own
// database (docs/store-plan.md, step 1). They were two SQLite files beside it —
// `acp.db` and `sources.db` — and everything they know is about a card or a
// board, which lives in a third file where no foreign key could reach it.
//
// What that cost is not hypothetical: deleting a card is a real DELETE FROM
// blocks, and nothing here ever heard about it, so every deleted card left its
// conversations, its position on a route, its stall and its queue slot behind
// for ever. The keys below are the fix, and they are written in CREATE TABLE
// because SQLite has no ALTER TABLE ADD CONSTRAINT — there is no second chance
// to add them.
//
// Two things are deliberately still as they were, and both are step 0's to
// change: ids are the board's 27-character strings rather than UUIDv7, and
// times are unix milliseconds rather than timestamps. Neither can move on its
// own — MySQL refuses a foreign key across differing column types, so our ids
// and the board's change in one migration or in none.
func appTables() []Table {
	return []Table{
		agentSession(),
		sessionEvent(),
		conversation(),
		idempotency(),
		flowState(),
		flowEvent(),
		cardStall(),
		stageQueue(),
		boardSetup(),
		vcsSeen(),
		workdirClaim(),
		sourceItem(),
		sourceEvent(),
	}
}

// boardTables are the fork's own, named here only so a foreign key has
// something to point at. They are not emitted: migration 000001 made them.
const (
	tableBlocks = "blocks"
	tableBoards = "boards"
)

// cardFK is the key almost every table here wants: what we know about a card
// stops being true the moment the card does.
func cardFK(table string) FK {
	return FK{
		Name:     table + "_card",
		Columns:  []string{"card_id"},
		RefTable: tableBlocks,
		RefCols:  []string{"id"},
		OnDelete: Cascade,
	}
}

func boardFK(table string) FK {
	return FK{
		Name:     table + "_board",
		Columns:  []string{"board_id"},
		RefTable: tableBoards,
		RefCols:  []string{"id"},
		OnDelete: Cascade,
	}
}

// agent_session is a run over the protocol: a deploy, a test, the short
// headless run that names a branch. An agent *stage* of a route is not one of
// these — it is a conversation (below), because the agent's own CLI draws its
// work and asks its own questions.
func agentSession() Table {
	return Table{
		Name: "agent_session",
		Why: "A run of an agent over ACP. One process, one verdict: unlike a\n" +
			"conversation, it is never resumed, which is why the two are\n" +
			"separate tables and not one row with a transport column.",
		Columns: []Column{
			{Name: "id", Type: ID()},
			{Name: "card_id", Type: ID(), Null: true,
				Why: "NULL for a run that is about no card — naming a branch is one."},
			{Name: "board_id", Type: ID(), Null: true},
			{Name: "agent_kind", Type: Name(32)},
			{Name: "acp_session_id", Type: Name(100), Null: true},
			{Name: "status", Type: Name(24)},
			{Name: "cwd", Type: Text(), Null: true},
			{Name: "worktree_path", Type: Text(), Null: true},
			{Name: "branch", Type: Name(255), Null: true},
			{Name: "started_at", Type: Millis()},
			{Name: "finished_at", Type: Millis(), Null: true,
				Why: "NULL means the session is still live."},
			{Name: "error_text", Type: Text(), Null: true},
		},
		PK:  []string{"id"},
		FKs: []FK{cardFK("agent_session"), boardFK("agent_session")},
		Indexes: []Index{
			{Name: "idx_agent_session_card", Columns: []string{"card_id", "started_at"}},
		},
	}
}

// session_event is one session's journal.
func sessionEvent() Table {
	return Table{
		Name: "session_event",
		Why: "What happened during a session, in order. The id is a UUIDv7 rather\n" +
			"than an autoincrement: v7 sorts by time, so ORDER BY id still means\n" +
			"\"as it happened\" and the three spellings of AUTO_INCREMENT are gone.\n" +
			"`seq` went with them — it was the same fact told twice.",
		Columns: []Column{
			{Name: "id", Type: ID()},
			{Name: "session_id", Type: ID()},
			{Name: "kind", Type: Name(32)},
			{Name: "payload_json", Type: JSON(), Null: true},
			{Name: "created_at", Type: Millis()},
		},
		PK: []string{"id"},
		FKs: []FK{{
			Name: "session_event_session", Columns: []string{"session_id"},
			RefTable: "agent_session", RefCols: []string{"id"}, OnDelete: Cascade,
		}},
		Indexes: []Index{
			{Name: "idx_session_event_session", Columns: []string{"session_id", "id"}},
		},
	}
}

// conversation was terminal_session, and the rename is the concept catching up
// with the code: this is the agent's own CLI in a pty, and it is what a person
// talks in and what a stage of a route runs in.
func conversation() Table {
	return Table{
		Name: "conversation",
		Why: "A conversation with an agent: its CLI in a pty, keyed (card, node).\n" +
			"The row outlives every process that ever drew it — that is what makes\n" +
			"a conversation resumable, and it is the difference from agent_session,\n" +
			"which is one run and then over.",
		Columns: []Column{
			{Name: "id", Type: ID()},
			{Name: "card_id", Type: ID(), Null: true,
				Why: "NULL for a planning conversation: it is about no card."},
			{Name: "board_id", Type: ID(), Null: true},
			{Name: "node_id", Type: Name(64),
				Why: "The column's option id — work; '@talk' — discussion; '@none' — a\n" +
					"card with no column at all."},
			{Name: "column_name", Type: Name(200), Null: true,
				Why: "What the column was called at the time, frozen: the option may be\n" +
					"gone, and the row still has to read the same."},
			{Name: "title", Type: Text(), Null: true},
			{Name: "summary", Type: Text(), Null: true,
				Why: "The agent's own line about what this conversation is doing."},
			{Name: "agent", Type: Name(100), Null: true},
			{Name: "kind", Type: Name(32), Null: true},
			{Name: "workdir_path", Type: Text(), Null: true,
				Why: "Was repo_path. Becomes workdir_id at step 2, when the registry\n" +
					"is a table and a folder stops being addressed by its path."},
			{Name: "cwd", Type: Text(), Null: true},
			{Name: "branch", Type: Name(255), Null: true},
			{Name: "started_at", Type: Millis()},
			{Name: "ended_at", Type: Millis(), Null: true},
			{Name: "exit_code", Type: Int(), Null: true},
		},
		PK:  []string{"id"},
		FKs: []FK{cardFK("conversation"), boardFK("conversation")},
		Indexes: []Index{
			{Name: "idx_conversation_card", Columns: []string{"card_id", "started_at"}},
			{Name: "idx_conversation_card_node", Columns: []string{"card_id", "node_id", "started_at"}},
		},
	}
}

// idempotency is the flow engine's latch: this event has already been handled.
func idempotency() Table {
	return Table{
		Name: "idempotency",
		Why: "One route event, handled once. `key` was the column's name and is a\n" +
			"reserved word in MySQL, so it is `token` — cheaper than backticks in\n" +
			"every query for ever.",
		Columns: []Column{
			{Name: "token", Type: Name(255)},
			{Name: "session_id", Type: ID(), Null: true},
			{Name: "created_at", Type: Millis()},
		},
		PK: []string{"token"},
		Indexes: []Index{
			{Name: "idx_idempotency_created", Columns: []string{"created_at"}},
		},
	}
}

// flow_state is where a card stands on its route.
func flowState() Table {
	return Table{
		Name: "flow_state",
		Why: "This machine's index of where each card is on its route. The truth is\n" +
			"on the card itself, so it travels with the board; this is what the VCS\n" +
			"watcher asks \"which cards are parked and on what branch\" in one query.",
		Columns: []Column{
			{Name: "card_id", Type: ID()},
			{Name: "board_id", Type: ID(), Null: true},
			{Name: "flow", Type: Name(200),
				Why: "The route's name. It has no id of its own yet — contradiction 4 of\n" +
					"docs/model-graph.md, which lives inside the board's JSON."},
			{Name: "node_id", Type: Name(64)},
			{Name: "branch", Type: Name(255), Null: true},
			{Name: "workdir_path", Type: Text(), Null: true},
			{Name: "entered_at", Type: Millis()},
		},
		PK:  []string{"card_id"},
		FKs: []FK{cardFK("flow_state"), boardFK("flow_state")},
	}
}

// flow_event is the journal of transitions.
func flowEvent() Table {
	return Table{
		Name: "flow_event",
		Why:  "Every transition a card made, and what the agent said on it.",
		Columns: []Column{
			{Name: "id", Type: ID()},
			{Name: "card_id", Type: ID()},
			{Name: "flow", Type: Name(200)},
			{Name: "from_node", Type: Name(64), Null: true},
			{Name: "to_node", Type: Name(64)},
			{Name: "on_kind", Type: Name(32)},
			{Name: "detail", Type: Text(), Null: true},
			{Name: "said", Type: Text(), Null: true,
				Why: "The agent's closing words: what a conversation is told instead of\n" +
					"its task when the card comes back to it."},
			{Name: "created_at", Type: Millis()},
		},
		PK:  []string{"id"},
		FKs: []FK{cardFK("flow_event")},
		Indexes: []Index{
			{Name: "idx_flow_event_card", Columns: []string{"card_id", "id"}},
		},
	}
}

// card_stall is why a card is standing still.
func cardStall() Table {
	return Table{
		Name: "card_stall",
		Why: "One current reason a card is not moving — not a journal. The reason is\n" +
			"true only until somebody fixes what it is about, and a comment would\n" +
			"outlive it as noise.",
		Columns: []Column{
			{Name: "card_id", Type: ID()},
			{Name: "node_id", Type: Name(64), Null: true},
			{Name: "kind", Type: Name(32), Null: true,
				Why: "'conversation' is the one kind with somewhere to go: open the\n" +
					"terminal. The rest have no button, which is why this is a field and\n" +
					"never a reading of the reason's own Russian."},
			{Name: "reason", Type: Text()},
			{Name: "created_at", Type: Millis()},
		},
		PK:  []string{"card_id"},
		FKs: []FK{cardFK("card_stall")},
	}
}

// stage_queue is a card waiting for a free place in its column.
func stageQueue() Table {
	return Table{
		Name: "stage_queue",
		Why:  "A card waiting for its column to free up a place.",
		Columns: []Column{
			{Name: "card_id", Type: ID()},
			{Name: "board_id", Type: ID(), Null: true},
			{Name: "column_key", Type: Name(128),
				Why: "board|option — the queue belongs to one column of one board."},
			{Name: "flow", Type: Name(200), Null: true},
			{Name: "node_id", Type: Name(64), Null: true},
			{Name: "queued_at", Type: Millis()},
		},
		PK:  []string{"card_id"},
		FKs: []FK{cardFK("stage_queue"), boardFK("stage_queue")},
		Indexes: []Index{
			{Name: "idx_stage_queue_column", Columns: []string{"column_key", "queued_at"}},
		},
	}
}

// board_setup is what the setup wizard has already asked about a board.
func boardSetup() Table {
	return Table{
		Name: "board_setup",
		Why: "Which setup questions a board has been asked. It is about this machine\n" +
			"— the answers are folders and hosts here — so it cannot live in the\n" +
			"browser's storage, which the desktop window forgets on every launch.",
		Columns: []Column{
			{Name: "board_id", Type: ID()},
			{Name: "step", Type: Name(32)},
			{Name: "status", Type: Name(16)},
			{Name: "changed_at", Type: Millis(),
				Why: "Was `at`. AT is a keyword in Postgres and a name not worth having."},
		},
		PK:  []string{"board_id", "step"},
		FKs: []FK{boardFK("board_setup")},
	}
}

// vcs_seen is the git watcher's latch.
func vcsSeen() Table {
	return Table{
		Name: "vcs_seen",
		Why: "This branch event has already been acted on. Keyed by path today,\n" +
			"which MySQL would refuse in a key of any real length — step 2 moves it\n" +
			"onto the folder's id, and that is the same conclusion from two sides.",
		Columns: []Column{
			{Name: "workdir_path", Type: Name(255)},
			{Name: "branch", Type: Name(255)},
			{Name: "kind", Type: Name(32)},
			{Name: "marker", Type: Name(64), Null: true,
				Why: "The commit the event refers to: the same state seen twice fires once."},
			{Name: "created_at", Type: Millis()},
		},
		PK: []string{"workdir_path", "branch", "kind"},
	}
}

// workdir_claim is a workspace taken under an owner.
func workdirClaim() Table {
	return Table{
		Name: "workdir_claim",
		Why: "The copy and the branch one owner holds in one folder. The owner is a\n" +
			"card id or \"board:<id>\", which is why there is no foreign key here yet:\n" +
			"one column cannot point at two tables. Step 2 splits it into card_id and\n" +
			"board_id, and keys the folder by id rather than by its path.",
		Columns: []Column{
			{Name: "workdir_path", Type: Name(255)},
			{Name: "owner", Type: Name(128)},
			{Name: "mode", Type: Name(16)},
			{Name: "branch", Type: Name(255), Null: true,
				Why: "NULL for an ordinary folder: it has no branch, and that is absence\n" +
					"rather than an empty name."},
			{Name: "path", Type: Text(), Null: true},
			{Name: "base", Type: Name(255), Null: true},
			{Name: "created_at", Type: Millis()},
			{Name: "released_at", Type: Millis(), Null: true,
				Why: "NULL means the workspace is live."},
		},
		PK: []string{"workdir_path", "owner"},
		Indexes: []Index{
			{Name: "idx_workdir_claim_live", Columns: []string{"workdir_path", "released_at"}},
		},
	}
}

// source_item is the inbox's dedup.
func sourceItem() Table {
	return Table{
		Name: "source_item",
		Why: "What a source has already brought. The same letter arriving twice adds\n" +
			"to the card it made rather than making a second one.",
		Columns: []Column{
			{Name: "source", Type: Name(100)},
			{Name: "external_id", Type: Name(255)},
			{Name: "version", Type: Name(255), Null: true,
				Why: "The service's own updated/etag: changed means there is something\n" +
					"to add."},
			{Name: "card_id", Type: ID(), Null: true},
			{Name: "created_at", Type: Millis()},
			{Name: "updated_at", Type: Millis()},
		},
		PK: []string{"source", "external_id"},
		FKs: []FK{{
			Name: "source_item_card", Columns: []string{"card_id"},
			RefTable: tableBlocks, RefCols: []string{"id"}, OnDelete: SetNull,
		}},
		Indexes: []Index{
			{Name: "idx_source_item_card", Columns: []string{"card_id"}},
		},
	}
}

// source_event is a source's log.
func sourceEvent() Table {
	return Table{
		Name: "source_event",
		Why: "Why nothing happened — the only question anybody asks of a source.\n" +
			"Deleting the card it produced does not delete the line: what a source\n" +
			"decided is a fact about the source.",
		Columns: []Column{
			{Name: "id", Type: ID()},
			{Name: "source", Type: Name(100)},
			{Name: "external_id", Type: Name(255), Null: true},
			{Name: "rule", Type: Name(100), Null: true},
			{Name: "outcome", Type: Name(16)},
			{Name: "card_id", Type: ID(), Null: true},
			{Name: "detail", Type: Text(), Null: true},
			{Name: "created_at", Type: Millis()},
		},
		PK: []string{"id"},
		FKs: []FK{{
			Name: "source_event_card", Columns: []string{"card_id"},
			RefTable: tableBlocks, RefCols: []string{"id"}, OnDelete: SetNull,
		}},
		Indexes: []Index{
			{Name: "idx_source_event_source", Columns: []string{"source", "id"}},
		},
	}
}
