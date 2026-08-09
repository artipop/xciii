package acp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// A board's automation lives on the board. The columns it runs and the routes
// cards take across it are two of the board's own properties, in the board
// database, beside everything else that is the board's — which is why a board
// made from the «Разработка» template works before anything is configured, and
// why a template can carry automation at all.
//
// It used to live in config.json beside the app, and that was the wrong shelf:
// the file went stale when a board was deleted, no backup or export of the
// boards contained it, and a board carried to another machine arrived without
// the thing that makes it run. The registry in memory is still what the engine
// reads on every card move — a board read per move would be absurd — but it is
// a cache of what the boards say, and every edit is written through to the
// board it belongs to (persistBoardLocked). What stays in the file is what the
// machine owns: agents, projects, deploy targets, prompts.
//
// A template's automation is still a **seed** for a board made from it: it is
// imported once, tagged with the new board's id, and from then on that board
// owns it. A template that changes later does not rewrite a board somebody has
// since adjusted.

// Board properties the template writes its automation into. The third is not
// automation but the questions the board needs answered before any of it can
// run — see setup.go; it is read there rather than adopted here, because it is
// about this machine and nothing about it belongs in the registry.
const (
	BoardPropColumns = "acpColumns"
	BoardPropFlows   = "acpFlows"
	BoardPropSetup   = "acpSetup"
)

// BoardMeta is the board's own properties — where a board keeps the automation
// it runs and a template the automation it ships — and whether the board is
// itself a template. Optional: without it a board brings nothing and keeps
// nothing, and the registry falls back to the file it used to live in.
type BoardMeta interface {
	BoardProperties(ctx context.Context, boardID string) (map[string]any, error)
	// SetBoardProperties writes the named properties onto the board, leaving
	// the ones it does not name alone. This is how a board's automation is
	// saved: the board is where it belongs, so the board is what is patched.
	SetBoardProperties(ctx context.Context, boardID string, props map[string]any) error
	// IsBoardTemplate says this board is one to copy rather than to work in.
	// Nothing runs in a template — no card moves in it, no session starts from
	// it — so nothing about this machine is asked for on its behalf.
	IsBoardTemplate(ctx context.Context, boardID string) (bool, error)
}

// SetBoardMeta supplies the board's own property store.
func (m *Manager) SetBoardMeta(b BoardMeta) { m.meta = b }

// SeedBoard takes a board's own automation into the registry on demand — what
// the first card move would do anyway, asked for early by the setup wizard.
func (m *Manager) SeedBoard(boardID string) { m.seedFromBoard(boardID) }

// seedFromBoard imports whatever automation a board carries. It runs once per
// board per run: the import is idempotent anyway (anything already registered
// is left alone), and the point of the flag is to not read the board on every
// card move.
func (m *Manager) seedFromBoard(boardID string) {
	if boardID == "" || m.meta == nil {
		return
	}
	m.seededMu.Lock()
	if m.seeded == nil {
		m.seeded = make(map[string]bool)
	}
	if m.seeded[boardID] {
		m.seededMu.Unlock()
		return
	}
	m.seeded[boardID] = true
	m.seededMu.Unlock()

	// The wizard may ask before the trigger loop has started, and a nil parent
	// context is a panic rather than a timeout.
	parent := m.rootCtx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	props, err := m.meta.BoardProperties(ctx, boardID)
	cancel()
	if err != nil {
		m.log.Warn("acp: cannot read the board's own settings", "board", boardID, "err", err)
		return
	}
	if len(props) == 0 {
		return
	}

	columns, flows, err := parseBoardAutomation(props)
	if err != nil {
		m.log.Warn("acp: the board's own settings are unreadable", "board", boardID, "err", err)
		return
	}
	if added := m.adoptColumns(boardID, columns); added > 0 {
		m.log.Info("acp: columns taken from the board itself", "board", boardID, "count", added)
	}
	if added := m.adoptFlows(boardID, flows); added > 0 {
		m.log.Info("acp: routes taken from the board itself", "board", boardID, "count", added)
	}

	// The board is the store, so what the registry ended up with for this board
	// goes straight back onto it — which also settles the difference between
	// what the board shipped and what the machine's own file still remembered
	// for it, in the board's favour from here on.
	m.cfgMu.Lock()
	m.persistBoardLocked(boardID)
	err = m.persistConfigLocked()
	m.cfgMu.Unlock()
	if err != nil {
		m.log.Warn("acp: cannot rewrite the config after reading the board", "board", boardID, "err", err)
	}
}

