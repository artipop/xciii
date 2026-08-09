package sources

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/artipop/xciii/internal/secrets"
)

// Manager owns the registry and runs the pipeline. It is the only thing outside
// this package needs: an entry point delivers items, the manager decides and
// writes.
type Manager struct {
	mu      sync.RWMutex
	cfg     Config
	cfgPath string

	store  *Store
	writer BoardWriter
	log    *slog.Logger

	// The running half: one goroutine per source that names a plugin, under a
	// context the app cancels, and what each of them is currently doing.
	rootCtx context.Context
	stop    context.CancelFunc
	wg      sync.WaitGroup
	dial    dialer
	status  map[string]*Status
	// secrets is where the credentials a plugin has to present are kept. Not
	// where an inbound ingest token lives: that one is only ever checked, so it
	// is a hash on the entry itself.
	secrets secrets.Store
}

// NewManager builds a manager over a loaded registry. writer may be nil, which
// disables writing and is what a build with no board does.
func NewManager(cfg Config, cfgPath string, store *Store, writer BoardWriter, log *slog.Logger) *Manager {
	if log == nil {
		log = slog.Default()
	}
	return &Manager{cfg: cfg, cfgPath: cfgPath, store: store, writer: writer, log: log}
}

// boardWriteTimeout bounds one card write, so a stuck board cannot hold an
// incoming request open.
const boardWriteTimeout = 10 * time.Second

// Sources returns a snapshot of the registry.
func (m *Manager) Sources() []SourceEntry {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return append([]SourceEntry(nil), m.cfg.Sources...)
}

// SourcesForBoard is the registry as one board sees it: its own sources and the
// ones marked global.
func (m *Manager) SourcesForBoard(boardID string) []SourceEntry {
	out := make([]SourceEntry, 0, 4)
	for _, s := range m.Sources() {
		if s.OfferedOn(boardID) {
			out = append(out, s)
		}
	}
	return out
}

// Source returns one entry by name.
func (m *Manager) Source(name string) (SourceEntry, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return findSource(m.cfg.Sources, name)
}

func findSource(list []SourceEntry, name string) (SourceEntry, bool) {
	for _, s := range list {
		if strings.EqualFold(s.Name, name) {
			return s, true
		}
	}
	return SourceEntry{}, false
}

// AddSource registers a new source.
func (m *Manager) AddSource(entry SourceEntry) (SourceEntry, error) {
	valid, err := entry.Validate()
	if err != nil {
		return SourceEntry{}, err
	}
	if err := m.insertEntry(valid); err != nil {
		return SourceEntry{}, err
	}
	// Outside the lock on purpose: this one writes to the board, and holding
	// the registry while waiting on board I/O would stall every reader of it.
	m.ensureInbox(valid)
	return valid, nil
}

func (m *Manager) insertEntry(valid SourceEntry) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := findSource(m.cfg.Sources, valid.Name); exists {
		return fmt.Errorf("источник %q уже есть", valid.Name)
	}
	m.cfg.Sources = append(m.cfg.Sources, valid)
	return m.persistLocked()
}

// ensureInbox puts the source's inbox column on its board as soon as the source
// exists, so somebody who has just registered one can see where its cards will
// land instead of finding out when the first item arrives.
//
// It is best-effort: a board that refuses the column is a board that takes its
// cards without one, and refusing to register the source over it would be a
// worse answer than a line in the log. The pipeline ensures the column again
// before it writes, which is what actually has to succeed.
func (m *Manager) ensureInbox(entry SourceEntry) {
	if m.writer == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), boardWriteTimeout)
	defer cancel()
	property := entry.PinnedProperty()
	if property == "" {
		found, err := m.writer.ColumnProperty(ctx, entry.BoardID)
		if err != nil {
			m.log.Warn("sources: не удалось узнать свойство колонок",
				"source", entry.Name, "board", entry.BoardID, "err", err)
			return
		}
		property = found
	}
	if _, err := m.writer.EnsureInbox(ctx, entry.BoardID, property, entry.InboxOr()); err != nil {
		m.log.Warn("sources: не удалось завести «Входящие»",
			"source", entry.Name, "board", entry.BoardID, "err", err)
	}
}

// UpdateSource replaces an existing source, matched by name.
func (m *Manager) UpdateSource(entry SourceEntry) (SourceEntry, error) {
	valid, err := entry.Validate()
	if err != nil {
		return SourceEntry{}, err
	}
	if err := m.replaceEntry(valid); err != nil {
		return SourceEntry{}, err
	}
	m.ensureInbox(valid)
	return valid, nil
}

func (m *Manager) replaceEntry(valid SourceEntry) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, s := range m.cfg.Sources {
		if strings.EqualFold(s.Name, valid.Name) {
			m.cfg.Sources[i] = valid
			return m.persistLocked()
		}
	}
	return fmt.Errorf("источник %q не найден", valid.Name)
}

