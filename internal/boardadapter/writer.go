package boardadapter

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/artipop/xciii/server/app"
	"github.com/artipop/xciii/server/model"
	"github.com/artipop/xciii/server/utils"

	"github.com/artipop/xciii/internal/acp"
)

// Writer implements acp.BoardWriter over the server's app layer. All writes
// pass disableNotify=true: notify backends (incl. EventsBackend) are skipped
// so our own writes never re-trigger the agent, while the WebSocket broadcast
// still updates the UI live.
type Writer struct {
	app *app.App
	// log is for the writes that must not fail the caller — the bookkeeping
	// this integration keeps on a card beside what a person filled in. The
	// board's own logger is not reachable from here, and slog is what the rest
	// of this app uses anyway.
	log *slog.Logger
}

var _ acp.BoardWriter = (*Writer)(nil)

func NewWriter(a *app.App) *Writer { return &Writer{app: a, log: slog.Default()} }

// cardBlock is the card every write here starts from. It reads the block rather
// than the board's own Card view on purpose: Block2Card refuses a card whose
// contentOrder is not a list — which a card created with none is, stored as JSON
// null — and a card that cannot be read is a card that cannot be commented on or
// moved. Nothing below needs anything from a card but the board it stands on.
func (w *Writer) cardBlock(cardID string) (*model.Block, error) {
	block, err := w.app.GetBlockByID(cardID)
	if err != nil {
		return nil, fmt.Errorf("get card %s: %w", cardID, err)
	}
	if block == nil || block.Type != model.TypeCard {
		return nil, fmt.Errorf("block %s is not a card", cardID)
	}
	return block, nil
}

// AddComment posts a comment block on the card.
func (w *Writer) AddComment(ctx context.Context, cardID, text string) error {
	card, err := w.cardBlock(cardID)
	if err != nil {
		return err
	}
	now := utils.GetMillis()
	block := &model.Block{
		ID:       utils.NewID(utils.IDTypeBlock),
		BoardID:  card.BoardID,
		ParentID: cardID,
		Type:     model.TypeComment,
		Title:    text,
		// A session's report and a person's comment are both written by the
		// single user this app runs as, so the author cannot tell them apart.
		// The card draws them differently — one is a log entry, the other is
		// somebody talking — and this is what it reads to know which.
		Fields:    map[string]any{"agent": true},
		CreatedBy: model.SingleUser,
		CreateAt:  now,
		UpdateAt:  now,
	}
	_, err = w.app.InsertBlocksAndNotify([]*model.Block{block}, model.SingleUser, true)
	return err
}

// MoveCard sets the card's select property to optionID (post-MVP: used to
// advance the card after a successful session).
func (w *Writer) MoveCard(ctx context.Context, cardID, optionID string) error {
	card, err := w.cardBlock(cardID)
	if err != nil {
		return err
	}
	board, err := w.app.GetBoard(card.BoardID)
	if err != nil {
		return fmt.Errorf("get board %s: %w", card.BoardID, err)
	}
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		return err
	}
	propID := ""
	for id, def := range schema {
		if def.Type == "select" {
			if _, ok := def.Options[optionID]; ok {
				propID = id
				break
			}
		}
	}
	if propID == "" {
		return fmt.Errorf("no select property on board %s has option %s", board.ID, optionID)
	}
	return w.patchCard(cardID, &model.CardPatch{UpdatedProperties: map[string]any{propID: optionID}}, true)
}

// MoveCardByOptionName moves a card to a column named in the config rather than
// identified by id — "Tested", not "a7f3…". Property and option are matched
// case-insensitively, as the trigger columns are.
func (w *Writer) MoveCardByOptionName(ctx context.Context, cardID, propertyName, optionName string) error {
	card, err := w.cardBlock(cardID)
	if err != nil {
		return err
	}
	board, err := w.app.GetBoard(card.BoardID)
	if err != nil {
		return fmt.Errorf("get board %s: %w", card.BoardID, err)
	}
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		return err
	}
	propID, optionID, ok := findSelectOption(schema, propertyName, optionName)
	if !ok {
		return fmt.Errorf("на доске %s нет колонки %q в свойстве %q", board.ID, optionName, propertyName)
	}
	return w.patchCard(cardID, &model.CardPatch{UpdatedProperties: map[string]any{propID: optionID}}, true)
}

