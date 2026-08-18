package main

// boardTables are the fork's own tables — the ones eighty-one migrations built
// up to, described once so the whole schema can be made in a single step.
//
// **This is a reproduction, not an improvement.** Every width, every nullable
// column and every default is what the migrations actually leave behind, warts
// included: `blocks.id` is nullable, `file_info` has no primary key,
// `blocks.channel_id` is a Mattermost-plugin remnant. Changing any of that is a
// change to the fork's queries, and the value of collapsing is precisely that
// it can be checked — the schema a fresh database gets must be the schema an
// existing one has, and a diff is what says so. Improvements go in afterwards,
// one at a time, where each can be reviewed on its own.
//
// Four columns have since gone that way, each with the code that fed it:
// `root_id` on blocks and blocks_history (always equal to board_id, written
// only by the legacy block store, which nothing called), and `workspace_id` on
// sharing, subscriptions and notification_hints (older than channel_id —
// workspaces predated teams — and named by no query for years).
// `blocks.channel_id` stays: the board-to-channel link still has app-layer code
// and an API field the page can see.
//
// Two things are therefore deliberately absent. There are **no foreign keys
// between these tables**: the fork deletes softly (a `delete_at`), so a real
// key would fire on the paths that do delete for real and change behaviour
// under code nobody has read for this. And **the ids are still strings and the
// times still unix milliseconds** — retyping them is the other half of step 0,
// and it touches 154 mentions across 27 files of the fork plus the webapp's own
// id generator, so it lands on its own.
//
// `teams` is here and stays: the product keeps working with teams.
// `schema_migrations` is not, because golang-migrate makes its own.
func boardTables() []Table {
	return []Table{
		users(),
		teams(),
		sessions(),
		systemSettings(),
		boardsTable(),
		boardsHistory(),
		blocksTable(),
		blocksHistory(),
		boardMembers(),
		boardMembersHistory(),
		categories(),
		categoryBoards(),
		sharingTable(),
		fileInfo(),
		preferences(),
		subscriptions(),
		notificationHints(),
	}
}

// insertAt is the history tables' own clock: the moment a row was written,
// filled in by the database rather than by Go.
//
// It is the one place the fork spells time properly, and it used to be half of
// the history tables' primary key — which was a bug rather than a design.
// SQLite's clock here has millisecond resolution, so two rows written in the
// same millisecond collided on the key and the second was refused: deleting a
// board and undeleting it straight away returned a 500 about a third of the
// time, and inside a transaction, where SQLite hands every statement the same
// instant, it was certain. That is why `@withTransaction` is switched off on
// SQLite (docs/sql-plan.md, point 1).
//
// The history tables have no primary key now, which is the second of the two
// places this schema deliberately differs from the ladder's. An append-only
// journal does not need one: nothing upserts into these tables, nothing joins
// to them by key, and the only thing anybody asks is "the versions of this row,
// newest first" — which is an index, and is what they have.
// nullablePK is the note on a key column the fork's SQLite migrations left
// nullable — SQLite allows it for a table-level PRIMARY KEY on a non-integer
// column, and the older CREATEs simply never said NOT NULL.
//
// It is a note about where the column came from, not what it is: build() forces
// NOT NULL on every key column, because MySQL refuses a nullable one outright
// ("Error 1171") and the whole migration died on its first table. The ladder
// got away with the difference by writing each dialect by hand; one description
// cannot say both, and NOT NULL is the true one.
const nullablePK = "The fork's SQLite CREATE left this nullable; build() makes key columns NOT NULL."

func insertAt() Column {
	return Column{Name: "insert_at", Type: Timestamp(), Default: DefaultNow}
}

func users() Table {
	return Table{
		Name: "users",
		Why: "Everybody the board knows: people, and — under their own names and\n" +
			"with no column to tell them apart — the agents and the sources.\n" +
			"password, mfa_secret, auth_service and auth_data are unused: this\n" +
			"application creates every account itself and has no passwords.",
		Columns: []Column{
			{Name: "id", Type: Name(100), Null: true, Why: nullablePK},
			{Name: "username", Type: Name(100), Null: true},
			{Name: "email", Type: Name(255), Null: true},
			{Name: "password", Type: Name(100), Null: true},
			{Name: "mfa_secret", Type: Name(100), Null: true},
			{Name: "auth_service", Type: Name(20), Null: true},
			{Name: "auth_data", Type: Name(255), Null: true},
			{Name: "props", Type: Text(), Null: true},
			{Name: "create_at", Type: Millis(), Null: true},
			{Name: "update_at", Type: Millis(), Null: true},
			{Name: "delete_at", Type: Millis(), Null: true},
		},
		PK: []string{"id"},
	}
}

