// Package boardadapter bridges the board server to the agnostic
// internal/acp package. It is the only package allowed to import both sides:
// replacing the board backend later means replacing only this package.
package boardadapter

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/artipop/xciii/server/app"
	"github.com/artipop/xciii/server/mlog"
	"github.com/artipop/xciii/server/model"
	"github.com/artipop/xciii/server/services/notify"

	"github.com/artipop/xciii/internal/acp"
)

// EventsBackend is a notify.Backend that normalizes card select-property
// changes into acp.CardMoved events.
type EventsBackend struct {
	log mlog.LoggerIFace
	ch  chan acp.CardMoved

	mu  sync.Mutex
	app *app.App // set after server construction; used to fetch card bodies
}

var (
	_ notify.Backend  = (*EventsBackend)(nil)
	_ acp.BoardEvents = (*EventsBackend)(nil)
	_ acp.BoardReader = (*EventsBackend)(nil)
)

// NewEventsBackend creates the backend. Pass it into server.Params.NotifyBackends.
func NewEventsBackend(log mlog.LoggerIFace) *EventsBackend {
	return &EventsBackend{log: log, ch: make(chan acp.CardMoved, 256)}
}

// SetApp late-binds the app layer (available only after server.New returns).
func (b *EventsBackend) SetApp(a *app.App) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.app = a
}

func (b *EventsBackend) Name() string    { return "acpTrigger" }
func (b *EventsBackend) Start() error    { return nil }
func (b *EventsBackend) ShutDown() error { return nil }

// Subscribe returns the normalized event stream.
func (b *EventsBackend) Subscribe(ctx context.Context) (<-chan acp.CardMoved, error) {
	return b.ch, nil
}

// BlockChanged runs on the notify worker goroutine; it must stay fast and
// never block (buffered channel, drop on overflow).
func (b *EventsBackend) BlockChanged(evt notify.BlockChangeEvent) error {
	if evt.Action != notify.Update || evt.Board == nil ||
		evt.BlockChanged == nil || evt.BlockChanged.Type != model.TypeCard || evt.BlockOld == nil {
		return nil
	}

	schema, err := model.ParsePropertySchema(evt.Board)
	if err != nil {
		return fmt.Errorf("parse board schema: %w", err)
	}
	oldProps := rawProperties(evt.BlockOld)
	newProps := rawProperties(evt.BlockChanged)
	resolver := newUserResolver(b.appUserLookup())
	movedNames, movedIDs := personNames(newProps, schema, resolver)

	for propID, def := range schema {
		if def.Type != "select" {
			continue
		}
		oldVal := stringValue(oldProps[propID])
		newVal := stringValue(newProps[propID])
		if oldVal == newVal {
			continue
		}
		ev := acp.CardMoved{
			EventID:     uuid.NewString(),
			CardID:      evt.BlockChanged.ID,
			BoardID:     evt.Board.ID,
			Title:       evt.BlockChanged.Title,
			Body:        b.cardBody(evt.Board.ID, evt.BlockChanged),
			Props:       namedProperties(evt.BlockChanged, schema, resolver),
			Values:      valuesByID(evt.BlockChanged, schema, resolver),
			OptionNames: selectedOptionNames(newProps, schema),
			// With the ids kept, so a reader can ask the card for one field by
			// the id the board recorded rather than recognise it among the
			// names — which is how the folder is read (acp.resolveWorkdir). A
			// card that moved carried only the names, so the same card said
			// different things depending on how it was read.
			SelectedOptions: selectedOptions(newProps, schema),
			PersonNames:     movedNames,
			PersonIDs:       movedIDs,
			FromColumn:      column(def, oldVal),
			ToColumn:        column(def, newVal),
			At:              time.Now(),
		}
		select {
		case b.ch <- ev:
		default:
			b.log.Warn("acpTrigger: event channel full, dropping card move", mlog.String("card", ev.CardID))
		}
	}
	return nil
}

