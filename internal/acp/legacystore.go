package acp

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"
)

// ImportLegacyStore carries an `acp.db` from before the move into the board's
// own database, once, and then puts the file beyond reach of a second import by
// renaming it.
//
// It is written against the *old* schema on purpose — the one internal/acp
// created for itself, with terminal_session, `key`, `at` and autoincrement
// journals — because that is the only schema the file it reads can have. Which
// is also why it does not go through Store: nothing else in this package should
// know the old names.
//
// The file is renamed rather than deleted. What it holds is a person's work —
// which branch a card was on, what an agent said when it finished — and the
// judgement that it arrived safely is theirs to make, not this function's.
func ImportLegacyStore(db *sql.DB, tablePrefix, path string) (rows int, err error) {
	old, err := openLegacy(path)
	if old == nil || err != nil {
		return 0, err
	}
	defer old.Close()

	s := &Store{db: db, prefix: tablePrefix}
	s.board = &presence{db: db, prefix: tablePrefix, seen: map[string]bool{}}
	for _, carry := range []func(*Store, *sql.DB) (int, error){
		carrySessions,
		carrySessionEvents,
		carryConversations,
		carryFlowState,
		carryFlowEvents,
		carryStalls,
		carryQueue,
		carrySetup,
		carryVCSSeen,
		carryClaims,
	} {
		n, err := carry(s, old)
		if err != nil {
			return rows, err
		}
		rows += n
	}

	if err := old.Close(); err != nil {
		return rows, err
	}
	return rows, os.Rename(path, path+".migrated")
}

// openLegacy opens the old file if there is one to open. A missing file is the
// ordinary case — every install made after the move has none — and is not an
// error.
func openLegacy(path string) (*sql.DB, error) {
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	driver, ok := sqliteDriver()
	if !ok {
		return nil, fmt.Errorf("cannot read the previous agent database %s: no SQLite driver in this build", path)
	}
	db, err := sql.Open(driver, path+"?_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("cannot read the previous agent database %s: %w", path, err)
	}
	return db, nil
}

// presence answers whether the board still has a row. The old file has no way
// of knowing: deleting a card is a real DELETE FROM blocks and nothing ever told
// this side, so a database from before the move is full of conversations,
// stalls and queue slots belonging to cards that went months ago. That is the
// leak the move is for, and carrying those rows in would write the exact
// dangling references the foreign keys are meant to forbid — the import would
// then be the one thing standing between the schema and step 4.
//
// Answers are remembered because a file names the same handful of cards over
// and over.
type presence struct {
	db     *sql.DB
	prefix string
	seen   map[string]bool
}

func (p *presence) has(table, id string) bool {
	if p == nil || id == "" {
		return false
	}
	key := table + "\x00" + id
	if known, ok := p.seen[key]; ok {
		return known
	}
	var one int
	err := p.db.QueryRow(`SELECT 1 FROM `+p.prefix+table+` WHERE id=?`, id).Scan(&one)
	known := err == nil
	p.seen[key] = known
	return known
}

// card and board are the two questions every carry function asks.
func (s *Store) hasCard(id string) bool  { return s.board.has("blocks", id) }
func (s *Store) hasBoard(id string) bool { return s.board.has("boards", id) }

// nullable turns the old schema's empty strings back into absence. Almost every
// column there was NOT NULL with the empty string as its default, including the
// ones where empty meant "there is none" — a planning conversation's card, an
// ordinary folder's branch. A foreign key can only say that with NULL.
func nullable(v string) any {
	if v == "" {
		return nil
	}
	return v
}

// nullableMillis is the same for a moment that may not have happened.
func nullableMillis(v sql.NullInt64) any {
	if !v.Valid {
		return nil
	}
	return v.Int64
}

