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

// Board properties the template writes its automation into. BoardPropSetup is
// not automation but the questions the board needs answered before any of it
// can run — see setup.go; it is read there rather than adopted here, because it
// is about this machine and nothing about it belongs in the registry.
//
// The prefix is the app's, not the agent integration's. These keys used to
// start with `acp`, and that was wrong about what they are.
//
// A route does not presuppose an agent. Of the twelve triggers an edge can
// wait on (FlowTriggers), three come from a session outcome and nine come from
// git, GitHub or the board itself; a stage whose action is FlowActionNone runs
// nothing at all and only waits. So a board can carry a working route made of
// deterministic transitions — merged the branch, changed a property — with no
// agent anywhere in it. An agent is one of the things a stage may do, not the
// premise of the whole mechanism.
//
// Columns are the same case, and `xciiiTemplate`
// (internal/boardadapter/templates.go) had the right prefix from the start.
const (
	BoardPropColumns = "xciiiColumns"
	BoardPropFlows   = "xciiiFlows"
	BoardPropSetup   = "xciiiSetup"
	// BoardPropPrompt is what this board's agents are told first. It is the
	// board's, for the same reason its columns are: a household board and a
	// code board want different first words, and a board carried to another
	// machine that arrived without them would run its agents unbriefed.
	BoardPropPrompt = "xciiiPrompt"
)

// The names these keys had before, still read because every board made until
// now carries them. They are never written: reading a board carries what it
// says over to the current names and drops the old ones in the same patch, so
// a board migrates the first time anything touches it and nothing has to walk
// the database looking for boards to fix.
//
// BoardPropPrompt is the odd one and is listed for honesty rather than for
// history: the prompt was in config.json until this key existed, so no released
// build ever wrote `acpPrompt`. `acp` was also the one defensible prefix here —
// this really is what an agent is told — and it was renamed anyway so that a
// board does not carry four keys under one prefix and a fifth under another.
var legacyBoardProps = map[string]string{
	BoardPropColumns: "acpColumns",
	BoardPropFlows:   "acpFlows",
	BoardPropSetup:   "acpSetup",
	BoardPropPrompt:  "acpPrompt",
}

// boardProp reads one of this app's own keys off a board, under whichever name
// that board happens to carry it.
func boardProp(props map[string]any, key string) (any, bool) {
	if v, ok := props[key]; ok && v != nil {
		return v, true
	}
	if legacy, ok := legacyBoardProps[key]; ok {
		if v, ok := props[legacy]; ok && v != nil {
			return v, true
		}
	}
	return nil, false
}

// legacyNamesOf is the old spelling of the keys named, and only of those.
//
// A write may delete the old name of a key it is writing, and of no other: this
// side reads BoardPropSetup and never writes it, so deleting `acpSetup` beside
// a write of the columns took the questions a template declared off the board
// with nothing to put them back. Migrating that one is migrateLegacyProps.
func legacyNamesOf(keys ...string) []string {
	out := make([]string, 0, len(keys))
	for _, key := range keys {
		if legacy, ok := legacyBoardProps[key]; ok {
			out = append(out, legacy)
		}
	}
	return out
}