// CardByID reads a card on demand so a console can be opened on it without
// moving it into the trigger column. The returned event carries no columns —
// nothing moved — but everything project/agent resolution needs.
func (b *EventsBackend) CardByID(ctx context.Context, cardID string) (acp.CardMoved, error) {
	b.mu.Lock()
	a := b.app
	b.mu.Unlock()
	if a == nil {
		return acp.CardMoved{}, fmt.Errorf("board app is not ready")
	}
	block, err := a.GetBlockByID(cardID)
	if err != nil {
		return acp.CardMoved{}, fmt.Errorf("get card %s: %w", cardID, err)
	}
	if block == nil || block.Type != model.TypeCard {
		return acp.CardMoved{}, fmt.Errorf("block %s is not a card", cardID)
	}
	board, err := a.GetBoard(block.BoardID)
	if err != nil {
		return acp.CardMoved{}, fmt.Errorf("get board %s: %w", block.BoardID, err)
	}
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		return acp.CardMoved{}, fmt.Errorf("parse board schema: %w", err)
	}
	resolver := newUserResolver(b.appUserLookup())
	readNames, readIDs := personNames(rawProperties(block), schema, resolver)
	return acp.CardMoved{
		EventID:         uuid.NewString(),
		CardID:          block.ID,
		BoardID:         board.ID,
		Title:           block.Title,
		Body:            b.cardBody(board.ID, block),
		Props:           namedProperties(block, schema, resolver),
		Values:          valuesByID(block, schema, resolver),
		OptionNames:     selectedOptionNames(rawProperties(block), schema),
		SelectedOptions: selectedOptions(rawProperties(block), schema),
		PersonNames:     readNames,
		PersonIDs:       readIDs,
		At:              time.Now(),
	}, nil
}

// selectedOptions is selectedOptionNames with the ids kept: every single-select
// value on the card as a full Column. It is what tells a caller which node a
// card read on demand stands on — the value of the trigger property — where the
// names alone cannot say which property they belong to.
func selectedOptions(props map[string]any, schema model.PropSchema) []acp.Column {
	var out []acp.Column
	for propID, def := range schema {
		if def.Type != "select" {
			continue
		}
		v, ok := props[propID]
		if !ok || v == nil {
			continue
		}
		id, ok := v.(string)
		if !ok {
			continue
		}
		if opt, ok := def.Options[id]; ok && opt.Value != "" {
			out = append(out, acp.Column{
				PropertyID:   propID,
				PropertyName: def.Name,
				OptionID:     id,
				Name:         opt.Value,
			})
		}
	}
	return out
}

// cardListLimit is how many cards one listing reads. A board is a person's
// working set, not an archive, and an agent given a thousand cards would spend
// its context on them rather than on the work.
const cardListLimit = 500

// CardsForBoard lists a board's cards, which is how an agent finds the card it
// has to act on: everything else it can do to one takes an id, and an id is not
// something a conversation carries.
//
// Bodies are left out on purpose (see acp.BoardReader): each one is a query of
// its own, and a listing is read to pick a card, not to work from it.
func (b *EventsBackend) CardsForBoard(ctx context.Context, boardID string) ([]acp.CardMoved, error) {
	b.mu.Lock()
	a := b.app
	b.mu.Unlock()
	if a == nil {
		return nil, fmt.Errorf("board app is not ready")
	}
	board, err := a.GetBoard(boardID)
	if err != nil {
		return nil, fmt.Errorf("get board %s: %w", boardID, err)
	}
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		return nil, fmt.Errorf("parse board schema: %w", err)
	}
	// The card blocks rather than app.GetCardsForBoard, and for the same reason
	// CardByID reads a block: the board's Card type is a lossy view that refuses
	// a card whose fields it does not recognise, and one such card would fail
	// the whole listing. A block is what a card is; everything below reads it
	// exactly as the trigger does.
	blocks, err := a.GetBlocks(boardID, "", string(model.TypeCard))
	if err != nil {
		return nil, fmt.Errorf("get cards of board %s: %w", boardID, err)
	}

	resolver := newUserResolver(b.appUserLookup())
	out := make([]acp.CardMoved, 0, len(blocks))
	for _, block := range blocks {
		if block == nil || block.DeleteAt != 0 {
			continue
		}
		if isTemplate, _ := block.Fields["isTemplate"].(bool); isTemplate {
			continue
		}
		props := rawProperties(block)
		listNames, listIDs := personNames(props, schema, resolver)
		out = append(out, acp.CardMoved{
			EventID:         uuid.NewString(),
			CardID:          block.ID,
			BoardID:         board.ID,
			Title:           block.Title,
			Props:           namedProperties(block, schema, resolver),
			Values:          valuesByID(block, schema, resolver),
			OptionNames:     selectedOptionNames(props, schema),
			SelectedOptions: selectedOptions(props, schema),
			PersonNames:     listNames,
			PersonIDs:       listIDs,
			At:              time.UnixMilli(block.UpdateAt),
		})
		if len(out) >= cardListLimit {
			break
		}
	}
	return out, nil
}

// BoardProperties returns the board's own free-form properties, where a
// template leaves the automation it ships (see acp.BoardPropColumns/Flows).
func (b *EventsBackend) BoardProperties(_ context.Context, boardID string) (map[string]any, error) {
	b.mu.Lock()
	a := b.app
	b.mu.Unlock()
	if a == nil {
		return nil, fmt.Errorf("board app is not ready")
	}
	board, err := a.GetBoard(boardID)
	if err != nil {
		return nil, fmt.Errorf("get board %s: %w", boardID, err)
	}
	if board == nil {
		return nil, nil
	}
	return board.Properties, nil
}