// UpdateCard changes an existing card the way a person editing it would: its
// title, the column it stands in, its other select values — all named, never
// identified by id.
//
// It is the one write here that lets the board notify: a card moved because an
// agent asked for it has to set off the column's automation, or asking was
// pointless. Everything else in this file stays silent so the integration's own
// writes cannot re-trigger the agent that produced them.
//
// A name the board does not have is refused rather than dropped. CreateCard
// takes the opposite bargain, and for a reason that does not hold here: there a
// plan of five cards must not be lost to one wrong guess, while here one card
// was asked to change one way, and half of that change is not it.
func (w *Writer) UpdateCard(ctx context.Context, cardID string, edit acp.CardEdit) error {
	card, err := w.cardBlock(cardID)
	if err != nil {
		return err
	}
	board, err := w.app.GetBoard(card.BoardID)
	if err != nil {
		return fmt.Errorf("get board %s: %w", card.BoardID, err)
	}
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		return err
	}

	patch, err := cardPatchFor(schema, edit)
	if err != nil {
		return err
	}
	return w.patchCard(cardID, patch, false)
}

// SetCardText writes one text property of a card, by id. Silent: it is the
// machine recording where a card's work lives, and it must not set the column's
// automation off the way a person's edit does.
func (w *Writer) SetCardText(ctx context.Context, cardID, propertyID, value string) error {
	if strings.TrimSpace(propertyID) == "" {
		return nil
	}
	return w.patchCard(cardID, &model.CardPatch{UpdatedProperties: map[string]any{propertyID: value}}, true)
}

// SetCardFields writes named properties of a card: a select property gets the
// option whose name the value is, anything else keeps the value as text. It is
// the write behind a stage's declared outputs (acp.PropertyWrite) — silent,
// because the stage's own outcome is the event the route acts on, and the
// refusals name what a person can fix: a property the board does not have, or
// an option a select does not carry.
func (w *Writer) SetCardFields(ctx context.Context, cardID string, fields map[string]string) error {
	if len(fields) == 0 {
		return nil
	}
	card, err := w.cardBlock(cardID)
	if err != nil {
		return err
	}
	board, err := w.app.GetBoard(card.BoardID)
	if err != nil {
		return fmt.Errorf("get board %s: %w", card.BoardID, err)
	}
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		return err
	}
	properties := map[string]any{}
	for name, value := range fields {
		propID, def, ok := findPropertyByName(schema, name)
		if !ok {
			return fmt.Errorf("на доске нет свойства %q", name)
		}
		if def.Type == "select" {
			optionID := ""
			for oid, opt := range def.Options {
				if strings.EqualFold(opt.Value, value) {
					optionID = oid
					break
				}
			}
			if optionID == "" {
				return fmt.Errorf("у свойства %q нет значения %q", name, value)
			}
			properties[propID] = optionID
			continue
		}
		properties[propID] = value
	}
	return w.patchCard(cardID, &model.CardPatch{UpdatedProperties: properties}, true)
}

// findPropertyByName resolves a property the way a person names it.
func findPropertyByName(schema model.PropSchema, name string) (string, model.PropDef, bool) {
	for id, def := range schema {
		if strings.EqualFold(def.Name, name) {
			return id, def, true
		}
	}
	return "", model.PropDef{}, false
}

// patchCard applies a card patch as a block patch. app.PatchCard would do the
// same and then convert the result back into a Card, which fails for a card
// whose contentOrder is not a list — and a write that landed must not be
// reported as an error because the answer could not be rendered.
func (w *Writer) patchCard(cardID string, patch *model.CardPatch, disableNotify bool) error {
	if err := mergeCardProperties(w.app, cardID, patch); err != nil {
		return err
	}
	blockPatch, err := model.CardPatch2BlockPatch(patch)
	if err != nil {
		return err
	}
	_, err = w.app.PatchBlockAndNotify(cardID, blockPatch, model.SingleUser, disableNotify)
	return err
}

// mergeCardProperties folds the card's current properties into the patch.
// CardPatch2BlockPatch puts UpdatedProperties into the block's `properties`
// field whole, and a block patch replaces a field it names — so a patch that
// set one property silently erased every other one. The board's own webapp
// never hits this because its mutator always sends the full map; every write
// from this side — a route moving the card, an agent's update_card, the
// assignee kept truthful by a stage — sends one key and lost the rest.
func mergeCardProperties(a *app.App, cardID string, patch *model.CardPatch) error {
	if len(patch.UpdatedProperties) == 0 {
		return nil
	}
	block, err := a.GetBlockByID(cardID)
	if err != nil {
		return fmt.Errorf("get card %s: %w", cardID, err)
	}
	merged := map[string]any{}
	if block != nil {
		if existing, ok := block.Fields["properties"].(map[string]any); ok {
			for k, v := range existing {
				merged[k] = v
			}
		}
	}
	for k, v := range patch.UpdatedProperties {
		merged[k] = v
	}
	patch.UpdatedProperties = merged
	return nil
}