func carrySessions(s *Store, old *sql.DB) (int, error) {
	rows, err := old.Query(`SELECT id, card_id, board_id, agent_kind, acp_session_id, status,
		cwd, worktree_path, branch, started_at, finished_at, error_text FROM agent_session`)
	if err != nil {
		return 0, skipMissingTable(err)
	}
	defer rows.Close()
	n := 0
	carried := map[string]bool{}
	for rows.Next() {
		var (
			id, cardID, boardID, kind, acpID, status string
			cwd, worktree, branch, errText           string
			started                                  int64
			finished                                 sql.NullInt64
		)
		if err := rows.Scan(&id, &cardID, &boardID, &kind, &acpID, &status,
			&cwd, &worktree, &branch, &started, &finished, &errText); err != nil {
			return n, err
		}
		// A session about a card the board no longer has would die with that
		// card under ON DELETE CASCADE; it should never have outlived it.
		if cardID != "" && !s.hasCard(cardID) {
			continue
		}
		if boardID != "" && !s.hasBoard(boardID) {
			boardID = ""
		}
		carried[id] = true
		if _, err := s.exec(`INSERT INTO {agent_session}
			(id, card_id, board_id, agent_kind, acp_session_id, status, cwd, worktree_path, branch, started_at, finished_at, error_text)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
			id, nullable(cardID), nullable(boardID), kind, nullable(acpID), status,
			nullable(cwd), nullable(worktree), nullable(branch), started, nullableMillis(finished), nullable(errText)); err != nil {
			return n, err
		}
		n++
	}
	if err := rows.Err(); err != nil {
		return n, err
	}
	s.carriedSessions = carried
	return n, nil
}

func carrySessionEvents(s *Store, old *sql.DB) (int, error) {
	// Ordered by the old autoincrement so the new UUIDv7 ids come out in the
	// same order: v7 sorts by the moment it was made, and these are made now.
	rows, err := old.Query(`SELECT session_id, kind, payload_json, created_at FROM session_event ORDER BY id`)
	if err != nil {
		return 0, skipMissingTable(err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var sessionID, kind, payload string
		var created int64
		if err := rows.Scan(&sessionID, &kind, &payload, &created); err != nil {
			return n, err
		}
		// The journal goes with its session, which is what its own key says.
		if !s.carriedSessions[sessionID] {
			continue
		}
		if _, err := s.exec(`INSERT INTO {session_event} (id, session_id, kind, payload_json, created_at)
			VALUES (?,?,?,?,?)`, newID(), sessionID, kind, nullable(payload), created); err != nil {
			return n, err
		}
		n++
	}
	return n, rows.Err()
}

func carryConversations(s *Store, old *sql.DB) (int, error) {
	rows, err := old.Query(`SELECT id, card_id, node_id, column_name, board_id, title, repo_path,
		cwd, branch, agent, kind, summary, started_at, ended_at, exit_code FROM terminal_session`)
	if err != nil {
		return 0, skipMissingTable(err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var (
			id, cardID, nodeID, columnName, boardID, title string
			workdir, cwd, branch, agent, kind, summary     string
			started                                        int64
			ended                                          sql.NullInt64
			exit                                           int
		)
		if err := rows.Scan(&id, &cardID, &nodeID, &columnName, &boardID, &title, &workdir,
			&cwd, &branch, &agent, &kind, &summary, &started, &ended, &exit); err != nil {
			return n, err
		}
		// A conversation about a card, or on a board, that is gone goes with it.
		// A planning conversation has no card and is kept on its board alone.
		if cardID != "" && !s.hasCard(cardID) {
			continue
		}
		if boardID != "" && !s.hasBoard(boardID) {
			continue
		}
		if _, err := s.exec(`INSERT INTO {conversation}
			(id, card_id, node_id, column_name, board_id, title, workdir_path, cwd, branch, agent, kind, summary, started_at, ended_at, exit_code)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
			id, nullable(cardID), nodeID, nullable(columnName), nullable(boardID), nullable(title),
			nullable(workdir), nullable(cwd), nullable(branch), nullable(agent), nullable(kind),
			nullable(summary), started, nullableMillis(ended), exit); err != nil {
			return n, err
		}
		n++
	}
	return n, rows.Err()
}

