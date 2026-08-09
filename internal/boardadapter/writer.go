package boardadapter

import (
	"bytes"
	"context"
	"fmt"
	"strings"

	"github.com/mattermost/focalboard/server/app"
	"github.com/mattermost/focalboard/server/model"
	"github.com/mattermost/focalboard/server/utils"

	"github.com/artipop/xciii/internal/acp"
	"github.com/artipop/xciii/internal/sources"
)

// Writer implements acp.BoardWriter over the server's app layer. All writes
// pass disableNotify=true: notify backends (incl. EventsBackend) are skipped
// so our own writes never re-trigger the agent, while the WebSocket broadcast
// still updates the UI live.
type Writer struct {
	app *app.App
}

var (
	_ acp.BoardWriter     = (*Writer)(nil)
	_ sources.BoardWriter = (*Writer)(nil)
)

func NewWriter(a *app.App) *Writer { return &Writer{app: a} }

// AddComment posts a comment block on the card.
func (w *Writer) AddComment(ctx context.Context, cardID, text string) error {
	card, err := w.app.GetCardByID(cardID)
	if err != nil {
		return fmt.Errorf("get card %s: %w", cardID, err)
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
	card, err := w.app.GetCardByID(cardID)
	if err != nil {
		return fmt.Errorf("get card %s: %w", cardID, err)
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
	patch := &model.CardPatch{UpdatedProperties: map[string]any{propID: optionID}}
	_, err = w.app.PatchCard(patch, cardID, model.SingleUser, true)
	return err
}

// MoveCardByOptionName moves a card to a column named in the config rather than
// identified by id — "Tested", not "a7f3…". Property and option are matched
// case-insensitively, as the trigger columns are.
func (w *Writer) MoveCardByOptionName(ctx context.Context, cardID, propertyName, optionName string) error {
	card, err := w.app.GetCardByID(cardID)
	if err != nil {
		return fmt.Errorf("get card %s: %w", cardID, err)
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
	patch := &model.CardPatch{UpdatedProperties: map[string]any{propID: optionID}}
	_, err = w.app.PatchCard(patch, cardID, model.SingleUser, true)
	return err
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
	views, err := w.app.GetBlocks(boardID, boardID, model.TypeView)
	if err != nil {
		return "", fmt.Errorf("get views of board %s: %w", boardID, err)
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

// EnsureInbox makes a board's inbox exist: the column things arrive in, and the
// view that shows only them.
//
// The view is where the inbox lives for a person. The sidebar already lists a
// board's views underneath it, so a filtered view is the inbox in the one place
// a person looks for a part of a board — beside the calendar and the table,
// rather than as a column in the middle of the work.
func (w *Writer) EnsureInbox(ctx context.Context, boardID, propertyName, optionName string) (string, error) {
	optionID, err := w.EnsureColumn(ctx, boardID, propertyName, optionName)
	if err != nil {
		return "", err
	}
	// The inbox is grouped by who made the card, which for what arrived is the
	// source that brought it. The property has to exist for a view to group by
	// it, and a board of ours may not have one.
	authorID, err := w.ensureAuthorProperty(boardID)
	if err != nil {
		return optionID, err
	}
	if err := w.ensureInboxView(boardID, propertyName, optionID, authorID); err != nil {
		// The column is what the pipeline cannot do without; the view is how a
		// person finds what landed in it. Losing the second is worth a line in
		// the log and not the card.
		return optionID, fmt.Errorf("вид «%s» на доске %s: %w", InboxViewTitle, boardID, err)
	}
	return optionID, nil
}

// AuthorPropertyTitle is what the board calls "who made this card". It is the
// name the developer template already uses, so a board made from it keeps the
// property it had rather than growing a second one saying the same thing.
const AuthorPropertyTitle = "Автор"

// ensureAuthorProperty returns the id of the board's createdBy property, adding
// one if it has none. Add-only, like every other write to a board's schema
// here: nothing is removed and an existing one is reused whatever it is called.
func (w *Writer) ensureAuthorProperty(boardID string) (string, error) {
	board, err := w.app.GetBoard(boardID)
	if err != nil {
		return "", fmt.Errorf("get board %s: %w", boardID, err)
	}
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		return "", err
	}
	if id, ok := arrivedAuthor(board, schema); ok {
		return id, nil
	}
	propID := utils.NewID(utils.IDTypeBlock)
	prop := map[string]any{
		"id":      propID,
		"name":    AuthorPropertyTitle,
		"type":    "createdBy",
		"options": []any{},
	}
	patch := &model.BoardPatch{UpdatedCardProperties: []map[string]any{prop}}
	if _, err := w.app.PatchBoard(patch, boardID, model.SingleUser); err != nil {
		return "", fmt.Errorf("add the author property to board %s: %w", boardID, err)
	}
	return propID, nil
}

// arrivedAuthor finds the board's own createdBy property, in the board's order
// so the answer is the same on every call.
func arrivedAuthor(board *model.Board, schema model.PropSchema) (string, bool) {
	for _, prop := range board.CardProperties {
		id, ok := prop["id"].(string)
		if !ok {
			continue
		}
		if def, ok := schema[id]; ok && def.Type == "createdBy" {
			return id, true
		}
	}
	return "", false
}

// arrivedProperty is the board's own "created" property, if it has one. In the
// inbox it is the column worth seeing beside the title: what a table of arrived
// things is read for is what arrived and when.
func arrivedProperty(schema model.PropSchema) (string, bool) {
	for id, def := range schema {
		if def.Type == "createdTime" {
			return id, true
		}
	}
	return "", false
}

// ensureInboxView adds the view if the board has not got one already, and
// teaches an older one to group — a view made before the inbox grouped by
// anything would otherwise be the one board where it does not.
func (w *Writer) ensureInboxView(boardID, propertyName, optionID, authorID string) error {
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

	views, err := w.app.GetBlocks(boardID, boardID, model.TypeView)
	if err != nil {
		return fmt.Errorf("get views: %w", err)
	}
	for _, view := range views {
		if !strings.EqualFold(view.Title, InboxViewTitle) {
			continue
		}
		if groupBy, _ := view.Fields["groupById"].(string); groupBy == authorID {
			return nil
		}
		patch := &model.BlockPatch{UpdatedFields: map[string]any{"groupById": authorID}}
		_, err := w.app.PatchBlockAndNotify(view.ID, patch, model.SingleUser, true)
		return err
	}

	visible := []any{}
	widths := map[string]any{"__title": 420}
	if arrived, ok := arrivedProperty(schema); ok {
		visible = append(visible, arrived)
		widths[arrived] = 160
	}

	now := utils.GetMillis()
	block := &model.Block{
		ID:       utils.NewID(utils.IDTypeView),
		BoardID:  boardID,
		ParentID: boardID,
		Type:     model.TypeView,
		Title:    InboxViewTitle,
		Fields: map[string]any{
			// A table and not a kanban: an inbox is a list of what came in, and
			// a board of one column is a board pretending to be a list.
			"viewType": "table",
			// Grouped by who made the card: for what arrived that is the source
			// that brought it, and for the rest it is whoever typed it.
			"groupById": authorID,
			"filter": map[string]any{
				"operation": "and",
				"filters": []any{map[string]any{
					"propertyId": propID,
					"condition":  "includes",
					"values":     []any{optionID},
				}},
			},
			// The title, and when it arrived if the board keeps that. Nothing
			// else: a source's own «Источник» and «Ссылка» are not properties
			// these boards have, and a table of empty columns says less than
			// none. The title is given a real width, since a column left to
			// the minimum is what makes a one-column table look broken.
			"visiblePropertyIds": visible,
			"columnWidths":       widths,
			"sortOptions": []any{map[string]any{
				"propertyId": "__title",
				"reversed":   false,
			}},
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

// CardSpec is a card somebody outside the board asked for: a title, an optional
// body and properties named rather than identified, since a source knows it
// wants «Ссылка» filled in and cannot know the id the board gave it.
//
// It is an alias of the sources type for the same reason the ACP writes take
// acp types: the interface being satisfied is declared over there, and one
// CreateCard is better than a second method that only converts a struct.
type CardSpec = sources.CardSpec

// CreateCard creates a card on the board and returns its id.
//
// It is written with disableNotify=true like every other write here, so the
// card arrives without waking the agent trigger. That is not a limitation to
// work around: the trigger only fires on a *change* of the column property, so
// a card created straight into a working column would start nothing anyway.
// Whoever wants the automation creates the card where nothing happens and then
// moves it with MoveCardByOptionName, which is a real move with a real previous
// state — the same thing the flow engine does.
func (w *Writer) CreateCard(ctx context.Context, boardID string, spec CardSpec) (string, error) {
	board, err := w.app.GetBoard(boardID)
	if err != nil {
		return "", fmt.Errorf("get board %s: %w", boardID, err)
	}
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		return "", fmt.Errorf("parse property schema of board %s: %w", boardID, err)
	}

	// The card is authored by whatever brought it, so the board's own "created
	// by" answers where it came from — and the inbox groups by that. A card
	// nobody outside made stays the single user's.
	author := model.SingleUser
	if spec.Source != "" {
		// A source that could not be given an account still gets its card,
		// under this app's own name: losing the author is a smaller loss than
		// losing what arrived, and a name already taken by an agent is the one
		// way this fails.
		if id, err := w.EnsureSourceUser(ctx, boardID, spec.Source); err == nil && id != "" {
			author = id
		}
	}

	properties := cardProperties(schema, spec.Properties)
	if properties == nil {
		properties = map[string]any{}
	}

	card := &model.Card{
		Title: spec.Title,
		Icon:  spec.Icon,
		// Both empty rather than nil: a nil slice or map is stored as JSON null,
		// and Block2Card refuses to read such a field back at all — so a card
		// created this way could never be touched again. Both cases are the
		// ordinary one for a notification, which has no body and, on a board
		// without «Ссылка», no property this card can hold either; and both
		// failures land on the move into the inbox, where nothing about them
		// explains itself.
		ContentOrder: []string{},
		Properties:   properties,
	}
	created, err := w.app.CreateCard(card, boardID, author, true)
	if err != nil {
		return "", fmt.Errorf("create card on board %s: %w", boardID, err)
	}
	if strings.TrimSpace(spec.Body) == "" {
		return created.ID, nil
	}
	if err := w.appendText(created.ID, boardID, spec.Body); err != nil {
		// The card exists and is the useful half; a missing body is worth
		// reporting, not worth pretending the card was never created.
		return created.ID, err
	}
	return created.ID, nil
}

// appendText adds a text block to the end of the card's content — the two-step
// write AttachFile already does, and the only way a card gets a description.
func (w *Writer) appendText(cardID, boardID, text string) error {
	now := utils.GetMillis()
	block := &model.Block{
		ID:        utils.NewID(model.BlockType2IDType(model.TypeText)),
		BoardID:   boardID,
		ParentID:  cardID,
		Type:      model.TypeText,
		Title:     text,
		CreatedBy: model.SingleUser,
		CreateAt:  now,
		UpdateAt:  now,
	}
	if _, err := w.app.InsertBlocksAndNotify([]*model.Block{block}, model.SingleUser, true); err != nil {
		return fmt.Errorf("insert text block: %w", err)
	}
	return w.appendContent(cardID, block.ID)
}

// cardProperties resolves named properties against the board's schema: a select
// takes the id of the option named, everything else takes the value as it came.
//
// A name the board does not have is skipped rather than refused. A source
// describes what it brought, and boards differ — one carries «Ссылка», the next
// does not — so a missing property must cost that property and not the card.
func cardProperties(schema model.PropSchema, props map[string]string) map[string]any {
	if len(props) == 0 {
		return nil
	}
	out := make(map[string]any, len(props))
	for name, value := range props {
		for id, def := range schema {
			if !strings.EqualFold(def.Name, name) {
				continue
			}
			if def.Type != "select" {
				out[id] = value
				break
			}
			// An option the board does not have is not invented here: adding
			// options to a board is a deliberate, add-only act elsewhere.
			for oid, opt := range def.Options {
				if strings.EqualFold(opt.Value, value) {
					out[id] = oid
					break
				}
			}
			break
		}
	}
	return out
}

// AttachFile puts a file into the card's content: an image is rendered inline,
// anything else becomes a download. This is how a test run's screenshots end up
// where a human reads the result, instead of in a directory nobody opens.
func (w *Writer) AttachFile(ctx context.Context, cardID, filename, mime string, data []byte) error {
	card, err := w.app.GetCardByID(cardID)
	if err != nil {
		return fmt.Errorf("get card %s: %w", cardID, err)
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