// cardPatchFor turns named values into the ids a card stores, or says which name
// the board does not have.
func cardPatchFor(schema model.PropSchema, edit acp.CardEdit) (*model.CardPatch, error) {
	patch := &model.CardPatch{}
	if title := strings.TrimSpace(edit.Title); title != "" {
		patch.Title = &title
	}
	properties := map[string]any{}
	if edit.Column != "" {
		propID, optionID, ok := findSelectOption(schema, edit.Property, edit.Column)
		if !ok {
			return nil, fmt.Errorf("на доске нет колонки %q в свойстве %q", edit.Column, edit.Property)
		}
		properties[propID] = optionID
	}
	for _, option := range edit.Options {
		propID, optionID, ok := findOptionByName(schema, option)
		if !ok {
			return nil, fmt.Errorf("на доске нет значения %q", option)
		}
		// The column is the edit's own field, so an option name that happens to
		// match a column must not move the card somewhere nobody asked for.
		if properties[propID] == nil {
			properties[propID] = optionID
		}
	}
	if patch.Title == nil && len(properties) == 0 {
		return nil, fmt.Errorf("не сказано, что менять")
	}
	if len(properties) > 0 {
		patch.UpdatedProperties = properties
	}
	return patch, nil
}

// findSelectOption resolves a (property name, option name) pair to the ids the
// card actually stores. Matching is case-insensitive, like the trigger columns.
func findSelectOption(schema model.PropSchema, propertyName, optionName string) (propID, optionID string, ok bool) {
	for id, def := range schema {
		if def.Type != "select" || !strings.EqualFold(def.Name, propertyName) {
			continue
		}
		for oid, opt := range def.Options {
			if strings.EqualFold(opt.Value, optionName) {
				return id, oid, true
			}
		}
	}
	return "", "", false
}

// findOptionByName resolves a bare option name — "xciii", "claude", "Быстрый
// маршрут" — to the property that owns it. Which property that is, is the
// board's business: a card is read back the same way, by the names of the
// options selected on it and not by where they sit.
func findOptionByName(schema model.PropSchema, optionName string) (propID, optionID string, ok bool) {
	name := strings.TrimSpace(optionName)
	if name == "" {
		return "", "", false
	}
	for id, def := range schema {
		if def.Type != "select" {
			continue
		}
		for oid, opt := range def.Options {
			if strings.EqualFold(opt.Value, name) {
				return id, oid, true
			}
		}
	}
	return "", "", false
}

// boardViews is every view of a board.
//
// Asked for by board and *not* by parent, which is the obvious way to ask and
// the wrong one: a board made from a template keeps the template's board id in
// its views' parentId, so "the views whose parent is this board" misses every
// view a template brought — which is all of them on most boards here. That is
// what hid the kanban from the inbox code: it looked for views, found none, and
// carried on having done nothing.
func (w *Writer) boardViews(boardID string) ([]*model.Block, error) {
	views, err := w.app.GetBlocks(boardID, "", model.TypeView)
	if err != nil {
		return nil, fmt.Errorf("get views of board %s: %w", boardID, err)
	}
	return views, nil
}

// ColumnProperty is the name of the property whose options are this board's
// columns. It is asked of the board rather than assumed, because a constant
// default can only ever be right for boards in one language: ours say
// «Статус», the upstream templates say "Status", and a source pointed at the
// wrong name files nothing anywhere.
//
// The answer is the property the board itself groups by — what a person sees as
// the columns — and a board whose views group by nothing falls back to its
// first select property, which is what a kanban view would have picked too.
func (w *Writer) ColumnProperty(ctx context.Context, boardID string) (string, error) {
	board, err := w.app.GetBoard(boardID)
	if err != nil {
		return "", fmt.Errorf("get board %s: %w", boardID, err)
	}
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		return "", err
	}
	views, err := w.boardViews(boardID)
	if err != nil {
		return "", err
	}
	name, ok := columnPropertyName(board, schema, views)
	if !ok {
		return "", fmt.Errorf("на доске %s нет свойства-колонок", boardID)
	}
	return name, nil
}

// columnPropertyName picks the property whose options a person reads as the
// board's columns: what a view groups by, or failing that the board's first
// select property, which is what a new kanban view would have grouped by too.
func columnPropertyName(board *model.Board, schema model.PropSchema, views []*model.Block) (string, bool) {
	for _, view := range views {
		groupBy, _ := view.Fields["groupById"].(string)
		if def, ok := schema[groupBy]; ok && def.Type == "select" {
			return def.Name, true
		}
	}
	// CardProperties keeps the board's own order and schema is a map, so the
	// fallback is read off the ordered half — otherwise "the first select
	// property" would be a different one on every call.
	for _, prop := range board.CardProperties {
		if id, ok := prop["id"].(string); ok {
			if def, ok := schema[id]; ok && def.Type == "select" {
				return def.Name, true
			}
		}
	}
	return "", false
}

