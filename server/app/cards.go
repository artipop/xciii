// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"fmt"
	"strings"

	"github.com/artipop/xciii/server/model"
	"github.com/artipop/xciii/server/utils"

	"github.com/artipop/xciii/server/mlog"
)

func (a *App) CreateCard(card *model.Card, boardID string, userID string, disableNotify bool) (*model.Card, error) {
	// Convert the card struct to a block and insert the block.
	now := utils.GetMillis()

	card.ID = utils.NewID(utils.IDTypeCard)
	card.BoardID = boardID
	card.CreatedBy = userID
	card.ModifiedBy = userID
	card.CreateAt = now
	card.UpdateAt = now
	card.DeleteAt = 0

	block := model.Card2Block(card)

	newBlocks, err := a.InsertBlocksAndNotify([]*model.Block{block}, userID, disableNotify)
	if err != nil {
		return nil, fmt.Errorf("cannot create card: %w", err)
	}

	newCard, err := model.Block2Card(newBlocks[0])
	if err != nil {
		return nil, err
	}

	return newCard, nil
}

func (a *App) GetCardsForBoard(boardID string, page int, perPage int) ([]*model.Card, error) {
	opts := model.QueryBlocksOptions{
		BoardID:   boardID,
		BlockType: model.TypeCard,
		Page:      page,
		PerPage:   perPage,
	}

	blocks, err := a.store.GetBlocks(opts)
	if err != nil {
		return nil, err
	}

	cards := make([]*model.Card, 0, len(blocks))
	for _, blk := range blocks {
		b := blk
		if card, err := model.Block2Card(b); err != nil {
			return nil, fmt.Errorf("Block2Card fail: %w", err)
		} else {
			cards = append(cards, card)
		}
	}
	return cards, nil
}

func (a *App) PatchCard(cardPatch *model.CardPatch, cardID string, userID string, disableNotify bool) (*model.Card, error) {
	blockPatch, err := model.CardPatch2BlockPatch(cardPatch)
	if err != nil {
		return nil, err
	}

	newBlock, err := a.PatchBlockAndNotify(cardID, blockPatch, userID, disableNotify)
	if err != nil {
		return nil, fmt.Errorf("cannot patch card %s: %w", cardID, err)
	}

	newCard, err := model.Block2Card(newBlock)
	if err != nil {
		return nil, err
	}

	return newCard, nil
}

// MoveCardToBoard carries a card and everything hanging off it — its content,
// its comments, its attachments — to another board, keeping the card's id.
//
// Keeping the id is the whole point of a move. Copying the card and deleting
// the original would have been the same picture on screen and a different card
// underneath: comments would be re-authored, and everything outside the board
// that remembers a card by id — an agent's session, a source's record of the
// item the card came from — would be pointing at something deleted.
//
// Properties are carried over by *name*, because ids are the board's own: the
// two boards' «Статус» are different properties with different options, and
// what a person means is the name they read. A property or option the new board
// has not got is dropped, the way a card written from outside drops what the
// board cannot hold — losing a field is better than refusing the move.
func (a *App) MoveCardToBoard(cardID, toBoardID, userID string) (*model.Card, error) {
	cardBlock, err := a.store.GetBlock(cardID)
	if err != nil {
		return nil, err
	}
	if cardBlock.Type != model.TypeCard {
		return nil, fmt.Errorf("block %s is not a card", cardID)
	}
	fromBoardID := cardBlock.BoardID
	if fromBoardID == toBoardID {
		return model.Block2Card(cardBlock)
	}

	fromBoard, err := a.store.GetBoard(fromBoardID)
	if err != nil {
		return nil, err
	}
	toBoard, err := a.store.GetBoard(toBoardID)
	if err != nil {
		return nil, err
	}

	blocks, err := a.store.GetSubTree2(fromBoardID, cardID, model.QuerySubtreeOptions{})
	if err != nil {
		return nil, err
	}
	blockIDs := make([]string, 0, len(blocks))
	for _, block := range blocks {
		blockIDs = append(blockIDs, block.ID)
	}
	if err := a.store.MoveBlocksToBoard(blockIDs, toBoardID, userID); err != nil {
		return nil, err
	}
	for _, block := range blocks {
		block.BoardID = toBoardID
	}

	// The files are copied from the board the card came from into the one it
	// went to, because a file's path carries its board. The originals are left
	// where they were, as they are when a board is duplicated: an unreferenced
	// file costs disk, a missing one costs the attachment.
	if err := a.CopyAndUpdateCardFiles(fromBoardID, userID, blocks, false); err != nil {
		a.logger.Error("cannot carry the card's files to the new board",
			mlog.String("cardID", cardID), mlog.String("boardID", toBoardID), mlog.Err(err))
	}

	properties, err := remapCardProperties(fromBoard, toBoard, cardBlock)
	if err != nil {
		return nil, err
	}
	patch := &model.BlockPatch{UpdatedFields: map[string]interface{}{"properties": properties}}
	movedBlock, err := a.PatchBlock(cardID, patch, userID)
	if err != nil {
		return nil, err
	}

	a.blockChangeNotifier.Enqueue(func() error {
		// Both boards are told, because both may be open: the card left one
		// and arrived on the other, and a page that hears only half of that
		// keeps showing a card that is no longer there.
		for _, block := range blocks {
			a.wsAdapter.BroadcastBlockDelete(fromBoard.TeamID, block.ID, fromBoardID)
		}
		for _, block := range blocks {
			a.wsAdapter.BroadcastBlockChange(toBoard.TeamID, block)
		}
		return nil
	})

	return model.Block2Card(movedBlock)
}

