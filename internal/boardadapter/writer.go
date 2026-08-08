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
)

// Writer implements acp.BoardWriter over the server's app layer. All writes
// pass disableNotify=true: notify backends (incl. EventsBackend) are skipped
// so our own writes never re-trigger the agent, while the WebSocket broadcast
// still updates the UI live.
type Writer struct {
	app *app.App
}

var _ acp.BoardWriter = (*Writer)(nil)

func NewWriter(a *app.App) *Writer { return &Writer{app: a} }

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

// patchCard applies a card patch as a block patch. app.PatchCard would do the
// same and then convert the result back into a Card, which fails for a card
// whose contentOrder is not a list — and a write that landed must not be
// reported as an error because the answer could not be rendered.
func (w *Writer) patchCard(cardID string, patch *model.CardPatch, disableNotify bool) error {
	blockPatch, err := model.CardPatch2BlockPatch(patch)
	if err != nil {
		return err
	}
	_, err = w.app.PatchBlockAndNotify(cardID, blockPatch, model.SingleUser, disableNotify)
	return err
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