// EnsureColumn returns the id of the named option of the named select property,
// adding the option if the board does not have it yet.
//
// This is how the inbox reaches a board that already existed. Bumping
// TemplateVersion re-imports the *template* boards; boards already made from
// one are never touched again, so a column that only ships in a template would
// exist for new boards and for nobody else.
//
// Add-only, like the property sync of the project registry: an option somebody
// renamed stays renamed and nothing here removes one, because cards refer to
// options by id and a removed option is a card that lost its column.
func (w *Writer) EnsureColumn(ctx context.Context, boardID, propertyName, optionName string) (string, error) {
	board, err := w.app.GetBoard(boardID)
	if err != nil {
		return "", fmt.Errorf("get board %s: %w", boardID, err)
	}
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		return "", err
	}
	if _, optionID, ok := findSelectOption(schema, propertyName, optionName); ok {
		return optionID, nil
	}
	prop, ok := findCardProperty(board.CardProperties, propertyName)
	if !ok {
		// The property itself is not invented: a board with no column property
		// has no columns to file anything into, and guessing one would put the
		// card somewhere nobody looks.
		return "", fmt.Errorf("на доске %s нет свойства %q", boardID, propertyName)
	}
	optionID := utils.NewID(utils.IDTypeBlock)
	options, _ := prop["options"].([]any)
	prop["options"] = append(options, map[string]any{
		"id":    optionID,
		"value": optionName,
		"color": "propColorGray",
	})
	patch := &model.BoardPatch{UpdatedCardProperties: []map[string]any{prop}}
	if _, err := w.app.PatchBoard(patch, boardID, model.SingleUser); err != nil {
		return "", fmt.Errorf("add column %q to board %s: %w", optionName, boardID, err)
	}
	return optionID, nil
}

// InboxViewTitle is what the board calls the view that shows only what has
// arrived. It is matched by title when deciding whether the view is already
// there, so renaming it means the next check makes a second one — which is the
// same bargain every other name here strikes, and the alternative is a marker
// field on a block the board server knows nothing about.
const InboxViewTitle = "Входящие"

// MineColumnTitle is the column a person's own card lands in when they press
// «Создать» on the inbox — everything else there was brought by a source, and a
// task somebody typed is not something that arrived and nobody has read.
//
// It is a column of the board rather than a group of the view because the view
// is grouped by who made the card, and "made by me" is already a column there:
// what the person needs kept apart is what the *automation* sees, and that is
// the board's column property.
const MineColumnTitle = "Мои задачи"

// EnsureInbox makes a board's inbox exist: the column things arrive in, the
// column a person's own tasks start in, and the view that shows both.
//
// The view is where the inbox lives for a person. The sidebar already lists a
// board's views underneath it, so a filtered view is the inbox in the one place
// a person looks for a part of a board — beside the calendar and the table,
// rather than as a column in the middle of the work. The arrival column is
// hidden from the kanban for the same reason: it is where a card stands, not
// where anybody reads it.
func (w *Writer) EnsureInbox(ctx context.Context, boardID, propertyName, optionName string) (string, error) {
	optionID, mineID, authorID, err := w.ensureInboxSchema(boardID, propertyName, optionName)
	if err != nil {
		return optionID, err
	}
	if err := w.ensureInboxView(boardID, propertyName, optionID, mineID, authorID); err != nil {
		// The column is what the pipeline cannot do without; the view is how a
		// person finds what landed in it. Losing the second is worth a line in
		// the log and not the card.
		return optionID, fmt.Errorf("вид «%s» на доске %s: %w", InboxViewTitle, boardID, err)
	}
	if err := w.arrangeKanbans(boardID, propertyName, optionID, mineID); err != nil {
		return optionID, fmt.Errorf("колонки канбана на доске %s: %w", boardID, err)
	}
	return optionID, nil
}

// arrangeKanbans takes the inbox's two columns off the board's own kanbans:
// both are the inbox screen's business, and neither belongs in the middle of
// the work. «Мои задачи» stood at the front of the main kanban for one
// version and that was the wrong reading of the ask — a person's unprocessed
// tasks live on «Входящие» (where the view shows them as their own column),
// and the main board stays exactly the board of work.
//
// Both in one pass, and one patch per view, because a view's history is keyed
// by (id, insert_at) in milliseconds — two patches of the same block in a row
// are two rows in the same millisecond, and the second one loses.
//
// A group named in neither list is drawn (webapp/src/boardUtils.ts walks the
// visible ones and then the rest), so hiding is naming it in hiddenOptionIds —
// and taking it out of visibleOptionIds, where a board arranged by the
// front-column version still has it.
func (w *Writer) arrangeKanbans(boardID, propertyName, inboxID, mineID string) error {
	board, err := w.app.GetBoard(boardID)
	if err != nil {
		return fmt.Errorf("get board %s: %w", boardID, err)
	}
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		return err
	}
	views, err := w.boardViews(boardID)
	if err != nil {
		return err
	}
	for _, view := range views {
		if viewType, _ := view.Fields["viewType"].(string); viewType != inboxViewType {
			continue
		}
		// The inbox is a kanban too, and it groups by who brought the card:
		// naming a column of the board in its lists would say nothing there.
		groupBy, _ := view.Fields["groupById"].(string)
		if def, ok := schema[groupBy]; !ok || def.Type != "select" || !strings.EqualFold(def.Name, propertyName) {
			continue
		}

		visible, inboxWasVisible := withoutOption(view.Fields["visibleOptionIds"], inboxID)
		visible, mineWasVisible := withoutOption(visible, mineID)
		hidden, inboxWasHidden := withOption(view.Fields["hiddenOptionIds"], inboxID)
		hidden, mineWasHidden := withOption(hidden, mineID)
		if !inboxWasVisible && !mineWasVisible && inboxWasHidden && mineWasHidden {
			continue
		}
		patch := &model.BlockPatch{UpdatedFields: map[string]any{
			"visibleOptionIds": visible,
			"hiddenOptionIds":  hidden,
		}}
		if _, err := w.app.PatchBlockAndNotify(view.ID, patch, model.SingleUser, true); err != nil {
			return err
		}
	}
	return nil
}

