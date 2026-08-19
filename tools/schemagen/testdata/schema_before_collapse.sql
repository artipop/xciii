-- The schema the eighty-one migrations built, captured from a database they
-- had finished with, immediately before the collapse. Kept as a fixture
-- because the ladder that produced it no longer exists in this tree.
-- tools/schemagen's test checks that one step still builds this.

CREATE TABLE IF NOT EXISTS "blocks_history" (
	id VARCHAR(36),
	
	insert_at DATETIME NOT NULL DEFAULT(STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')),
	
	parent_id VARCHAR(36),
	schema BIGINT,
	type TEXT,
	title TEXT,
	fields TEXT,
	create_at BIGINT,
	update_at BIGINT,
	delete_at BIGINT, root_id varchar(36), modified_by varchar(36), channel_id varchar(36), created_by varchar(36), board_id varchar(36),
	PRIMARY KEY (id, insert_at)
);
CREATE TABLE system_settings (
	id VARCHAR(100),
	value TEXT,
	PRIMARY KEY (id)
);
CREATE TABLE users (
	id VARCHAR(100),
	username VARCHAR(100),
	email VARCHAR(255),
	password VARCHAR(100),
	mfa_secret VARCHAR(100),
	auth_service VARCHAR(20),
	auth_data VARCHAR(255),
	props       TEXT,
	create_at    BIGINT,
	update_at    BIGINT,
	delete_at    BIGINT,
	PRIMARY KEY (id)
);
CREATE TABLE sessions (
	id VARCHAR(100),
	token VARCHAR(100),
	user_id VARCHAR(100),
	props       TEXT,
	create_at    BIGINT,
	update_at    BIGINT, auth_service varchar(20),
	PRIMARY KEY (id)
);
CREATE TABLE sharing (
	id VARCHAR(36),
	enabled BOOLEAN,
	token VARCHAR(100),
	modified_by VARCHAR(36),
	update_at BIGINT, workspace_id varchar(36),
	PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS "teams" (
	id VARCHAR(36),
	signup_token VARCHAR(100) NOT NULL,
	settings TEXT,
	modified_by VARCHAR(36),
	update_at BIGINT,
	PRIMARY KEY (id)
);
CREATE TABLE subscriptions (
	block_type VARCHAR(10),
	block_id VARCHAR(36),
	workspace_id VARCHAR(36),
	subscriber_type VARCHAR(10),
	subscriber_id VARCHAR(36),
	notified_at BIGINT,
	create_at BIGINT,
	delete_at BIGINT,
	PRIMARY KEY (block_id, subscriber_id)
);
CREATE TABLE notification_hints (
	block_type VARCHAR(10),
	block_id VARCHAR(36),
	workspace_id VARCHAR(36),
	modified_by_id VARCHAR(36),
	create_at BIGINT,
	notify_at BIGINT,
	PRIMARY KEY (block_id)
);
CREATE TABLE file_info (
    id varchar(26) NOT NULL,
    create_at BIGINT NOT NULL,
    delete_at BIGINT,
    name TEXT NOT NULL,
    extension VARCHAR(50) NOT NULL,
    size BIGINT NOT NULL,
    archived BOOLEAN
, path varchar(512));
CREATE TABLE boards (
    id VARCHAR(36) NOT NULL PRIMARY KEY,

    
	insert_at DATETIME NOT NULL DEFAULT(STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')),
	

    team_id VARCHAR(36) NOT NULL,
    channel_id VARCHAR(36),
    created_by VARCHAR(36),
    modified_by VARCHAR(36),
    type VARCHAR(1) NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    icon VARCHAR(256),
    show_description BOOLEAN,
    is_template BOOLEAN,
    template_version INT DEFAULT 0,
    
    
    
    properties TEXT,
    card_properties TEXT,
    
    create_at BIGINT,
    update_at BIGINT,
    delete_at BIGINT
, minimum_role varchar(36) NOT NULL DEFAULT '');
CREATE INDEX idx_boards_team_id_is_template ON boards (team_id, is_template);
CREATE INDEX idx_boards_channel_id ON boards (channel_id);
CREATE TABLE boards_history (
    id VARCHAR(36) NOT NULL,

    
	insert_at DATETIME NOT NULL DEFAULT(STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')),
	

    team_id VARCHAR(36) NOT NULL,
    channel_id VARCHAR(36),
    created_by VARCHAR(36),
    modified_by VARCHAR(36),
    type VARCHAR(1) NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    icon VARCHAR(256),
    show_description BOOLEAN,
    is_template BOOLEAN,
    template_version INT DEFAULT 0,
    
    
    
    properties TEXT,
    card_properties TEXT,
    
    create_at BIGINT,
    update_at BIGINT,
    delete_at BIGINT, minimum_role varchar(36) NOT NULL DEFAULT '',

    PRIMARY KEY (id, insert_at)
);
CREATE TABLE board_members (
    board_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    roles VARCHAR(64),
    scheme_admin BOOLEAN,
    scheme_editor BOOLEAN,
    scheme_commenter BOOLEAN,
    scheme_viewer BOOLEAN,
    PRIMARY KEY (board_id, user_id)
);
CREATE INDEX idx_board_members_user_id ON board_members (user_id);
CREATE TABLE categories (
    id varchar(36) NOT NULL,
    name varchar(100) NOT NULL,
    user_id varchar(36) NOT NULL,
    team_id varchar(36) NOT NULL,
    channel_id varchar(36),
    create_at BIGINT,
    update_at BIGINT,
    delete_at BIGINT, collapsed boolean default false, type varchar(64), sort_order BIGINT,
    PRIMARY KEY (id)
    );
CREATE INDEX idx_categories_user_id_team_id ON categories (user_id, team_id);
CREATE TABLE board_members_history (
    board_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    action VARCHAR(10),
    
	insert_at DATETIME NOT NULL DEFAULT(STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')),
	
    PRIMARY KEY (board_id, user_id, insert_at)
);
CREATE INDEX idx_board_members_history_user_id ON board_members_history (user_id);
CREATE INDEX idx_board_members_history_board_id_user_id ON board_members_history (board_id, user_id);
CREATE TABLE blocks (
        id VARCHAR(36),
        insert_at DATETIME NOT NULL DEFAULT(STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')),
        parent_id VARCHAR(36),
        schema BIGINT,
        type TEXT,
        title TEXT,
        fields TEXT,
        create_at BIGINT,
        update_at BIGINT,
        delete_at BIGINT,
        root_id VARCHAR(36),
        modified_by VARCHAR(36),
        channel_id VARCHAR(36),
        created_by VARCHAR(36),
        board_id VARCHAR(36),
        PRIMARY KEY (id)
);
CREATE INDEX idx_blocks_board_id_parent_id ON blocks (board_id, parent_id);
CREATE INDEX idx_subscriptions_subscriber_id ON subscriptions (subscriber_id);
CREATE TABLE preferences
(
    userid   VARCHAR(36) NOT NULL,
    category VARCHAR(32) NOT NULL,
    name     VARCHAR(32) NOT NULL,
    value    TEXT        NULL,
    PRIMARY KEY (userid, category, name)
);
CREATE INDEX idx_preferences_category ON preferences (category);
CREATE INDEX idx_preferences_name ON preferences (name);
CREATE TABLE category_boards (
        id varchar(36) NOT NULL,
        user_id varchar(36) NOT NULL,
        category_id varchar(36) NOT NULL,
        board_id VARCHAR(36) NOT NULL,
        create_at BIGINT,
        update_at BIGINT,
        sort_order BIGINT,
        hidden boolean,
        PRIMARY KEY (id),
        CONSTRAINT unique_user_category_board UNIQUE (user_id, board_id)
    );

-- Network settings several agents share, so they are edited in one
-- place. Was the `proxies` array in config.json.
--   password: Kept apart from the URL so it is entered raw and masked on screen.
--     Still stored in the clear here, exactly as it was in the settings
--     file: moving it into internal/secrets is its own change.
CREATE TABLE `proxy` (`id` varchar NOT NULL, `name` varchar NOT NULL, `url` text NULL, `no_proxy` text NULL, `ca_cert` text NULL, `username` varchar NULL, `password` text NULL, `created_at` bigint NOT NULL, PRIMARY KEY (`id`));

CREATE UNIQUE INDEX `idx_proxy_name` ON `proxy` (`name`);

-- A named place an agent can work in. Was the `projects` array in
-- config.json; a card points at it by id, which is also the id of the
-- board option offered for it, so a card naming its folder is a card
-- holding an ordinary select value that happens to be a reference.
--   name: A caption, not a key. Renaming it breaks nothing, which is the
--     whole reason the id exists.
--   board_id: The board that offers this folder, and the only one that does.
--     NULL means no board has claimed it — a state the product already
--     has a name and a screen for, which is why a deleted board sets this
--     to NULL rather than taking the registry entry with it.
--   global: «На всех досках»: one entry seen from several boards, which is what
--     makes the mode belong to the pair rather than to the folder.
--   kind: What somebody was promised, not what the folder happens to be:
--     'git' means a repository was demanded and one without git is an
--     error. NULL is the ordinary case and means nobody said.
CREATE TABLE `workspace` (`id` varchar NOT NULL, `name` varchar NOT NULL, `path` text NULL, `board_id` varchar NULL, `global` boolean NOT NULL, `kind` varchar NULL, `base_branch` varchar NULL, `branch_prefix` varchar NULL, `created_at` bigint NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `workspace_offered_on` FOREIGN KEY (`board_id`) REFERENCES `boards` (`id`) ON DELETE SET NULL);

CREATE UNIQUE INDEX `idx_workspace_name` ON `workspace` (`name`);

-- Which board a folder is offered to and how work happens in it there.
-- Keyed by the pair rather than by the folder, because a folder marked
-- «на всех досках» is one entry with a different answer per board: a copy
-- per card where three people work it, a branch in place where one does.
-- Was WorkdirEntry.Modes, a map keyed by board id.
--   mode: worktree | branch. NULL means nobody answered, and the machine's
--     own default stands in.
CREATE TABLE `workspace_board` (`workspace_id` varchar NOT NULL, `board_id` varchar NOT NULL, `mode` varchar NULL, PRIMARY KEY (`workspace_id`, `board_id`), CONSTRAINT `workspace_board_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`) ON DELETE CASCADE, CONSTRAINT `workspace_board_board` FOREIGN KEY (`board_id`) REFERENCES `boards` (`id`) ON DELETE CASCADE);

-- A registered agent. Its board account is a row in users, and the two
-- are joined by a key rather than by their names happening to match —
-- which is what made renaming an agent break the crew of every route on
-- every board, silently.
--   name: On screen and in the account's username. No longer a reference.
--   user_id: The board account. NULL until one is made, and NULL again if it is
--     deleted: the registry entry is the machine's and outlives it.
--   settings: env, args, cliArgs, options, autoAllowTools, command,
--     terminalCommand, mcpServers. JSON on purpose: this is how to start
--     a process, it points at nothing and nothing joins to it.
CREATE TABLE `agent` (`id` varchar NOT NULL, `name` varchar NOT NULL, `kind` varchar NOT NULL, `user_id` varchar NULL, `proxy_id` varchar NULL, `bin_path` text NULL, `model` varchar NULL, `prompt` text NULL, `settings` text NULL, `created_at` bigint NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `agent_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL, CONSTRAINT `agent_proxy` FOREIGN KEY (`proxy_id`) REFERENCES `proxy` (`id`) ON DELETE SET NULL);

CREATE UNIQUE INDEX `idx_agent_name` ON `agent` (`name`);

-- Where a card's branch is published. Was the `deploys` array in
-- config.json, and a route's stage named it by name.
CREATE TABLE `deploy_target` (`id` varchar NOT NULL, `name` varchar NOT NULL, `ssh_host` varchar NOT NULL, `ssh_user` varchar NULL, `ssh_port` bigint NULL, `ssh_key` text NULL, `base_app` varchar NULL, `base_domain` varchar NULL, `created_at` bigint NOT NULL, PRIMARY KEY (`id`));

CREATE UNIQUE INDEX `idx_deploy_target_name` ON `deploy_target` (`name`);

-- A run of an agent over ACP. One process, one verdict: unlike a
-- conversation, it is never resumed, which is why the two are
-- separate tables and not one row with a transport column.
--   card_id: NULL for a run that is about no card — naming a branch is one.
--   finished_at: NULL means the session is still live.
CREATE TABLE `agent_session` (`id` varchar NOT NULL, `card_id` varchar NULL, `board_id` varchar NULL, `agent_kind` varchar NOT NULL, `acp_session_id` varchar NULL, `status` varchar NOT NULL, `cwd` text NULL, `worktree_path` text NULL, `branch` varchar NULL, `started_at` bigint NOT NULL, `finished_at` bigint NULL, `error_text` text NULL, PRIMARY KEY (`id`), CONSTRAINT `agent_session_card` FOREIGN KEY (`card_id`) REFERENCES `blocks` (`id`) ON DELETE CASCADE, CONSTRAINT `agent_session_board` FOREIGN KEY (`board_id`) REFERENCES `boards` (`id`) ON DELETE CASCADE);

CREATE INDEX `idx_agent_session_card` ON `agent_session` (`card_id`, `started_at`);

-- What happened during a session, in order. The id is a UUIDv7 rather
-- than an autoincrement: v7 sorts by time, so ORDER BY id still means
-- "as it happened" and the three spellings of AUTO_INCREMENT are gone.
-- `seq` went with them — it was the same fact told twice.
CREATE TABLE `session_event` (`id` varchar NOT NULL, `session_id` varchar NOT NULL, `kind` varchar NOT NULL, `payload_json` text NULL, `created_at` bigint NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `session_event_session` FOREIGN KEY (`session_id`) REFERENCES `agent_session` (`id`) ON DELETE CASCADE);

CREATE INDEX `idx_session_event_session` ON `session_event` (`session_id`, `id`);

-- A conversation with an agent: its CLI in a pty, keyed (card, node).
-- The row outlives every process that ever drew it — that is what makes
-- a conversation resumable, and it is the difference from agent_session,
-- which is one run and then over.
--   card_id: NULL for a planning conversation: it is about no card.
--   node_id: The column's option id — work; '@talk' — discussion; '@none' — a
--     card with no column at all.
--   column_name: What the column was called at the time, frozen: the option may be
--     gone, and the row still has to read the same.
--   summary: The agent's own line about what this conversation is doing.
--   workdir_path: Was repo_path. Becomes workspace_id in the second half of step 2,
--     together with the code that resolves a folder to its registry id.
CREATE TABLE `conversation` (`id` varchar NOT NULL, `card_id` varchar NULL, `board_id` varchar NULL, `node_id` varchar NOT NULL, `column_name` varchar NULL, `title` text NULL, `summary` text NULL, `agent` varchar NULL, `kind` varchar NULL, `workdir_path` text NULL, `cwd` text NULL, `branch` varchar NULL, `started_at` bigint NOT NULL, `ended_at` bigint NULL, `exit_code` bigint NULL, PRIMARY KEY (`id`), CONSTRAINT `conversation_card` FOREIGN KEY (`card_id`) REFERENCES `blocks` (`id`) ON DELETE CASCADE, CONSTRAINT `conversation_board` FOREIGN KEY (`board_id`) REFERENCES `boards` (`id`) ON DELETE CASCADE);

CREATE INDEX `idx_conversation_card` ON `conversation` (`card_id`, `started_at`);

CREATE INDEX `idx_conversation_card_node` ON `conversation` (`card_id`, `node_id`, `started_at`);

-- One route event, handled once. `key` was the column's name and is a
-- reserved word in MySQL, so it is `token` — cheaper than backticks in
-- every query for ever.
CREATE TABLE `idempotency` (`token` varchar NOT NULL, `session_id` varchar NULL, `created_at` bigint NOT NULL, PRIMARY KEY (`token`));

CREATE INDEX `idx_idempotency_created` ON `idempotency` (`created_at`);

-- This machine's index of where each card is on its route. The truth is
-- on the card itself, so it travels with the board; this is what the VCS
-- watcher asks "which cards are parked and on what branch" in one query.
--   flow: The route's name. It has no id of its own yet — contradiction 4 of
--     docs/model-graph.md, which lives inside the board's JSON.
CREATE TABLE `flow_state` (`card_id` varchar NOT NULL, `board_id` varchar NULL, `flow` varchar NOT NULL, `node_id` varchar NOT NULL, `branch` varchar NULL, `workdir_path` text NULL, `entered_at` bigint NOT NULL, PRIMARY KEY (`card_id`), CONSTRAINT `flow_state_card` FOREIGN KEY (`card_id`) REFERENCES `blocks` (`id`) ON DELETE CASCADE, CONSTRAINT `flow_state_board` FOREIGN KEY (`board_id`) REFERENCES `boards` (`id`) ON DELETE CASCADE);

-- Every transition a card made, and what the agent said on it.
--   said: The agent's closing words: what a conversation is told instead of
--     its task when the card comes back to it.
CREATE TABLE `flow_event` (`id` varchar NOT NULL, `card_id` varchar NOT NULL, `flow` varchar NOT NULL, `from_node` varchar NULL, `to_node` varchar NOT NULL, `on_kind` varchar NOT NULL, `detail` text NULL, `said` text NULL, `created_at` bigint NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `flow_event_card` FOREIGN KEY (`card_id`) REFERENCES `blocks` (`id`) ON DELETE CASCADE);

CREATE INDEX `idx_flow_event_card` ON `flow_event` (`card_id`, `id`);

-- One current reason a card is not moving — not a journal. The reason is
-- true only until somebody fixes what it is about, and a comment would
-- outlive it as noise.
--   kind: 'conversation' is the one kind with somewhere to go: open the
--     terminal. The rest have no button, which is why this is a field and
--     never a reading of the reason's own Russian.
CREATE TABLE `card_stall` (`card_id` varchar NOT NULL, `node_id` varchar NULL, `kind` varchar NULL, `reason` text NOT NULL, `created_at` bigint NOT NULL, PRIMARY KEY (`card_id`), CONSTRAINT `card_stall_card` FOREIGN KEY (`card_id`) REFERENCES `blocks` (`id`) ON DELETE CASCADE);

-- A card waiting for its column to free up a place.
--   column_key: board|option — the queue belongs to one column of one board.
CREATE TABLE `stage_queue` (`card_id` varchar NOT NULL, `board_id` varchar NULL, `column_key` varchar NOT NULL, `flow` varchar NULL, `node_id` varchar NULL, `queued_at` bigint NOT NULL, PRIMARY KEY (`card_id`), CONSTRAINT `stage_queue_card` FOREIGN KEY (`card_id`) REFERENCES `blocks` (`id`) ON DELETE CASCADE, CONSTRAINT `stage_queue_board` FOREIGN KEY (`board_id`) REFERENCES `boards` (`id`) ON DELETE CASCADE);

CREATE INDEX `idx_stage_queue_column` ON `stage_queue` (`column_key`, `queued_at`);

-- Which setup questions a board has been asked. It is about this machine
-- — the answers are folders and hosts here — so it cannot live in the
-- browser's storage, which the desktop window forgets on every launch.
--   changed_at: Was `at`. AT is a keyword in Postgres and a name not worth having.
CREATE TABLE `board_setup` (`board_id` varchar NOT NULL, `step` varchar NOT NULL, `status` varchar NOT NULL, `changed_at` bigint NOT NULL, PRIMARY KEY (`board_id`, `step`), CONSTRAINT `board_setup_board` FOREIGN KEY (`board_id`) REFERENCES `boards` (`id`) ON DELETE CASCADE);

-- This branch event has already been acted on. Keyed by the workspace
-- rather than by its path: a folder somebody moved used to keep its
-- latches, and MySQL would refuse a path in a key of any real length.
--   marker: The commit the event refers to: the same state seen twice fires once.
CREATE TABLE `vcs_seen` (`workspace_id` varchar NOT NULL, `branch` varchar NOT NULL, `kind` varchar NOT NULL, `marker` varchar NULL, `created_at` bigint NOT NULL, PRIMARY KEY (`workspace_id`, `branch`, `kind`), CONSTRAINT `vcs_seen_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`) ON DELETE CASCADE);

-- The directory and the branch one owner holds in one workspace. The
-- owner is a card, or a board for a conversation with no card — two
-- nullable columns rather than one string, because a foreign key cannot
-- point at two tables through one.
--   id: A surrogate, and the one place in this schema where that is right:
--     the natural key would have to include a nullable column, which MySQL
--     and Postgres forbid in a primary key. Uniqueness is stated in the
--     indexes below instead, where a NULL is allowed to differ from a NULL.
--     Nothing outside this application creates a checkout, so no client has
--     to be able to supply the id.
--   board_id: Set for «черновики доски»: a conversation with no card still works
--     somewhere, and that somewhere belongs to the board.
--   path: Where the copy is. Not the workspace's own path — that is on the
--     workspace, and this is the worktree cut from it.
--   base: What the branch was cut from, and therefore what «merged» means.
--   released_at: NULL means the checkout is live.
CREATE TABLE `checkout` (`id` varchar NOT NULL, `workspace_id` varchar NOT NULL, `card_id` varchar NULL, `board_id` varchar NULL, `mode` varchar NOT NULL, `branch` varchar NULL, `path` text NULL, `base` varchar NULL, `created_at` bigint NOT NULL, `released_at` bigint NULL, PRIMARY KEY (`id`), CONSTRAINT `checkout_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspace` (`id`) ON DELETE RESTRICT, CONSTRAINT `checkout_card` FOREIGN KEY (`card_id`) REFERENCES `blocks` (`id`) ON DELETE CASCADE, CONSTRAINT `checkout_board` FOREIGN KEY (`board_id`) REFERENCES `boards` (`id`) ON DELETE CASCADE);

CREATE UNIQUE INDEX `idx_checkout_card` ON `checkout` (`workspace_id`, `card_id`);

CREATE UNIQUE INDEX `idx_checkout_board` ON `checkout` (`workspace_id`, `board_id`);

CREATE INDEX `idx_checkout_live` ON `checkout` (`workspace_id`, `released_at`);

-- What a source has already brought. The same letter arriving twice adds
-- to the card it made rather than making a second one.
--   version: The service's own updated/etag: changed means there is something
--     to add.
CREATE TABLE `source_item` (`source` varchar NOT NULL, `external_id` varchar NOT NULL, `version` varchar NULL, `card_id` varchar NULL, `created_at` bigint NOT NULL, `updated_at` bigint NOT NULL, PRIMARY KEY (`source`, `external_id`), CONSTRAINT `source_item_card` FOREIGN KEY (`card_id`) REFERENCES `blocks` (`id`) ON DELETE SET NULL);

CREATE INDEX `idx_source_item_card` ON `source_item` (`card_id`);

-- Why nothing happened — the only question anybody asks of a source.
-- Deleting the card it produced does not delete the line: what a source
-- decided is a fact about the source.
CREATE TABLE `source_event` (`id` varchar NOT NULL, `source` varchar NOT NULL, `external_id` varchar NULL, `rule` varchar NULL, `outcome` varchar NOT NULL, `card_id` varchar NULL, `detail` text NULL, `created_at` bigint NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `source_event_card` FOREIGN KEY (`card_id`) REFERENCES `blocks` (`id`) ON DELETE SET NULL);

CREATE INDEX `idx_source_event_source` ON `source_event` (`source`, `id`);