// parseBoardAutomation reads the two properties a template writes. They arrive
// as whatever the board store decoded them into, so they are re-encoded and
// read back into the real types rather than picked apart by hand.
func parseBoardAutomation(props map[string]any) ([]ColumnSpec, []FlowEntry, error) {
	var columns []ColumnSpec
	if raw, ok := props[BoardPropColumns]; ok {
		if err := reinterpret(raw, &columns); err != nil {
			return nil, nil, fmt.Errorf("%s: %w", BoardPropColumns, err)
		}
	}
	var flows []FlowEntry
	if raw, ok := props[BoardPropFlows]; ok {
		if err := reinterpret(raw, &flows); err != nil {
			return nil, nil, fmt.Errorf("%s: %w", BoardPropFlows, err)
		}
	}
	return columns, flows, nil
}

func reinterpret(from any, into any) error {
	// A property may also arrive as the JSON text of itself: the board store
	// keeps free-form properties as strings in some paths.
	if text, ok := from.(string); ok {
		if strings.TrimSpace(text) == "" {
			return nil
		}
		return json.Unmarshal([]byte(text), into)
	}
	encoded, err := json.Marshal(from)
	if err != nil {
		return err
	}
	return json.Unmarshal(encoded, into)
}

// adoptColumns registers the board's columns, skipping any the registry already
// has an answer for — an edited column is the user's, not the template's.
func (m *Manager) adoptColumns(boardID string, columns []ColumnSpec) int {
	if len(columns) == 0 {
		return 0
	}
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()

	added := 0
	for _, c := range columns {
		c.BoardID = boardID
		valid, err := validateColumn(c, m.cfg.Agents, m.cfg.Deploys)
		if err != nil {
			m.log.Warn("acp: the board offers a column that cannot be used", "board", boardID, "column", c.Column, "err", err)
			continue
		}
		// A column the registry already answers for stays as it is — what
		// somebody edited is theirs. But a spec migrated from the old config
		// keys knows only a name, and the board knows exactly which option that
		// name turned out to be: take the binding, leave the behaviour.
		known := false
		for i, existing := range m.cfg.Columns {
			if !sameColumn(existing, valid) {
				continue
			}
			known = true
			if existing.OptionID == "" && valid.OptionID != "" {
				m.cfg.Columns[i].BoardID = valid.BoardID
				m.cfg.Columns[i].PropertyID = valid.PropertyID
				m.cfg.Columns[i].OptionID = valid.OptionID
				added++
			}
			break
		}
		if known {
			continue
		}
		m.cfg.Columns = append(m.cfg.Columns, valid)
		added++
	}
	if added > 0 {
		if err := m.persistConfigLocked(); err != nil {
			m.log.Warn("acp: cannot persist the board's columns", "board", boardID, "err", err)
		}
	}
	return added
}

// adoptFlows registers the board's routes under its own id, skipping names the
// board already has.
func (m *Manager) adoptFlows(boardID string, flows []FlowEntry) int {
	if len(flows) == 0 {
		return 0
	}
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()

	added := 0
	for _, f := range flows {
		f.BoardID = boardID
		valid, err := validateFlow(f, m.cfg.Projects, m.cfg.Agents, m.cfg.Deploys)
		if err != nil {
			m.log.Warn("acp: the board offers a route that cannot be used", "board", boardID, "flow", f.Name, "err", err)
			continue
		}
		known := false
		for _, existing := range m.cfg.Flows {
			if sameFlow(existing, valid) {
				known = true
				break
			}
		}
		if known {
			continue
		}
		m.cfg.Flows = append(m.cfg.Flows, valid)
		added++
	}
	if added > 0 {
		if err := m.persistConfigLocked(); err != nil {
			m.log.Warn("acp: cannot persist the board's routes", "board", boardID, "err", err)
		}
	}
	return added
}

// BoardAutomation reads a board's automation back out of the registry in the
// shape a template carries it — the other direction of seedFromBoard, and how a
// board built by hand becomes a template somebody else can start from.
//
// The board id is dropped and the option ids are kept, which is exactly what a
// copy needs: duplicating a board keeps its card properties (options and their
// ids) and gives the copy a new board id, so a spec that names the option still
// finds it and one that named the board would point at the original.
func (m *Manager) BoardAutomation(boardID string) BoardAutomation {
	columns, flows := m.boardOwnAutomation(boardID)
	out := BoardAutomation{
		Columns: make([]ColumnSpec, 0, len(columns)),
		Flows:   make([]FlowEntry, 0, len(flows)),
	}
	for _, c := range columns {
		c.BoardID = ""
		out.Columns = append(out.Columns, c)
	}
	for _, f := range flows {
		f.BoardID = ""
		out.Flows = append(out.Flows, f)
	}
	return out
}