func teams() Table {
	return Table{
		Name: "teams",
		Why: "The team a board belongs to. In this product there is exactly one and\n" +
			"its id is '0' — but the column is in two hundred queries of the fork,\n" +
			"and working with teams stays as it is.",
		Columns: []Column{
			{Name: "id", Type: Name(36), Null: true, Why: nullablePK},
			{Name: "signup_token", Type: Name(100)},
			{Name: "settings", Type: Text(), Null: true},
			{Name: "modified_by", Type: Name(36), Null: true},
			{Name: "update_at", Type: Millis(), Null: true},
		},
		PK: []string{"id"},
	}
}

func sessions() Table {
	return Table{
		Name: "sessions",
		Why:  "A logged-in session. Its token is what proxy.go hands the page.",
		Columns: []Column{
			{Name: "id", Type: Name(100), Null: true, Why: nullablePK},
			{Name: "token", Type: Name(100), Null: true},
			{Name: "user_id", Type: Name(100), Null: true},
			{Name: "props", Type: Text(), Null: true},
			{Name: "create_at", Type: Millis(), Null: true},
			{Name: "update_at", Type: Millis(), Null: true},
			{Name: "auth_service", Type: Name(20), Null: true},
		},
		PK: []string{"id"},
	}
}

func systemSettings() Table {
	return Table{
		Name: "system_settings",
		Why:  "Key and value, for the handful of things the server records about itself.",
		Columns: []Column{
			{Name: "id", Type: Name(100), Null: true, Why: nullablePK},
			{Name: "value", Type: Text(), Null: true},
		},
		PK: []string{"id"},
	}
}

// boardColumns are the columns boards and boards_history share, which is all of
// them: a history row is the same board at an earlier moment.
func boardColumns() []Column {
	return []Column{
		{Name: "id", Type: Name(36)},
		insertAt(),
		{Name: "team_id", Type: Name(36)},
		{Name: "channel_id", Type: Name(36), Null: true,
			Why: "A remnant of the Mattermost plugin. Nothing writes it."},
		{Name: "created_by", Type: Name(36), Null: true},
		{Name: "modified_by", Type: Name(36), Null: true},
		{Name: "type", Type: Name(1), Why: "O — open, P — private."},
		{Name: "title", Type: Text()},
		{Name: "description", Type: Text(), Null: true},
		{Name: "icon", Type: Name(256), Null: true},
		{Name: "show_description", Type: Bool(), Null: true},
		{Name: "is_template", Type: Bool(), Null: true},
		{Name: "template_version", Type: Int32(), Null: true, Default: DefaultZero},
		{Name: "properties", Type: Text(), Null: true,
			Why: "The board's own automation lives here — xciiiColumns, xciiiFlows,\n" +
				"xciiiPrompt and the records of which field is which. JSON on purpose:\n" +
				"it travels with the board, into an export and into a template."},
		{Name: "card_properties", Type: Text(), Null: true,
			Why: "The schema of a card's fields. The product's main denormalisation, and\n" +
				"deliberately left alone: the whole webapp filters and groups on it."},
		{Name: "create_at", Type: Millis(), Null: true},
		{Name: "update_at", Type: Millis(), Null: true},
		{Name: "delete_at", Type: Millis(), Null: true},
		{Name: "minimum_role", Type: Name(36), Default: DefaultEmptyString},
	}
}

func boardsTable() Table {
	return Table{
		Name:    "boards",
		Why:     "A board.",
		Columns: boardColumns(),
		PK:      []string{"id"},
		Indexes: []Index{
			{Name: "idx_boards_team_id_is_template", Columns: []string{"team_id", "is_template"}},
			{Name: "idx_boards_channel_id", Columns: []string{"channel_id"}},
		},
	}
}

func boardsHistory() Table {
	return Table{
		Name: "boards_history",
		Why: "Every version of every board, one row per edit, never pruned. The\n" +
			"upstream's audit and undo mechanism; this product's undo is in the page\n" +
			"(webapp/src/undomanager.ts) and there is no history screen, so whether\n" +
			"to keep these three tables at all is a decision worth taking on its\n" +
			"own rather than inside a collapse.",
		Columns: boardColumns(),
		// The stamp is written by Go (utils.NextInsertAt) rather than by the
		// column's default, which is why this key holds: the default is the
		// database's clock at millisecond resolution, and inside a transaction
		// it hands every row of one statement the same instant.
		PK: []string{"id", "insert_at"},
	}
}