// remapCardProperties translates a card's property values from one board's ids
// to another's, matching on the names a person reads. Anything the new board
// cannot express is left out.
func remapCardProperties(from, to *model.Board, cardBlock *model.Block) (map[string]interface{}, error) {
	fromSchema, err := model.ParsePropertySchema(from)
	if err != nil {
		return nil, err
	}
	toSchema, err := model.ParsePropertySchema(to)
	if err != nil {
		return nil, err
	}
	card, err := model.Block2Card(cardBlock)
	if err != nil {
		return nil, err
	}

	out := make(map[string]interface{}, len(card.Properties))
	for propID, value := range card.Properties {
		fromDef, ok := fromSchema[propID]
		if !ok {
			continue
		}
		toID, toDef, ok := propertyByName(toSchema, fromDef)
		if !ok {
			continue
		}
		switch toDef.Type {
		case "select":
			if optionID, ok := optionByName(fromDef, toDef, value); ok {
				out[toID] = optionID
			}
		case "multiSelect":
			ids, ok := value.([]interface{})
			if !ok {
				continue
			}
			carried := make([]interface{}, 0, len(ids))
			for _, id := range ids {
				if optionID, ok := optionByName(fromDef, toDef, id); ok {
					carried = append(carried, optionID)
				}
			}
			if len(carried) > 0 {
				out[toID] = carried
			}
		default:
			out[toID] = value
		}
	}
	return out, nil
}

// propertyByName finds the counterpart of a property on another board: same
// name, same type. A property of the same name but a different type is not the
// same property — a date cannot hold what a select held.
func propertyByName(schema model.PropSchema, want model.PropDef) (string, model.PropDef, bool) {
	for id, def := range schema {
		if def.Type == want.Type && strings.EqualFold(def.Name, want.Name) {
			return id, def, true
		}
	}
	return "", model.PropDef{}, false
}

// optionByName translates one option id into the other board's id for the
// option of the same name.
func optionByName(from, to model.PropDef, value interface{}) (string, bool) {
	optionID, ok := value.(string)
	if !ok {
		return "", false
	}
	option, ok := from.Options[optionID]
	if !ok {
		return "", false
	}
	for id, candidate := range to.Options {
		if strings.EqualFold(candidate.Value, option.Value) {
			return id, true
		}
	}
	return "", false
}

func (a *App) GetCardByID(cardID string) (*model.Card, error) {
	cardBlock, err := a.GetBlockByID(cardID)
	if err != nil {
		return nil, err
	}

	card, err := model.Block2Card(cardBlock)
	if err != nil {
		return nil, err
	}

	return card, nil
}