// withoutOption is the list with the option taken out, and whether it was
// there; withOption is the list with it put in, and whether it already was.
func withoutOption(raw any, optionID string) ([]any, bool) {
	list, _ := raw.([]any)
	out := make([]any, 0, len(list))
	found := false
	for _, item := range list {
		if id, ok := item.(string); ok && id == optionID {
			found = true
			continue
		}
		out = append(out, item)
	}
	return out, found
}

// filterWithColumn is the view's filter with one more column admitted by the
// clause on the column property, and whether anything changed. The column goes
// first, because the first value of an "includes" clause is what a card made in
// that view becomes (CardFilter.propertyThatMeetsFilterClause in the webapp) —
// which is the whole of how «Создать» on the inbox lands in «Мои задачи».
//
// A view with no clause on that property is left alone: it was filtered by
// somebody, and a filter of ours put back would be an edit nobody asked for.
func filterWithColumn(raw any, propID, optionID string) (map[string]any, bool) {
	filter, ok := raw.(map[string]any)
	if !ok {
		return nil, false
	}
	clauses, ok := filter["filters"].([]any)
	if !ok {
		return nil, false
	}
	out := make([]any, 0, len(clauses))
	changed := false
	for _, item := range clauses {
		clause, ok := item.(map[string]any)
		if !ok {
			out = append(out, item)
			continue
		}
		if id, _ := clause["propertyId"].(string); id != propID {
			out = append(out, clause)
			continue
		}
		values, _ := clause["values"].([]any)
		if _, has := withOption(values, optionID); has {
			out = append(out, clause)
			continue
		}
		next := map[string]any{}
		for key, value := range clause {
			next[key] = value
		}
		next["values"] = append([]any{optionID}, values...)
		out = append(out, next)
		changed = true
	}
	if !changed {
		return nil, false
	}
	next := map[string]any{}
	for key, value := range filter {
		next[key] = value
	}
	next["filters"] = out
	return next, true
}

func withOption(raw any, optionID string) ([]any, bool) {
	list, _ := raw.([]any)
	for _, item := range list {
		if id, ok := item.(string); ok && id == optionID {
			return list, true
		}
	}
	return append(append([]any{}, list...), optionID), false
}

// inboxViewType is what the inbox is drawn as. A kanban rather than a table
// because it is grouped by what brought the card, and a column per source is
// what somebody opening an inbox is actually asking about.
const inboxViewType = "board"

// AuthorPropertyTitle is what the board calls "who made this card". It is the
// name the developer template already uses, so a board made from it keeps the
// property it had rather than growing a second one saying the same thing.
const AuthorPropertyTitle = "Автор"

// mineColumnColor is what «Мои задачи» is painted on a board that grew one
// later, and it is the colour the templates ship it in: the same column has to
// look the same wherever it came from.
const mineColumnColor = "propColorPurple"