func carryFlowState(s *Store, old *sql.DB) (int, error) {
	rows, err := old.Query(`SELECT card_id, board_id, flow, node_id, branch, repo_path, entered_at FROM flow_state`)
	if err != nil {
		return 0, skipMissingTable(err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var cardID, boardID, flow, nodeID, branch, workdir string
		var entered int64
		if err := rows.Scan(&cardID, &boardID, &flow, &nodeID, &branch, &workdir, &entered); err != nil {
			return n, err
		}
		if !s.hasCard(cardID) {
			continue
		}
		if boardID != "" && !s.hasBoard(boardID) {
			boardID = ""
		}
		if _, err := s.exec(`INSERT INTO {flow_state} (card_id, board_id, flow, node_id, branch, workdir_path, entered_at)
			VALUES (?,?,?,?,?,?,?) ON CONFLICT(card_id) DO NOTHING`,
			cardID, nullable(boardID), flow, nodeID, nullable(branch), nullable(workdir), entered); err != nil {
			return n, err
		}
		n++
	}
	return n, rows.Err()
}

func carryFlowEvents(s *Store, old *sql.DB) (int, error) {
	rows, err := old.Query(`SELECT card_id, flow, from_node, to_node, on_kind, detail, said, created_at
		FROM flow_event ORDER BY id`)
	if err != nil {
		return 0, skipMissingTable(err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var cardID, flow, from, to, on, detail, said string
		var created int64
		if err := rows.Scan(&cardID, &flow, &from, &to, &on, &detail, &said, &created); err != nil {
			return n, err
		}
		if !s.hasCard(cardID) {
			continue
		}
		if _, err := s.exec(`INSERT INTO {flow_event} (id, card_id, flow, from_node, to_node, on_kind, detail, said, created_at)
			VALUES (?,?,?,?,?,?,?,?,?)`,
			newID(), cardID, flow, nullable(from), to, on, nullable(detail), nullable(said), created); err != nil {
			return n, err
		}
		n++
	}
	return n, rows.Err()
}

func carryStalls(s *Store, old *sql.DB) (int, error) {
	rows, err := old.Query(`SELECT card_id, node_id, kind, reason, created_at FROM card_stall`)
	if err != nil {
		return 0, skipMissingTable(err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var cardID, nodeID, kind, reason string
		var created int64
		if err := rows.Scan(&cardID, &nodeID, &kind, &reason, &created); err != nil {
			return n, err
		}
		if !s.hasCard(cardID) {
			continue
		}
		if _, err := s.exec(`INSERT INTO {card_stall} (card_id, node_id, kind, reason, created_at)
			VALUES (?,?,?,?,?) ON CONFLICT(card_id) DO NOTHING`,
			cardID, nullable(nodeID), nullable(kind), reason, created); err != nil {
			return n, err
		}
		n++
	}
	return n, rows.Err()
}

func carryQueue(s *Store, old *sql.DB) (int, error) {
	rows, err := old.Query(`SELECT card_id, board_id, column_key, flow, node_id, queued_at FROM stage_queue`)
	if err != nil {
		return 0, skipMissingTable(err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var cardID, boardID, columnKey, flow, nodeID string
		var queued int64
		if err := rows.Scan(&cardID, &boardID, &columnKey, &flow, &nodeID, &queued); err != nil {
			return n, err
		}
		if !s.hasCard(cardID) {
			continue
		}
		if boardID != "" && !s.hasBoard(boardID) {
			boardID = ""
		}
		if _, err := s.exec(`INSERT INTO {stage_queue} (card_id, board_id, column_key, flow, node_id, queued_at)
			VALUES (?,?,?,?,?,?) ON CONFLICT(card_id) DO NOTHING`,
			cardID, nullable(boardID), columnKey, nullable(flow), nullable(nodeID), queued); err != nil {
			return n, err
		}
		n++
	}
	return n, rows.Err()
}

func carrySetup(s *Store, old *sql.DB) (int, error) {
	rows, err := old.Query(`SELECT board_id, step, status, at FROM board_setup`)
	if err != nil {
		return 0, skipMissingTable(err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var boardID, step, status string
		var at int64
		if err := rows.Scan(&boardID, &step, &status, &at); err != nil {
			return n, err
		}
		if !s.hasBoard(boardID) {
			continue
		}
		if _, err := s.exec(`INSERT INTO {board_setup} (board_id, step, status, changed_at)
			VALUES (?,?,?,?) ON CONFLICT(board_id, step) DO NOTHING`, boardID, step, status, at); err != nil {
			return n, err
		}
		n++
	}
	return n, rows.Err()
}

func carryVCSSeen(s *Store, old *sql.DB) (int, error) {
	rows, err := old.Query(`SELECT project, branch, kind, marker, created_at FROM vcs_seen`)
	if err != nil {
		return 0, skipMissingTable(err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var project, branch, kind, marker string
		var created int64
		if err := rows.Scan(&project, &branch, &kind, &marker, &created); err != nil {
			return n, err
		}
		if _, err := s.exec(`INSERT INTO {vcs_seen} (workdir_path, branch, kind, marker, created_at)
			VALUES (?,?,?,?,?) ON CONFLICT(workdir_path, branch, kind) DO NOTHING`,
			project, branch, kind, nullable(marker), created); err != nil {
			return n, err
		}
		n++
	}
	return n, rows.Err()
}

func carryClaims(s *Store, old *sql.DB) (int, error) {
	rows, err := old.Query(`SELECT workdir, owner, mode, branch, path, base, created_at, released_at FROM workdir_claim`)
	if err != nil {
		return 0, skipMissingTable(err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var workdir, owner, mode, branch, path, base string
		var created int64
		var released sql.NullInt64
		if err := rows.Scan(&workdir, &owner, &mode, &branch, &path, &base, &created, &released); err != nil {
			return n, err
		}
		if _, err := s.exec(`INSERT INTO {workdir_claim} (workdir_path, owner, mode, branch, path, base, created_at, released_at)
			VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(workdir_path, owner) DO NOTHING`,
			workdir, owner, mode, nullable(branch), nullable(path), nullable(base),
			created, nullableMillis(released)); err != nil {
			return n, err
		}
		n++
	}
	return n, rows.Err()
}

// sqliteDriver is whichever SQLite driver this build registered. Which one it
// is depends on a build tag — cgo mattn under `sqlite3`, pure-Go modernc
// otherwise — and the legacy file is SQLite whatever the board itself runs on,
// so the name is asked for rather than assumed.
func sqliteDriver() (string, bool) {
	registered := sql.Drivers()
	for _, name := range []string{"sqlite3", "sqlite"} {
		if slices.Contains(registered, name) {
			return name, true
		}
	}
	return "", false
}

// skipMissingTable lets a file written by an older build through: the schema
// grew a table at a time, and a database made before one existed simply has
// nothing to carry from it.
func skipMissingTable(err error) error {
	if err == nil {
		return nil
	}
	if strings.Contains(err.Error(), "no such table") || strings.Contains(err.Error(), "no such column") {
		return nil
	}
	return err
}