// persistBoardLocked writes a board's columns and routes back onto the board.
// Called from every edit that touches them, with cfgMu already held — the whole
// point is that what the registry now says and what the board says can never
// drift apart, so the write happens inside the same lock as the change.
//
// A board that cannot be written to is not a lost edit: the entries stay in the
// registry for this run, and stay in config.json (configToStore) until a write
// gets through, which is also how an install that predates this moves over.
func (m *Manager) persistBoardLocked(boardID string) {
	if boardID == "" || m.meta == nil {
		return
	}
	columns, flows := boardOwn(m.cfg, boardID)

	// Written as `null` rather than left out when a board's last route is
	// deleted: an absent property is one the board never had, and patching
	// with an absent value is how a deletion turns into "no change at all".
	props := map[string]any{
		BoardPropColumns: columns,
		BoardPropFlows:   flows,
	}

	parent := m.rootCtx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	if err := m.meta.SetBoardProperties(ctx, boardID, props); err != nil {
		m.log.Warn("acp: cannot save the board's automation on the board", "board", boardID, "err", err)
		delete(m.boardStored, boardID)
		return
	}
	if m.boardStored == nil {
		m.boardStored = make(map[string]bool)
	}
	m.boardStored[boardID] = true
}

// saveBoardsLocked writes the change through to every board it touched and
// then to the file. Two boards, when a spec that belonged to no board in
// particular becomes one board's own: the board that lost it has to be told
// as much as the board that gained it.
func (m *Manager) saveBoardsLocked(boards ...string) error {
	done := make(map[string]bool, len(boards))
	for _, boardID := range boards {
		if boardID == "" || done[boardID] {
			continue
		}
		done[boardID] = true
		m.persistBoardLocked(boardID)
	}
	return m.persistConfigLocked()
}

// boardOwn is what one board owns, out of the whole registry.
func boardOwn(cfg Config, boardID string) ([]ColumnSpec, []FlowEntry) {
	columns := make([]ColumnSpec, 0, len(cfg.Columns))
	for _, c := range cfg.Columns {
		if c.BoardID == boardID {
			columns = append(columns, c)
		}
	}
	flows := make([]FlowEntry, 0, len(cfg.Flows))
	for _, f := range cfg.Flows {
		if f.BoardID == boardID {
			flows = append(flows, f)
		}
	}
	return columns, flows
}

// moveAutomationToBoards is the one-shot move of what config.json still carries
// onto the boards it belongs to. It runs at startup, before anything can edit
// either side, and it is a no-op on the second launch: what has reached its
// board is no longer written to the file.
//
// A board that has gone away keeps its entries in the file rather than losing
// them silently — a failed write here is indistinguishable from a board store
// that is not ready yet, and a route somebody drew is not ours to drop.
func (m *Manager) moveAutomationToBoards() {
	if m.meta == nil || m.cfgPath == "" {
		return
	}
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()

	boards := make([]string, 0, 4)
	seen := make(map[string]bool)
	for _, c := range m.cfg.Columns {
		if c.BoardID != "" && !seen[c.BoardID] {
			seen[c.BoardID] = true
			boards = append(boards, c.BoardID)
		}
	}
	for _, f := range m.cfg.Flows {
		if f.BoardID != "" && !seen[f.BoardID] {
			seen[f.BoardID] = true
			boards = append(boards, f.BoardID)
		}
	}
	if len(boards) == 0 {
		return
	}
	for _, boardID := range boards {
		m.persistBoardLocked(boardID)
	}
	if err := m.persistConfigLocked(); err != nil {
		m.log.Warn("acp: cannot rewrite the config after moving the automation onto the boards", "err", err)
	}
}

// configToStore is the registry as it goes into the file: everything the
// machine owns, and none of what a board owns and has taken. Board-scoped
// entries whose board has not accepted them stay, so nothing is dropped on the
// way over.
func (m *Manager) configToStore() Config {
	cfg := m.cfg
	if len(m.boardStored) == 0 {
		return cfg
	}
	columns := make([]ColumnSpec, 0, len(cfg.Columns))
	for _, c := range cfg.Columns {
		if !m.boardStored[c.BoardID] {
			columns = append(columns, c)
		}
	}
	flows := make([]FlowEntry, 0, len(cfg.Flows))
	for _, f := range cfg.Flows {
		if !m.boardStored[f.BoardID] {
			flows = append(flows, f)
		}
	}
	cfg.Columns, cfg.Flows = columns, flows
	return cfg
}

// BoardAutomation is what a board carries: the columns it runs and the routes
// across it. Exported so a test — and "save this board as a template" —
// speaks the same shape the template does.
type BoardAutomation struct {
	Columns []ColumnSpec `json:"acpColumns,omitempty"`
	Flows   []FlowEntry  `json:"acpFlows,omitempty"`
}