// ensureInboxSchema adds everything the inbox needs of the board's schema — the
// column what arrives stands in, the column a person's own tasks start in, and
// the property the view groups by — and adds it in **one** write.
//
// One write because the board's history is keyed by (id, insert_at) in
// milliseconds: three patches in a row are three history rows in the same
// millisecond on any machine fast enough, and the second one fails on the
// unique key. Add-only, like every other write to a board's schema here:
// nothing is removed, and a property or option somebody renamed stays theirs.
func (w *Writer) ensureInboxSchema(boardID, propertyName, inboxName string) (inboxID, mineID, authorID string, err error) {
	board, err := w.app.GetBoard(boardID)
	if err != nil {
		return "", "", "", fmt.Errorf("get board %s: %w", boardID, err)
	}
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		return "", "", "", err
	}

	var updated []map[string]any
	_, inboxID, hasInbox := findSelectOption(schema, propertyName, inboxName)
	_, mineID, hasMine := findSelectOption(schema, propertyName, MineColumnTitle)
	if !hasInbox || !hasMine {
		prop, ok := findCardProperty(board.CardProperties, propertyName)
		if !ok {
			// The property itself is not invented: a board with no column
			// property has no columns to file anything into, and guessing one
			// would put the card somewhere nobody looks.
			return "", "", "", fmt.Errorf("на доске %s нет свойства %q", boardID, propertyName)
		}
		options, _ := prop["options"].([]any)
		if !hasInbox {
			inboxID = utils.NewID(utils.IDTypeBlock)
			options = append(options, map[string]any{"id": inboxID, "value": inboxName, "color": "propColorGray"})
		}
		if !hasMine {
			mineID = utils.NewID(utils.IDTypeBlock)
			options = append(options, map[string]any{"id": mineID, "value": MineColumnTitle, "color": mineColumnColor})
		}
		prop["options"] = options
		updated = append(updated, prop)
	}

	// The inbox is grouped by who made the card, which for what arrived is the
	// source that brought it. The property has to exist for a view to group by
	// it, and a board of ours may not have one.
	authorID, hasAuthor := arrivedAuthor(board, schema)
	if !hasAuthor {
		authorID = utils.NewID(utils.IDTypeBlock)
		updated = append(updated, map[string]any{
			"id":      authorID,
			"name":    AuthorPropertyTitle,
			"type":    "createdBy",
			"options": []any{},
		})
	}

	if len(updated) == 0 {
		return inboxID, mineID, authorID, nil
	}
	patch := &model.BoardPatch{UpdatedCardProperties: updated}
	if _, err := w.app.PatchBoard(patch, boardID, model.SingleUser); err != nil {
		return "", "", "", fmt.Errorf("завести «%s» на доске %s: %w", inboxName, boardID, err)
	}
	return inboxID, mineID, authorID, nil
}

// arrivedAuthor finds the board's own createdBy property, in the board's order
// so the answer is the same on every call.
func arrivedAuthor(board *model.Board, schema model.PropSchema) (string, bool) {
	return propertyOfType(board, schema, "createdBy")
}

// LinkPropertyTitle is what the board calls the way back to what a source
// brought. Like AuthorPropertyTitle it is a name given at creation and never a
// key: the property is found by its *type*, so a board that calls it "Link", or
// whose owner renamed it, keeps working and does not grow a second one.
const LinkPropertyTitle = "Ссылка"

// ensureLinkProperty returns the id of the board's url property, adding one if
// it has none. A card from a source is the only thing that asks for it, so a
// board nothing arrives on never grows the field — the same bargain the inbox
// column and view take.
func (w *Writer) ensureLinkProperty(boardID string) (string, error) {
	board, err := w.app.GetBoard(boardID)
	if err != nil {
		return "", fmt.Errorf("get board %s: %w", boardID, err)
	}
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		return "", err
	}
	if id, ok := propertyOfType(board, schema, "url"); ok {
		return id, nil
	}
	propID := utils.NewID(utils.IDTypeBlock)
	prop := map[string]any{
		"id":      propID,
		"name":    LinkPropertyTitle,
		"type":    "url",
		"options": []any{},
	}
	patch := &model.BoardPatch{UpdatedCardProperties: []map[string]any{prop}}
	if _, err := w.app.PatchBoard(patch, boardID, model.SingleUser); err != nil {
		return "", fmt.Errorf("add the link property to board %s: %w", boardID, err)
	}
	return propID, nil
}

// propertyOfType finds the board's first property of a given type, walking
// CardProperties rather than the parsed schema: the schema is a map, and a
// board with two properties of one type would otherwise answer differently on
// different runs.
func propertyOfType(board *model.Board, schema model.PropSchema, propType string) (string, bool) {
	for _, prop := range board.CardProperties {
		id, ok := prop["id"].(string)
		if !ok {
			continue
		}
		if def, ok := schema[id]; ok && def.Type == propType {
			return id, true
		}
	}
	return "", false
}

