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
// The registry in memory is what the engine reads on every card move — a board
// read per move would be absurd — but it is a cache of what the boards say, and
// every edit is written through to the board it belongs to
// (persistBoardLocked).
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
// The prefix is the app's, not the agent integration's, because a route does
// not presuppose an agent: of the twelve triggers an edge can wait on, nine
// come from git, GitHub or the board itself, and a FlowActionNone stage runs
// nothing at all. A board can carry a working route with no agent in it.
const (
	BoardPropColumns = "xciiiColumns"
	BoardPropFlows   = "xciiiFlows"
	BoardPropSetup   = "xciiiSetup"
	// BoardPropPrompt is what this board's agents are told first. It is the
	// board's, for the same reason its columns are: a household board and a
	// code board want different first words, and a board carried to another
	// machine that arrived without them would run its agents unbriefed.
	BoardPropPrompt = "xciiiPrompt"
	// BoardPropGit is how this board *used* to say a repository is worked in.
	// The answer belongs to the folder (WorkdirEntry.Mode) — it is a fact about
	// the repository and not about the board — so this key is read once, moved
	// onto the folders that board offers, and taken off the board.
	BoardPropGit = "xciiiGit"
	// BoardPropBranch is the id of the text property a card's branch is
	// written into. An id and not a name, for the reason every other field of
	// ours is found by one: «Ветка» is what this app calls it when it makes
	// one, and a person may call it anything.
	//
	// Written by the page (it owns the board's card properties), read here.
	BoardPropBranch = "xciiiBranchProperty"
	// BoardPropProject is the id of the select property a card names its folder
	// in — «Папка» when this app makes it. An id for the same reason the branch
	// field is one, and load-bearing for a second: it is what lets the folder be
	// read off the card rather than *recognised* among everything the card has
	// selected (resolveWorkdir).
	BoardPropProject = "xciiiProjectProperty"
	// BoardPropColumnProperty is the id of the select property this board's
	// columns live on — the field a card's column is a value of.
	//
	// It is the last of the three "which field is which" records, and the one
	// that took longest to arrive: which property held the columns was a *name*
	// in the machine's settings, matched against every board this machine ever
	// saw (contradiction 1 of docs/model-graph.md). A board in English, or one
	// where somebody renamed «Статус», matched nothing.
	//
	// Written here rather than by the page, unlike the folder and branch
	// records: the columns already carry the property they were bound to, so
	// the board can be told what it is the first time its automation is saved.
	BoardPropColumnProperty = "xciiiColumnProperty"
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
	BoardPropProject: "acpProjectProperty",
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
	// BoardColumnOptions is the board's own columns: the property they live on
	// and every option of it. It is what binds a stage written before stages
	// recorded an option id to the option it always meant, once, so nothing has
	// to go on matching a column by its name (contradiction 5).
	BoardColumnOptions(ctx context.Context, boardID string) ([]Column, error)
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
	// Bind whatever still knows only a column's name to the option it means,
	// before anything reads it. Asked of the board rather than inferred, and
	// only where something needs binding: a board whose automation already
	// carries ids costs nothing (contradiction 5).
	m.bindToBoardOptions(boardID, columns, flows)
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
	if moved := m.moveGitPolicyToWorkdirs(boardID, props); moved > 0 {
		m.log.Info("acp: how to work in a repository moved onto the folders", "board", boardID, "folders", moved)
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

// moveGitPolicyToWorkdirs takes a board's old answer about repositories and
// writes it onto the folders that board offers, then takes the key off the
// board. One-time, and idempotent: a folder that already says how it is worked
// in is left alone, and a board whose key is gone does nothing.
//
// The answer moved because it is a fact about the repository rather than about
// the board — see WorkMode. Moving it rather than dropping it is what keeps a
// board somebody had already set to «в самой папке» working that way.
func (m *Manager) moveGitPolicyToWorkdirs(boardID string, props map[string]any) int {
	raw, ok := boardProp(props, BoardPropGit)
	if !ok {
		return 0
	}
	var p struct {
		Mode string `json:"mode"`
	}
	if err := reinterpret(raw, &p); err != nil {
		return 0
	}
	mode := strings.ToLower(strings.TrimSpace(p.Mode))
	if mode != WorkModeWorktree && mode != WorkModeBranch {
		return 0
	}

	moved := 0
	m.cfgMu.Lock()
	for i, e := range m.cfg.Workdirs {
		if !e.OfferedOn(boardID) || strings.TrimSpace(e.Modes[boardID]) != "" {
			continue
		}
		if m.cfg.Workdirs[i].Modes == nil {
			m.cfg.Workdirs[i].Modes = map[string]string{}
		}
		m.cfg.Workdirs[i].Modes[boardID] = mode
		moved++
	}
	err := m.persistConfigLocked()
	m.cfgMu.Unlock()
	if err != nil {
		m.log.Warn("acp: cannot save how the folders are worked in", "board", boardID, "err", err)
	}

	// Off the board, so it is moved once and never read again.
	ctx, cancel := context.WithTimeout(m.rootCtx, 10*time.Second)
	defer cancel()
	if err := m.meta.SetBoardProperties(ctx, boardID, nil, []string{BoardPropGit}); err != nil {
		m.log.Warn("acp: cannot take the old repository setting off the board", "board", boardID, "err", err)
	}
	return moved
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
		// A board carries what it was written with, and until now that included
		// names of registry entries. Fold them into ids before validating, or a
		// column pinned to a deploy target by name would be refused for naming
		// nothing the registry answers to (bindrefs.go). Not counted as an
		// addition: nothing new was registered, and seedFromBoard writes the
		// board back either way.
		bindColumnRefs(&c, m.cfg.Agents, m.cfg.Deploys)
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
			// The registry's own copy is bound too. Leaving it out is what
			// would make the fold look done and not be: the board would be
			// rewritten from a registry entry still carrying the name.
			if bindColumnRefs(&m.cfg.Columns[i], m.cfg.Agents, m.cfg.Deploys) {
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
		bindFlowRefs(&f, m.cfg.Agents, m.cfg.Deploys)
		bindFlowWorkspace(&f, m.cfg.Workdirs)
		valid, err := validateFlow(f, m.cfg.Workdirs, m.cfg.Agents, m.cfg.Deploys)
		if err != nil {
			m.log.Warn("acp: the board offers a route that cannot be used", "board", boardID, "flow", f.Name, "err", err)
			unusable = append(unusable, f)
			continue
		}
		known := false
		for i, existing := range m.cfg.Flows {
			// By name as well as by id: a board that predates route ids carries
			// none, so validateFlow has just minted a fresh one and an id
			// comparison would import the same route again on every read.
			if sameFlow(existing, valid) || flowNameTaken(existing, valid) {
				known = true
				if bindFlowRefs(&m.cfg.Flows[i], m.cfg.Agents, m.cfg.Deploys) {
					added++
				}
				bindFlowWorkspace(&m.cfg.Flows[i], m.cfg.Workdirs)
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
		if err == nil && ok && known.NodeID == st.NodeID && known.FlowID == st.FlowID {
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
// registry for this run, and the next edit tries again. They are not in
// config.json any more, so the run is as long as they last — which is the
// trade the move onto the board bought (docs/model-graph.md, contradiction 9).
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
	// Which field the columns are on, taken from the columns themselves. Only
	// written when they say — a board whose columns predate option ids has
	// nothing to record, and an absent value must not overwrite a good one.
	if propertyID := columnPropertyOf(columns); propertyID != "" {
		props[BoardPropColumnProperty] = propertyID
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
	}
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

// BoardAutomation is what a board carries: the columns it runs and the routes
// across it. Exported so a test — and "save this board as a template" —
// speaks the same shape the template does.
type BoardAutomation struct {
	Columns []ColumnSpec `json:"acpColumns,omitempty"`
	Flows   []FlowEntry  `json:"acpFlows,omitempty"`
}

// columnPropertyOf is the property this board's columns are values of, read off
// the columns themselves. Empty when they disagree or when none of them says,
// because a board with columns on two different fields is a board this record
// cannot describe — and a wrong answer here is worse than none.
func columnPropertyOf(columns []ColumnSpec) string {
	found := ""
	for _, c := range columns {
		if c.PropertyID == "" {
			continue
		}
		if found != "" && found != c.PropertyID {
			return ""
		}
		found = c.PropertyID
	}
	return found
}

// bindToBoardOptions resolves the columns and stages that carry a name and no
// option id. What it cannot resolve is left alone: a stage naming a column the
// board has not got is a stage nothing will ever stand on, and saying so is the
// editor's business rather than a silent rewrite here.
func (m *Manager) bindToBoardOptions(boardID string, columns []ColumnSpec, flows []FlowEntry) {
	needs := false
	for _, c := range columns {
		needs = needs || c.OptionID == ""
	}
	for _, f := range flows {
		for _, n := range f.Nodes {
			needs = needs || n.OptionID == ""
		}
	}
	if !needs || m.meta == nil {
		return
	}

	parent := m.rootCtx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	options, err := m.meta.BoardColumnOptions(ctx, boardID)
	cancel()
	if err != nil {
		m.log.Warn("acp: cannot read the board's columns", "board", boardID, "err", err)
		return
	}
	for i := range columns {
		bindColumnOption(&columns[i], boardID, options)
	}
	for i := range flows {
		bindStageOptions(&flows[i], options)
	}
}