// blockColumns are shared by blocks and blocks_history, for the same reason the
// board's are.
func blockColumns() []Column {
	return []Column{
		{Name: "id", Type: Name(36), Null: true,
			Why: "Nullable, which a primary key makes impossible in practice — but this\n" +
				"is what the migrations leave, and reproducing it is the point."},
		insertAt(),
		{Name: "parent_id", Type: Name(36), Null: true,
			Why: "The tree inside a board: a comment or a text block hangs off a card."},
		{Name: "schema", Type: Millis(), Null: true,
			Why: "A version number for the row's own shape. Backticked by the fork's\n" +
				"queries on MySQL, where `schema` is reserved."},
		{Name: "type", Type: Text(), Null: true},
		{Name: "title", Type: Text(), Null: true},
		{Name: "fields", Type: Text(), Null: true,
			Why: "The card's field values, {property_id: value}."},
		{Name: "create_at", Type: Millis(), Null: true},
		{Name: "update_at", Type: Millis(), Null: true},
		{Name: "delete_at", Type: Millis(), Null: true},
		{Name: "modified_by", Type: Name(36), Null: true},
		{Name: "channel_id", Type: Name(36), Null: true},
		{Name: "created_by", Type: Name(36), Null: true},
		{Name: "board_id", Type: Name(36), Null: true},
	}
}

func blocksTable() Table {
	return Table{
		Name: "blocks",
		Why: "Everything on a board: cards, views, comments, text, attachments. A\n" +
			"card is a row here with type='card', and it is what every table this\n" +
			"application owns points at.",
		Columns: blockColumns(),
		PK:      []string{"id"},
		Indexes: []Index{
			{Name: "idx_blocks_board_id_parent_id", Columns: []string{"board_id", "parent_id"}},
		},
	}
}

func blocksHistory() Table {
	return Table{
		Name:    "blocks_history",
		Why:     "Every version of every block. See boards_history.",
		Columns: blockColumns(),
		// The stamp is written by Go (utils.NextInsertAt) rather than by the
		// column's default, which is why this key holds: the default is the
		// database's clock at millisecond resolution, and inside a transaction
		// it hands every row of one statement the same instant.
		PK: []string{"id", "insert_at"},
	}
}

func boardMembers() Table {
	return Table{
		Name: "board_members",
		Why:  "Who is on a board, and what they may do there.",
		Columns: []Column{
			{Name: "board_id", Type: Name(36)},
			{Name: "user_id", Type: Name(36)},
			{Name: "roles", Type: Name(64), Null: true},
			{Name: "scheme_admin", Type: Bool(), Null: true},
			{Name: "scheme_editor", Type: Bool(), Null: true},
			{Name: "scheme_commenter", Type: Bool(), Null: true},
			{Name: "scheme_viewer", Type: Bool(), Null: true},
		},
		PK: []string{"board_id", "user_id"},
		Indexes: []Index{
			{Name: "idx_board_members_user_id", Columns: []string{"user_id"}},
		},
	}
}

func boardMembersHistory() Table {
	return Table{
		Name: "board_members_history",
		Why:  "Who joined or left a board, and when.",
		Columns: []Column{
			{Name: "board_id", Type: Name(36)},
			{Name: "user_id", Type: Name(36)},
			{Name: "action", Type: Name(10), Null: true},
			insertAt(),
		},
		// The stamp is written by Go (utils.NextInsertAt) rather than by the
		// column's default, which is why this key holds: the default is the
		// database's clock at millisecond resolution, and inside a transaction
		// it hands every row of one statement the same instant.
		PK: []string{"board_id", "user_id", "insert_at"},
		Indexes: []Index{
			{Name: "idx_board_members_history_user_id", Columns: []string{"user_id"}},
			{Name: "idx_board_members_history_board_id_user_id", Columns: []string{"board_id", "user_id"}},
		},
	}
}

func categories() Table {
	return Table{
		Name: "categories",
		Why:  "A group of boards in the sidebar.",
		Columns: []Column{
			{Name: "id", Type: Name(36)},
			{Name: "name", Type: Name(100)},
			{Name: "user_id", Type: Name(36)},
			{Name: "team_id", Type: Name(36)},
			{Name: "channel_id", Type: Name(36), Null: true},
			{Name: "create_at", Type: Millis(), Null: true},
			{Name: "update_at", Type: Millis(), Null: true},
			{Name: "delete_at", Type: Millis(), Null: true},
			{Name: "collapsed", Type: Bool(), Null: true, Default: DefaultFalse},
			{Name: "type", Type: Name(64), Null: true},
			{Name: "sort_order", Type: Millis(), Null: true},
		},
		PK: []string{"id"},
		Indexes: []Index{
			{Name: "idx_categories_user_id_team_id", Columns: []string{"user_id", "team_id"}},
		},
	}
}