// ensureInboxView adds the view if the board has not got one already, and
// teaches an older one to group — a view made before the inbox grouped by
// anything would otherwise be the one board where it does not.
func (w *Writer) ensureInboxView(boardID, propertyName, optionID, mineID, authorID string) error {
	board, err := w.app.GetBoard(boardID)
	if err != nil {
		return fmt.Errorf("get board %s: %w", boardID, err)
	}
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		return err
	}
	propID := ""
	for id, def := range schema {
		if def.Type == "select" && strings.EqualFold(def.Name, propertyName) {
			propID = id
			break
		}
	}
	if propID == "" {
		return fmt.Errorf("нет свойства %q", propertyName)
	}

	views, err := w.boardViews(boardID)
	if err != nil {
		return err
	}
	for _, view := range views {
		if !isInboxView(view, propID, optionID) {
			continue
		}
		// An inbox made by an older version of this is a table grouped by
		// nothing. Both are brought to what it is now — a board grouped by who
		// brought the card — because the alternative is one board where the
		// inbox looks and behaves differently for no reason anybody can see.
		fields := map[string]any{}
		if groupBy, _ := view.Fields["groupById"].(string); groupBy != authorID {
			fields["groupById"] = authorID
		}
		if viewType, _ := view.Fields["viewType"].(string); viewType != inboxViewType {
			fields["viewType"] = inboxViewType
		}
		// And an inbox made before «Мои задачи» existed shows only what
		// arrived, so a card made with the «Создать» button standing right
		// there would vanish the moment it was made.
		if filter, changed := filterWithColumn(view.Fields["filter"], propID, mineID); changed {
			fields["filter"] = filter
		}
		if len(fields) == 0 {
			return nil
		}
		patch := &model.BlockPatch{UpdatedFields: fields}
		_, err := w.app.PatchBlockAndNotify(view.ID, patch, model.SingleUser, true)
		return err
	}

	now := utils.GetMillis()
	block := &model.Block{
		ID:       utils.NewID(utils.IDTypeView),
		BoardID:  boardID,
		ParentID: boardID,
		Type:     model.TypeView,
		Title:    InboxViewTitle,
		Fields: map[string]any{
			// A kanban, and grouped by who made the card — which for what
			// arrived is the source that brought it. One column per source is
			// the question a person actually has of an inbox ("what did the
			// mail bring, what did Kaiten"), and a card is dragged out of it
			// into work the same way it is dragged anywhere else.
			"viewType":  inboxViewType,
			"groupById": authorID,
			// Two columns, and «Мои задачи» first: the first value of an
			// "includes" clause is what a card made in this view becomes, so
			// pressing «Создать» here writes a task of one's own rather than
			// something that arrived and nobody has read.
			"filter": map[string]any{
				"operation": "and",
				"filters": []any{map[string]any{
					"propertyId": propID,
					"condition":  "includes",
					"values":     []any{mineID, optionID},
				}},
			},
			// Nothing else on the face of a card: what a person reads in an
			// inbox is the title and who brought it, and the second is the
			// column it stands in.
			"visiblePropertyIds": []any{},
			"columnWidths":       map[string]any{},
			"sortOptions":        []any{},
			"visibleOptionIds":   []any{},
			"hiddenOptionIds":    []any{},
			"collapsedOptionIds": []any{},
			"cardOrder":          []any{},
			"columnCalculations": map[string]any{},
			"kanbanCalculations": map[string]any{},
			"defaultTemplateId":  "",
		},
		CreatedBy: model.SingleUser,
		CreateAt:  now,
		UpdateAt:  now,
	}
	_, err = w.app.InsertBlocksAndNotify([]*model.Block{block}, model.SingleUser, true)
	return err
}

// isInboxView tells the inbox view from the board's other views by what it
// shows — a view filtered to the inbox option — rather than by what it is
// called. The title is the fallback and not the answer: renaming a view is
// something a person may do, and matching on «Входящие» meant the next card to
// arrive built a second inbox beside the renamed one.
func isInboxView(view *model.Block, propID, optionID string) bool {
	filter, _ := view.Fields["filter"].(map[string]any)
	filters, _ := filter["filters"].([]any)
	for _, raw := range filters {
		f, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if id, _ := f["propertyId"].(string); id != propID {
			continue
		}
		values, _ := f["values"].([]any)
		for _, value := range values {
			if s, _ := value.(string); s == optionID {
				return true
			}
		}
	}
	return strings.EqualFold(view.Title, InboxViewTitle)
}

// findCardProperty returns the board's raw definition of a property, which is
// what a patch replaces. The parsed schema cannot be used for this: it drops
// everything the board wrote that we do not read, and patching with it would
// silently delete those fields.
func findCardProperty(props []map[string]any, name string) (map[string]any, bool) {
	for _, prop := range props {
		if propType, _ := prop["type"].(string); propType != "select" {
			continue
		}
		if propName, _ := prop["name"].(string); strings.EqualFold(propName, name) {
			return prop, true
		}
	}
	return nil, false
}