// RemoveSource deletes a source and everything it remembered.
func (m *Manager) RemoveSource(name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, s := range m.cfg.Sources {
		if strings.EqualFold(s.Name, name) {
			m.cfg.Sources = append(m.cfg.Sources[:i], m.cfg.Sources[i+1:]...)
			if err := m.persistLocked(); err != nil {
				return err
			}
			if m.store != nil {
				return m.store.ForgetSource(s.Name)
			}
			return nil
		}
	}
	return fmt.Errorf("источник %q не найден", name)
}

// persistLocked writes the registry. Like the ACP one, it does nothing without
// a path, which is what tests run with.
func (m *Manager) persistLocked() error {
	if m.cfgPath == "" {
		return nil
	}
	return SaveConfig(m.cfgPath, m.cfg)
}

// Events returns a source's log, newest first.
func (m *Manager) Events(source string, limit int) ([]EventRecord, error) {
	if m.store == nil {
		return nil, nil
	}
	return m.store.Events(source, limit)
}

// Result is what one delivery came to, in the terms the caller reports back to
// whoever sent the items.
type Result struct {
	Created   int `json:"created"`
	Commented int `json:"commented"`
	Dropped   int `json:"dropped"`
	Skipped   int `json:"skipped"` // already known, unchanged
	Failed    int `json:"failed"`
}

// Deliver runs items through the pipeline of one source: deduplicate, decide,
// write. It is the single entry point — a pushed item and a polled one take the
// same path, which is what keeps them from growing two sets of bugs.
func (m *Manager) Deliver(ctx context.Context, sourceName string, items []Item) (Result, error) {
	entry, ok := m.Source(sourceName)
	if !ok {
		return Result{}, fmt.Errorf("источник %q не найден", sourceName)
	}
	if !entry.Enabled {
		return Result{}, fmt.Errorf("источник %q выключен", entry.Name)
	}
	if m.writer == nil {
		return Result{}, fmt.Errorf("доска недоступна")
	}

	var res Result
	for _, it := range items {
		if err := m.deliverOne(ctx, entry, it, &res); err != nil {
			res.Failed++
			m.log.Warn("sources: не удалось обработать элемент",
				"source", entry.Name, "item", it.ExternalID, "err", err)
			m.record(EventRecord{Source: entry.Name, ExternalID: it.ExternalID,
				Outcome: OutcomeFailed, Detail: err.Error()})
		}
	}
	return res, nil
}

func (m *Manager) deliverOne(ctx context.Context, entry SourceEntry, it Item, res *Result) error {
	state, cardID, err := m.stateOf(entry.Name, it)
	if err != nil {
		return err
	}
	switch {
	case state == ItemSeen:
		// The item is exactly what was recorded. Nothing is logged: a source
		// reports its whole state on every poll, and logging that would bury
		// the lines that matter.
		res.Skipped++
		return nil
	case state == ItemChanged && cardID != "":
		return m.updateCard(ctx, entry, it, cardID, res)
	}
	return m.createCard(ctx, entry, it, res)
}

// updateCard is what a changed item does to the card it already has: a comment,
// and never a rewrite of the description, which a person may have edited.
func (m *Manager) updateCard(ctx context.Context, entry SourceEntry, it Item, cardID string, res *Result) error {
	if entry.Update == UpdateIgnore {
		res.Skipped++
		return m.remember(entry.Name, it, cardID)
	}
	wctx, cancel := context.WithTimeout(ctx, boardWriteTimeout)
	defer cancel()
	if err := m.writer.AddComment(wctx, cardID, updateComment(it)); err != nil {
		return fmt.Errorf("комментарий на карточку %s: %w", cardID, err)
	}
	res.Commented++
	m.record(EventRecord{Source: entry.Name, ExternalID: it.ExternalID,
		Outcome: OutcomeCommented, CardID: cardID})
	return m.remember(entry.Name, it, cardID)
}