// SetBoardProperties writes the named properties onto the board and leaves the
// rest alone, which is how a board's own automation is saved (acp.BoardProp*).
//
// The write is the system user's, not the person's at the keyboard: it is the
// app recording what the app was told, and attributing it to whoever happened
// to have the dialog open would put their name on a board they may only be
// looking at.
func (b *EventsBackend) SetBoardProperties(_ context.Context, boardID string, props map[string]any, remove []string) error {
	b.mu.Lock()
	a := b.app
	b.mu.Unlock()
	if a == nil {
		return fmt.Errorf("board app is not ready")
	}
	patch := &model.BoardPatch{UpdatedProperties: props, DeletedProperties: remove}
	if _, err := a.PatchBoard(patch, boardID, model.SystemUserID); err != nil {
		return fmt.Errorf("patch board %s: %w", boardID, err)
	}
	return nil
}

// IsBoardTemplate says the board is one to copy rather than to work in.
func (b *EventsBackend) IsBoardTemplate(_ context.Context, boardID string) (bool, error) {
	b.mu.Lock()
	a := b.app
	b.mu.Unlock()
	if a == nil {
		return false, fmt.Errorf("board app is not ready")
	}
	board, err := a.GetBoard(boardID)
	if err != nil {
		return false, fmt.Errorf("get board %s: %w", boardID, err)
	}
	return board != nil && board.IsTemplate, nil
}

func column(def model.PropDef, optionID string) acp.Column {
	name := ""
	if opt, ok := def.Options[optionID]; ok {
		name = opt.Value
	}
	return acp.Column{
		PropertyID:   def.ID,
		PropertyName: def.Name,
		OptionID:     optionID,
		Name:         name,
	}
}

func rawProperties(block *model.Block) map[string]any {
	if block == nil {
		return nil
	}
	props, _ := block.Fields["properties"].(map[string]any)
	return props
}

func stringValue(v any) string {
	if v == nil {
		return ""
	}
	return fmt.Sprintf("%v", v)
}

// selectedOptionNames collects the display names of every selected
// select/multiSelect option on the card — the "tags" used to map the card to
// a registered project.
func selectedOptionNames(props map[string]any, schema model.PropSchema) []string {
	var out []string
	appendOption := func(def model.PropDef, v any) {
		id, ok := v.(string)
		if !ok {
			return
		}
		if opt, ok := def.Options[id]; ok && opt.Value != "" {
			out = append(out, opt.Value)
		}
	}
	for propID, def := range schema {
		v, ok := props[propID]
		if !ok || v == nil {
			continue
		}
		switch def.Type {
		case "select":
			appendOption(def, v)
		case "multiSelect":
			if vals, ok := v.([]any); ok {
				for _, item := range vals {
					appendOption(def, item)
				}
			}
		}
	}
	return out
}

// userLookup resolves a user id to a username. Person property values are ids;
// an agent is matched by the name behind them.
type userLookup func(userID string) string

// userResolver adapts userLookup to model.PropValueResolver, memoizing lookups:
// ParseProperties asks once per person value, and BlockChanged runs on the
// notify worker, which must stay quick.
type userResolver struct {
	lookup userLookup
	seen   map[string]*model.User
}

func newUserResolver(lookup userLookup) *userResolver {
	return &userResolver{lookup: lookup, seen: make(map[string]*model.User)}
}

// GetUserByID never fails: an unknown or deleted user leaves the raw id as the
// property value instead of discarding the whole property map.
func (r *userResolver) GetUserByID(userID string) (*model.User, error) {
	if r == nil || r.lookup == nil || userID == "" {
		return nil, nil
	}
	if user, ok := r.seen[userID]; ok {
		return user, nil
	}
	var user *model.User
	if username := r.lookup(userID); username != "" {
		user = &model.User{ID: userID, Username: username}
	}
	r.seen[userID] = user
	return user, nil
}

// appUserLookup reads usernames through the app layer.
func (b *EventsBackend) appUserLookup() userLookup {
	b.mu.Lock()
	a := b.app
	b.mu.Unlock()
	if a == nil {
		return nil
	}
	return func(userID string) string {
		user, err := a.GetUser(userID)
		if err != nil || user == nil {
			return ""
		}
		return user.Username
	}
}

