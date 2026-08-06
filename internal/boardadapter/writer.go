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

	card := &model.Card{
		Title:      spec.Title,
		Icon:       spec.Icon,
		Properties: cardProperties(schema, spec.Properties),
	}
	created, err := w.app.CreateCard(card, boardID, model.SingleUser, true)
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