func (m *Manager) createCard(ctx context.Context, entry SourceEntry, it Item, res *Result) error {
	rule, matched := FirstMatch(entry.Rules, it)
	switch {
	case matched && rule.Then == ActionDrop:
		res.Dropped++
		m.record(EventRecord{Source: entry.Name, ExternalID: it.ExternalID,
			Rule: rule.Name, Outcome: OutcomeDropped})
		// Remembered, so a source that keeps reporting it does not keep
		// deciding it.
		return m.remember(entry.Name, it, "")
	case matched && rule.Then == ActionComment:
		// There is no card to comment on: the item is new. Treated as a drop,
		// and said so, rather than silently doing nothing.
		res.Dropped++
		m.record(EventRecord{Source: entry.Name, ExternalID: it.ExternalID, Rule: rule.Name,
			Outcome: OutcomeDropped, Detail: "правило комментирует, но карточки ещё нет"})
		return m.remember(entry.Name, it, "")
	case !matched && entry.Noisy:
		// A stream of notifications is mostly noise: there a rule is a
		// subscription, and everything else is deliberately dropped.
		res.Dropped++
		m.record(EventRecord{Source: entry.Name, ExternalID: it.ExternalID, Outcome: OutcomeDropped})
		return m.remember(entry.Name, it, "")
	}

	spec := CardFor(rule, it)
	column := strings.TrimSpace(rule.Column)
	outcome := OutcomeCreated
	if !matched {
		// Nothing claimed it, and this source is not noisy: it goes to the
		// inbox rather than being lost. A lost item is what makes an
		// integration impossible to debug.
		spec = CardFor(Rule{}, it)
		outcome = OutcomeInbox
	}
	if column == "" {
		// A rule that names no column means the inbox as well. Leaving the
		// column property unset would put the card outside every column of the
		// board — visible only to somebody who thought to look there — and that
		// is the same loss the inbox exists to prevent. What the rule decides is
		// whether the item was claimed, not whether it is shown.
		column = entry.InboxOr()
	}
	spec.Source = entry.Name
	if entry.Name != "" {
		if spec.Properties == nil {
			spec.Properties = map[string]string{}
		}
		// The way back to the original, for a person looking at the card. Where
		// it came from is not among these: the card is authored by the source,
		// which is the board's own answer and the one the inbox groups by — a
		// property saying it again would be a second answer to one question.
		// The pipeline never reads these back — the truth is in source_item —
		// so a person may change them freely.
		if u := strings.TrimSpace(it.URL); u != "" {
			setIfAbsent(spec.Properties, "Ссылка", u)
		}
	}
	if rule.Agent != "" {
		setIfAbsent(spec.Properties, "Agent", rule.Agent)
	}

	wctx, cancel := context.WithTimeout(ctx, boardWriteTimeout)
	defer cancel()
	cardID, err := m.writer.CreateCard(wctx, entry.BoardID, spec)
	if err != nil {
		return fmt.Errorf("создание карточки: %w", err)
	}
	// Remembered before the move: the card exists, and losing track of it here
	// would create a second one on the next delivery.
	if err := m.remember(entry.Name, it, cardID); err != nil {
		return err
	}
	res.Created++
	m.record(EventRecord{Source: entry.Name, ExternalID: it.ExternalID,
		Rule: rule.Name, Outcome: outcome, CardID: cardID})

	property, err := m.columnProperty(wctx, entry)
	if err != nil {
		return err
	}
	// The inbox is made if the board has not got it. A board made before the
	// inbox shipped has neither the column nor the view, and templates only
	// ever reach boards that do not exist yet — so without this the very item
	// the inbox exists for would be the one that fails to land.
	if _, err := m.writer.EnsureInbox(wctx, entry.BoardID, property, column); err != nil {
		return fmt.Errorf("колонка %q на доске %s: %w", column, entry.BoardID, err)
	}
	// The move, not the creation, is what the automation sees: the trigger
	// fires on a change of the column property, and a card created straight
	// into a working column starts nothing.
	if err := m.writer.MoveCardByOptionName(wctx, cardID, property, column); err != nil {
		return fmt.Errorf("перенос карточки %s в колонку %q: %w", cardID, column, err)
	}
	return nil
}

// columnProperty is the property this source's columns live in: what the entry
// pins, or what the board itself says. Asking the board is the default because
// no constant can be right for both a board that calls it «Статус» and one that
// calls it "Status".
func (m *Manager) columnProperty(ctx context.Context, entry SourceEntry) (string, error) {
	if pinned := entry.PinnedProperty(); pinned != "" {
		return pinned, nil
	}
	property, err := m.writer.ColumnProperty(ctx, entry.BoardID)
	if err != nil {
		return "", fmt.Errorf("свойство колонок доски %s: %w", entry.BoardID, err)
	}
	return property, nil
}

func setIfAbsent(props map[string]string, name, value string) {
	for k := range props {
		if strings.EqualFold(k, name) {
			return
		}
	}
	props[name] = value
}

func (m *Manager) stateOf(source string, it Item) (ItemState, string, error) {
	if m.store == nil {
		return ItemNew, "", nil
	}
	return m.store.StateOf(source, it.ExternalID, it.Version)
}

func (m *Manager) remember(source string, it Item, cardID string) error {
	if m.store == nil {
		return nil
	}
	return m.store.RememberItem(source, it.ExternalID, it.Version, cardID)
}

func (m *Manager) record(r EventRecord) {
	if m.store == nil {
		return
	}
	if err := m.store.AppendEvent(r); err != nil {
		m.log.Warn("sources: не удалось записать событие", "source", r.Source, "err", err)
	}
}