// personNames collects the usernames of every selected person/multiPerson
// value — how an assignee routes a card to an agent.
func personNames(props map[string]any, schema model.PropSchema, resolver *userResolver) (names, ids []string) {
	appendUser := func(v any) {
		id, ok := v.(string)
		if !ok || id == "" {
			return
		}
		// The id goes out whether or not the account can be read: it is what
		// the card stores and what an agent is matched by, and a user the
		// resolver cannot reach right now must not read as an empty assignee.
		ids = append(ids, id)
		user, _ := resolver.GetUserByID(id)
		if user != nil && user.Username != "" {
			names = append(names, user.Username)
		}
	}
	for propID, def := range schema {
		v, ok := props[propID]
		if !ok || v == nil {
			continue
		}
		switch def.Type {
		case "person":
			appendUser(v)
		case "multiPerson":
			if vals, ok := v.([]any); ok {
				for _, item := range vals {
					appendUser(item)
				}
			}
		}
	}
	return names, ids
}

// namedProperties resolves the card's properties into a lowercased
// name → display-value map (repo_path, branch, …). Person values come out as
// usernames when a resolver is supplied.
func namedProperties(block *model.Block, schema model.PropSchema, resolver *userResolver) map[string]string {
	out := make(map[string]string)
	parsed, err := model.ParseProperties(block, schema, resolver)
	if err != nil {
		return out
	}
	for _, prop := range parsed {
		if prop.Name == "" {
			continue
		}
		out[strings.ToLower(prop.Name)] = prop.Value
	}
	return out
}

// valuesByID is the same card, keyed the way this app's own fields are found:
// by the id the board recorded for each of them (BoardPropBranch and the rest).
// The name-keyed map above is for the fields nobody records — a person's own
// «repo_path» — and cannot serve these, because what they are called is the
// owner's business.
func valuesByID(block *model.Block, schema model.PropSchema, resolver *userResolver) map[string]string {
	out := make(map[string]string)
	parsed, err := model.ParseProperties(block, schema, resolver)
	if err != nil {
		return out
	}
	for id, prop := range parsed {
		if v := strings.TrimSpace(prop.Value); v != "" {
			out[id] = v
		}
	}
	return out
}

// cardBody joins the card's text content blocks in contentOrder order.
func (b *EventsBackend) cardBody(boardID string, card *model.Block) string {
	b.mu.Lock()
	a := b.app
	b.mu.Unlock()
	if a == nil {
		return ""
	}
	blocks, err := a.GetBlocks(boardID, card.ID, string(model.TypeText))
	if err != nil || len(blocks) == 0 {
		return ""
	}

	order := map[string]int{}
	if rawOrder, ok := card.Fields["contentOrder"].([]any); ok {
		for i, v := range rawOrder {
			if id, ok := v.(string); ok {
				order[id] = i
			}
		}
	}
	sort.SliceStable(blocks, func(i, j int) bool {
		oi, iok := order[blocks[i].ID]
		oj, jok := order[blocks[j].ID]
		switch {
		case iok && jok:
			return oi < oj
		case iok:
			return true
		default:
			return false
		}
	})

	var parts []string
	for _, blk := range blocks {
		if t := strings.TrimSpace(blk.Title); t != "" {
			parts = append(parts, t)
		}
	}
	return strings.Join(parts, "\n\n")
}

// BoardColumnOptions is the board's column property and its options, for
// acp.BoardMeta. The property is the one the board recorded for itself, and
// failing that the one a person reads as the columns — what a view groups by.
func (b *EventsBackend) BoardColumnOptions(_ context.Context, boardID string) ([]acp.Column, error) {
	b.mu.Lock()
	a := b.app
	b.mu.Unlock()
	if a == nil {
		return nil, fmt.Errorf("board app is not ready")
	}
	board, err := a.GetBoard(boardID)
	if err != nil {
		return nil, fmt.Errorf("get board %s: %w", boardID, err)
	}
	if board == nil {
		return nil, nil
	}
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		return nil, err
	}

	propID, _ := board.Properties[acp.BoardPropColumnProperty].(string)
	if _, ok := schema[propID]; !ok {
		views, err := a.GetBlocks(boardID, "", model.TypeView)
		if err != nil {
			return nil, fmt.Errorf("get views of board %s: %w", boardID, err)
		}
		name, found := columnPropertyName(board, schema, views)
		if !found {
			return nil, nil
		}
		propID = ""
		for id, def := range schema {
			if def.Type == "select" && strings.EqualFold(def.Name, name) {
				propID = id
				break
			}
		}
	}
	def, ok := schema[propID]
	if !ok {
		return nil, nil
	}
	out := make([]acp.Column, 0, len(def.Options))
	for id, opt := range def.Options {
		out = append(out, acp.Column{
			PropertyID: propID, PropertyName: def.Name,
			OptionID: id, Name: opt.Value,
		})
	}
	return out, nil
}