// BoardMeta is the board's own properties — where a board keeps the automation
// it runs and a template the automation it ships — and whether the board is
// itself a template. Optional: without it a board brings nothing and keeps
// nothing, and the registry falls back to the file it used to live in.
type BoardMeta interface {
	BoardProperties(ctx context.Context, boardID string) (map[string]any, error)
	// SetBoardProperties writes the named properties onto the board and removes
	// the named ones, leaving everything else alone. This is how a board's
	// automation is saved: the board is where it belongs, so the board is what
	// is patched. remove is how a key that has been renamed stops existing —
	// writing the new name without it would leave two answers on the board.
	SetBoardProperties(ctx context.Context, boardID string, props map[string]any, remove []string) error
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

// listenBeforeSpeaking makes sure a board has been read before this machine
// writes anything back to it. Every edit is written through in full
// (persistBoardLocked), so an edit made before the board was ever read would
// write the registry's idea of that board — nothing, for a board this machine
// has not looked at — over the board's own columns and routes.
//
// That is not hypothetical: setting a board's instructions is the one edit
// somebody can make without the automation editor having opened first, and it
// emptied a freshly made board's automation.
//
// Called from the edit entry points rather than from persistBoardLocked, which
// runs with cfgMu held, and seeding takes it.
func (m *Manager) listenBeforeSpeaking(boards ...string) {
	for _, boardID := range boards {
		if boardID != "" {
			m.seedFromBoard(boardID)
		}
	}
}

// seedFromBoard imports whatever automation a board carries. It runs once per
// board per run: the import is idempotent anyway (anything already registered
// is left alone), and the point of the flag is to not read the board on every
// card move.
//
// The exception is a board still holding entries this machine could not use.
// Registering the missing agent is what the setup wizard is for, and it seeds
// the board again on the way out — so the answer takes effect there rather
// than at the next launch.
func (m *Manager) seedFromBoard(boardID string) {
	if boardID == "" || m.meta == nil {
		return
	}
	m.seededMu.Lock()
	if m.seeded == nil {
		m.seeded = make(map[string]bool)
	}
	if m.seeded[boardID] && !m.hasUnadopted(boardID) {
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
	added, unusableColumns := m.adoptColumns(boardID, columns)
	if added > 0 {
		m.log.Info("acp: columns taken from the board itself", "board", boardID, "count", added)
	}
	added, unusableFlows := m.adoptFlows(boardID, flows)
	if added > 0 {
		m.log.Info("acp: routes taken from the board itself", "board", boardID, "count", added)
	}
	m.migrateLegacyProps(boardID, props)
	m.rememberUnadopted(boardID, unusableColumns, unusableFlows)
	if m.adoptPrompt(boardID, boardPromptFrom(props)) {
		m.log.Info("acp: the board's own instructions taken from the board itself", "board", boardID)
	}
	m.indexBoardCardFlows(boardID)

	// The board is the store, so what the registry ended up with for this board
	// goes straight back onto it — which also settles the difference between
	// what the board shipped and what the machine's own file still remembered
	// for it, in the board's favour from here on. Together with the unadopted
	// entries put back above, the write is the board's own content plus this
	// machine's edits, and never less than what was read.
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
	if raw, ok := boardProp(props, BoardPropColumns); ok {
		if err := reinterpret(raw, &columns); err != nil {
			return nil, nil, fmt.Errorf("%s: %w", BoardPropColumns, err)
		}
	}
	var flows []FlowEntry
	if raw, ok := boardProp(props, BoardPropFlows); ok {
		if err := reinterpret(raw, &flows); err != nil {
			return nil, nil, fmt.Errorf("%s: %w", BoardPropFlows, err)
		}
	}
	return columns, flows, nil
}

// boardPromptFrom reads the board's own instructions. Unreadable is treated as
// absent rather than as an error: the prompt is a string beside two lists, and
// a board whose prompt is malformed still has columns worth taking.
func boardPromptFrom(props map[string]any) string {
	raw, ok := boardProp(props, BoardPropPrompt)
	if !ok {
		return ""
	}
	text, _ := raw.(string)
	return strings.TrimSpace(text)
}

// adoptPrompt takes the board's own instructions, unless this machine already
// has an answer for that board — the same rule as a column: what somebody
// edited here is theirs until they say otherwise.
func (m *Manager) adoptPrompt(boardID, text string) bool {
	if text == "" {
		return false
	}
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	if strings.TrimSpace(m.cfg.BoardPrompts[boardID]) != "" {
		return false
	}
	if m.cfg.BoardPrompts == nil {
		m.cfg.BoardPrompts = map[string]string{}
	}
	m.cfg.BoardPrompts[boardID] = text
	if err := m.persistConfigLocked(); err != nil {
		m.log.Warn("acp: cannot persist the board's instructions", "board", boardID, "err", err)
	}
	return true
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
// has an answer for — an edited column is the user's, not the template's. What
// it could not validate comes back as the second result rather than being
// dropped: this machine not knowing the agent a column names is a fact about
// the machine, and the board goes on carrying the column.
func (m *Manager) adoptColumns(boardID string, columns []ColumnSpec) (int, []ColumnSpec) {
	if len(columns) == 0 {
		return 0, nil
	}
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()

	added := 0
	var unusable []ColumnSpec
	for _, c := range columns {
		c.BoardID = boardID
		valid, err := validateColumn(c, m.cfg.Agents, m.cfg.Deploys)
		if err != nil {
			m.log.Warn("acp: the board offers a column that cannot be used", "board", boardID, "column", c.Column, "err", err)
			unusable = append(unusable, c)
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
	return added, unusable
}

// adoptFlows registers the board's routes under its own id, skipping names the
// board already has. Like adoptColumns it hands back what it could not use
// rather than dropping it.
func (m *Manager) adoptFlows(boardID string, flows []FlowEntry) (int, []FlowEntry) {
	if len(flows) == 0 {
		return 0, nil
	}
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()

	added := 0
	var unusable []FlowEntry
	for _, f := range flows {
		f.BoardID = boardID
		valid, err := validateFlow(f, m.cfg.Projects, m.cfg.Agents, m.cfg.Deploys)
		if err != nil {
			m.log.Warn("acp: the board offers a route that cannot be used", "board", boardID, "flow", f.Name, "err", err)
			unusable = append(unusable, f)
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
	return added, unusable
}

// unadopted is a board's own automation that this machine could not take into
// the registry. It is not an error state: an imported board names agents and
// deploy targets that were registered on the machine it came from, and the
// person is about to register them here.
type unadopted struct {
	Columns []ColumnSpec
	Flows   []FlowEntry
}

// rememberUnadopted records what a board carries and this machine could not
// use, so that every later write-back can put it back untouched. Without this,
// reading a board would delete from it: persistBoardLocked writes the registry,
// and what never reached the registry would simply cease to exist — which is
// what happened to every column of a freshly imported board the first time it
// was opened.
func (m *Manager) rememberUnadopted(boardID string, columns []ColumnSpec, flows []FlowEntry) {
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	if len(columns) == 0 && len(flows) == 0 {
		delete(m.boardUnadopted, boardID)
		return
	}
	if m.boardUnadopted == nil {
		m.boardUnadopted = make(map[string]unadopted)
	}
	m.boardUnadopted[boardID] = unadopted{Columns: columns, Flows: flows}
}

// indexBoardCardFlows refills this machine's flow_state table from the cards of
// one board. The table is an index, not a store: the VCS watcher reads it whole
// on every poll to learn which branches to watch, and a board this machine has
// never seen — imported, or moved along by somebody else — would otherwise have
// its parked cards waiting on a branch nobody is watching.
//
// Read-only towards the board, and add-only towards the table: a card the board
// says nothing about keeps whatever this machine remembered, because the answer
// "the board has no opinion" and the answer "the board says the card is off its
// route" arrive here identically, and only the latter is a reason to forget.
func (m *Manager) indexBoardCardFlows(boardID string) {
	if m.cards == nil || m.store == nil {
		return
	}
	parent := m.rootCtx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	states, err := m.cards.BoardCardFlows(ctx, boardID)
	cancel()
	if err != nil {
		m.log.Warn("acp: cannot read where the board's cards stand on their routes", "board", boardID, "err", err)
		return
	}
	indexed := 0
	for _, st := range states {
		known, ok, err := m.store.FlowStateForCard(st.CardID)
		if err == nil && ok && known.NodeID == st.NodeID && known.Flow == st.Flow {
			continue
		}
		if err := m.store.SaveFlowState(st); err != nil {
			m.log.Warn("acp: cannot index where a card stands", "card", st.CardID, "err", err)
			continue
		}
		indexed++
	}
	if indexed > 0 {
		m.log.Info("acp: cards on a route taken from the board itself", "board", boardID, "count", indexed)
	}
}

// migrateLegacyProps moves the keys nothing else writes to their current names.
//
// Everything the registry owns is rewritten in full on every edit, so it
// migrates itself. BoardPropSetup does not: it is the board's own declaration
// of what to ask, read here and written only by the template editor. Left
// alone it would sit under its old name for ever on a board nobody edits in
// that editor — and deleted with the rest it would be gone.
func (m *Manager) migrateLegacyProps(boardID string, props map[string]any) {
	if m.meta == nil {
		return
	}
	move := map[string]any{}
	var remove []string
	for _, key := range []string{BoardPropSetup} {
		legacy, ok := legacyBoardProps[key]
		if !ok {
			continue
		}
		if _, current := props[key]; current {
			continue
		}
		value, ok := props[legacy]
		if !ok || value == nil {
			continue
		}
		move[key] = value
		remove = append(remove, legacy)
	}
	if len(move) == 0 {
		return
	}
	parent := m.rootCtx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	if err := m.meta.SetBoardProperties(ctx, boardID, move, remove); err != nil {
		m.log.Warn("acp: cannot rename the board's own keys", "board", boardID, "err", err)
	}
}

// hasUnadopted reports whether the board still carries something this machine
// could not take. Takes cfgMu itself: it is asked under seededMu, which is the
// other way round from everywhere else, and the two guard nothing in common.
func (m *Manager) hasUnadopted(boardID string) bool {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	_, ok := m.boardUnadopted[boardID]
	return ok
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

	// What this machine could not take into the registry goes back exactly as
	// it came. A write-back is the registry's answer for the board, and the
	// registry has no answer for a column naming an agent registered somewhere
	// else — so leaving it out would not be a deletion the user asked for, it
	// would be one machine erasing what another machine set up.
	if kept, ok := m.boardUnadopted[boardID]; ok {
		columns = append(columns, kept.Columns...)
		flows = append(flows, kept.Flows...)
	}

	// Written as `null` rather than left out when a board's last route is
	// deleted: an absent property is one the board never had, and patching
	// with an absent value is how a deletion turns into "no change at all".
	props := map[string]any{
		BoardPropColumns: columns,
		BoardPropFlows:   flows,
		BoardPropPrompt:  m.cfg.BoardPrompts[boardID],
	}

	parent := m.rootCtx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	remove := legacyNamesOf(BoardPropColumns, BoardPropFlows, BoardPropPrompt)
	if err := m.meta.SetBoardProperties(ctx, boardID, props, remove); err != nil {
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
	for boardID := range m.cfg.BoardPrompts {
		if boardID != "" && !seen[boardID] {
			seen[boardID] = true
			boards = append(boards, boardID)
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

	// The map is rebuilt rather than edited: cfg is a shallow copy of m.cfg, so
	// deleting from it would delete from what the engine reads.
	if len(cfg.BoardPrompts) > 0 {
		prompts := make(map[string]string, len(cfg.BoardPrompts))
		for boardID, text := range cfg.BoardPrompts {
			if !m.boardStored[boardID] {
				prompts[boardID] = text
			}
		}
		cfg.BoardPrompts = prompts
	}
	return cfg
}

// BoardAutomation is what a board carries: the columns it runs and the routes
// across it. Exported so a test — and "save this board as a template" —
// speaks the same shape the template does.
type BoardAutomation struct {
	Columns []ColumnSpec `json:"acpColumns,omitempty"`
	Flows   []FlowEntry  `json:"acpFlows,omitempty"`
}