func categoryBoards() Table {
	return Table{
		Name: "category_boards",
		Why: "Which board sits in which sidebar group. The surrogate id is\n" +
			"upstream's; the row is really the pair, which the unique index says.",
		Columns: []Column{
			{Name: "id", Type: Name(36)},
			{Name: "user_id", Type: Name(36)},
			{Name: "category_id", Type: Name(36)},
			{Name: "board_id", Type: Name(36)},
			{Name: "create_at", Type: Millis(), Null: true},
			{Name: "update_at", Type: Millis(), Null: true},
			{Name: "sort_order", Type: Millis(), Null: true},
			{Name: "hidden", Type: Bool(), Null: true},
		},
		PK: []string{"id"},
		Indexes: []Index{
			{Name: "unique_user_category_board", Columns: []string{"user_id", "board_id"}, Unique: true},
		},
	}
}

func sharingTable() Table {
	return Table{
		Name: "sharing",
		Why:  "A board's public link. The id is the board's, so this is one-to-one.",
		Columns: []Column{
			{Name: "id", Type: Name(36), Null: true, Why: nullablePK},
			{Name: "enabled", Type: Bool(), Null: true},
			{Name: "token", Type: Name(100), Null: true},
			{Name: "modified_by", Type: Name(36), Null: true},
			{Name: "update_at", Type: Millis(), Null: true},
		},
		PK: []string{"id"},
	}
}

func fileInfo() Table {
	return Table{
		Name: "file_info",
		Why: "An attachment. It has no primary key, which is what the migrations\n" +
			"leave: 000041 was where one would have been added, and this is a\n" +
			"reproduction rather than a repair.",
		Columns: []Column{
			{Name: "id", Type: Name(36),
				Why: "Widened from the 26 the ladder declared, and the one place this schema\n" +
					"deliberately differs from it. It was already too narrow: utils.NewID\n" +
					"has always produced 27 characters, so on MySQL and Postgres every\n" +
					"attachment id was truncated by one. UUIDv7 needs 36, which is what\n" +
					"every other id column already holds."},
			{Name: "create_at", Type: Millis()},
			{Name: "delete_at", Type: Millis(), Null: true},
			{Name: "name", Type: Text()},
			{Name: "extension", Type: Name(50)},
			{Name: "size", Type: Millis()},
			{Name: "archived", Type: Bool(), Null: true},
			{Name: "path", Type: Name(512), Null: true},
		},
	}
}

func preferences() Table {
	return Table{
		Name: "preferences",
		Why: "What a person chose, per category and name. Not where this app keeps\n" +
			"the page's own settings — those are <dataDir>/ui-settings.json, because\n" +
			"the desktop window opens on a fresh origin every launch.",
		Columns: []Column{
			{Name: "userid", Type: Name(36)},
			{Name: "category", Type: Name(32)},
			{Name: "name", Type: Name(32)},
			{Name: "value", Type: Text(), Null: true},
		},
		PK: []string{"userid", "category", "name"},
		Indexes: []Index{
			{Name: "idx_preferences_category", Columns: []string{"category"}},
			{Name: "idx_preferences_name", Columns: []string{"name"}},
		},
	}
}

func subscriptions() Table {
	return Table{
		Name: "subscriptions",
		Why:  "Who is watching a block, for the notification service.",
		Columns: []Column{
			{Name: "block_type", Type: Name(10), Null: true},
			{Name: "block_id", Type: Name(36), Null: true, Why: nullablePK},
			{Name: "subscriber_type", Type: Name(10), Null: true},
			{Name: "subscriber_id", Type: Name(36), Null: true, Why: nullablePK},
			{Name: "notified_at", Type: Millis(), Null: true},
			{Name: "create_at", Type: Millis(), Null: true},
			{Name: "delete_at", Type: Millis(), Null: true},
		},
		PK: []string{"block_id", "subscriber_id"},
		Indexes: []Index{
			{Name: "idx_subscriptions_subscriber_id", Columns: []string{"subscriber_id"}},
		},
	}
}

func notificationHints() Table {
	return Table{
		Name: "notification_hints",
		Why:  "A block that has changed and whose watchers have not been told yet.",
		Columns: []Column{
			{Name: "block_type", Type: Name(10), Null: true},
			{Name: "block_id", Type: Name(36), Null: true, Why: nullablePK},
			{Name: "modified_by_id", Type: Name(36), Null: true},
			{Name: "create_at", Type: Millis(), Null: true},
			{Name: "notify_at", Type: Millis(), Null: true},
		},
		PK: []string{"block_id"},
	}
}