// AttachFile puts a file into the card's content: an image is rendered inline,
// anything else becomes a download. This is how a test run's screenshots end up
// where a human reads the result, instead of in a directory nobody opens.
func (w *Writer) AttachFile(ctx context.Context, cardID, filename, mime string, data []byte) error {
	card, err := w.cardBlock(cardID)
	if err != nil {
		return err
	}
	board, err := w.app.GetBoard(card.BoardID)
	if err != nil {
		return fmt.Errorf("get board %s: %w", card.BoardID, err)
	}
	fileID, err := w.app.SaveFile(bytes.NewReader(data), board.TeamID, card.BoardID, filename, false)
	if err != nil {
		return fmt.Errorf("save file %s: %w", filename, err)
	}

	blockType := model.BlockType(model.TypeAttachment)
	if strings.HasPrefix(mime, "image/") {
		blockType = model.TypeImage
	}
	now := utils.GetMillis()
	block := &model.Block{
		ID:        utils.NewID(model.BlockType2IDType(blockType)),
		BoardID:   card.BoardID,
		ParentID:  cardID,
		Type:      blockType,
		Title:     filename,
		Fields:    map[string]any{"fileId": fileID},
		CreatedBy: model.SingleUser,
		CreateAt:  now,
		UpdateAt:  now,
	}
	if _, err := w.app.InsertBlocksAndNotify([]*model.Block{block}, model.SingleUser, true); err != nil {
		return fmt.Errorf("insert %s block: %w", blockType, err)
	}
	return w.appendContent(cardID, block.ID)
}

// CreateCard puts a new card on a board, in the column the spec names, with its
// description as the card's first text block — the same shape a card typed by a
// person has, since it is read back by the same code (EventsBackend.cardBody).
//
// Properties are resolved by name and a name the board does not have is
// dropped rather than refused: a plan of five cards must not be lost because
// the agent guessed one option wrong, and what it got is in the report.
func (w *Writer) CreateCard(ctx context.Context, spec acp.NewCard) (string, error) {
	board, err := w.app.GetBoard(spec.BoardID)
	if err != nil {
		return "", fmt.Errorf("get board %s: %w", spec.BoardID, err)
	}
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		return "", err
	}

	properties := map[string]any{}
	if spec.Column != "" {
		propID, optionID, ok := findSelectOption(schema, spec.Property, spec.Column)
		if !ok {
			return "", fmt.Errorf("на доске %s нет колонки %q в свойстве %q", board.ID, spec.Column, spec.Property)
		}
		properties[propID] = optionID
	}
	for _, option := range spec.Options {
		propID, optionID, ok := findOptionByName(schema, option)
		// Not the column property: the column is the spec's own field, and an
		// option name that happens to match a column must not move the card
		// somewhere the caller did not ask for.
		if ok && properties[propID] == nil {
			properties[propID] = optionID
		}
	}

	// ContentOrder is set even though the card has no content yet: a nil one is
	// stored as JSON null, and the board's own Block2Card refuses to read a card
	// whose contentOrder is neither a list nor absent. A card nobody can read
	// back is a card nobody can comment on or move — which is everything that
	// was supposed to happen to it next.
	card, err := w.app.CreateCard(
		&model.Card{Title: spec.Title, Properties: properties, ContentOrder: []string{}},
		board.ID, model.SingleUser, true,
	)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(spec.Body) == "" {
		return card.ID, nil
	}

	now := utils.GetMillis()
	body := &model.Block{
		ID:        utils.NewID(model.BlockType2IDType(model.TypeText)),
		BoardID:   board.ID,
		ParentID:  card.ID,
		Type:      model.TypeText,
		Title:     spec.Body,
		Fields:    map[string]any{},
		CreatedBy: model.SingleUser,
		CreateAt:  now,
		UpdateAt:  now,
	}
	if _, err := w.app.InsertBlocksAndNotify([]*model.Block{body}, model.SingleUser, true); err != nil {
		// The card exists and is the point; a description that did not land is
		// worth reporting, not worth pretending the card was never made.
		return card.ID, fmt.Errorf("карточка создана, но описание не сохранилось: %w", err)
	}
	if err := w.appendContent(card.ID, body.ID); err != nil {
		return card.ID, fmt.Errorf("карточка создана, но описание не встало в неё: %w", err)
	}
	return card.ID, nil
}

// appendContent adds a block to the end of the card's content. The card's raw
// contentOrder is patched rather than model.CardPatch's flat []string, because
// the field may hold nested arrays (side-by-side rows) that flattening would
// silently rearrange.
func (w *Writer) appendContent(cardID, blockID string) error {
	block, err := w.app.GetBlockByID(cardID)
	if err != nil {
		return fmt.Errorf("get card block %s: %w", cardID, err)
	}
	patch := &model.BlockPatch{UpdatedFields: map[string]any{
		"contentOrder": appendContentOrder(block.Fields, blockID),
	}}
	_, err = w.app.PatchBlockAndNotify(cardID, patch, model.SingleUser, true)
	return err
}

// appendContentOrder returns the card's content order with blockID at the end,
// preserving whatever nesting it already had.
func appendContentOrder(fields map[string]any, blockID string) []any {
	order := []any{}
	if existing, ok := fields["contentOrder"].([]any); ok {
		order = append(order, existing...)
	}
	return append(order, blockID)
}
