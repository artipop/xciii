package boardadapter

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/mattermost/focalboard/server/model"

	"github.com/artipop/xciii/internal/acp"
)

// Where a card stands on its route lives on the card, under one key of its own
// in the block's fields.
//
// A field and not a table, and not a block of our own either. A card block is
// the only place that survives the trip a board makes between machines: an
// export carries the board record and its blocks and nothing else, and an
// import gives every board and block a new id — so a table keyed by card id
// arrives pointing at cards that no longer exist. A block of our own would
// survive that, but the page reads every block that is not a board, view or
// comment as the card's content (webapp/src/store/contents.ts), and the board
// server has no id prefix for a type it does not know.
//
// The key is ours and the page never looks at it. Writing it is a field patch,
// which merges (model.BlockPatch.Patch), so it cannot disturb the properties a
// person filled in or the card's contentOrder.
const cardFieldFlow = "xciiiFlow"

var _ acp.BoardCardState = (*Writer)(nil)

// CardFlow reads back where the card stands. A card with nothing under the key
// — every card that is not on a route, which is most of them — is not an error.
func (w *Writer) CardFlow(_ context.Context, cardID string) (acp.FlowState, bool, error) {
	card, err := w.cardBlock(cardID)
	if err != nil {
		return acp.FlowState{}, false, err
	}
	raw, ok := card.Fields[cardFieldFlow]
	if !ok || raw == nil {
		return acp.FlowState{}, false, nil
	}
	st, err := flowStateFromField(raw)
	if err != nil {
		return acp.FlowState{}, false, fmt.Errorf("card %s: %w", cardID, err)
	}
	// The card knows which board it is on better than whatever wrote the field
	// — after an import it is the only one that does.
	st.CardID, st.BoardID = card.ID, card.BoardID
	return st, true, nil
}

// SetCardFlow records the position on the card. It never notifies: this is the
// integration's own bookkeeping, and a card that announced it had changed would
// set off the very automation that just wrote it.
func (w *Writer) SetCardFlow(_ context.Context, cardID string, st acp.FlowState) error {
	encoded, err := json.Marshal(st)
	if err != nil {
		return err
	}
	var field map[string]any
	if err := json.Unmarshal(encoded, &field); err != nil {
		return err
	}
	return w.patchCardFields(cardID, &model.BlockPatch{UpdatedFields: map[string]any{cardFieldFlow: field}})
}

// ClearCardFlow is what a card dragged off its route leaves behind: nothing.
func (w *Writer) ClearCardFlow(_ context.Context, cardID string) error {
	return w.patchCardFields(cardID, &model.BlockPatch{DeletedFields: []string{cardFieldFlow}})
}

// BoardCardFlows is every parked card of one board. It reads the card blocks
// for the same reason CardsForBoard does: the board's own Card view refuses a
// card whose fields it does not recognise, and ours is exactly such a field.
func (w *Writer) BoardCardFlows(_ context.Context, boardID string) ([]acp.FlowState, error) {
	blocks, err := w.app.GetBlocks(boardID, "", string(model.TypeCard))
	if err != nil {
		return nil, fmt.Errorf("get cards of board %s: %w", boardID, err)
	}
	out := make([]acp.FlowState, 0, 8)
	for _, block := range blocks {
		if block == nil || block.DeleteAt != 0 {
			continue
		}
		raw, ok := block.Fields[cardFieldFlow]
		if !ok || raw == nil {
			continue
		}
		st, err := flowStateFromField(raw)
		if err != nil {
			// One unreadable card must not hide every other parked card on the
			// board — the answer here is a poll list, and a short one is worse
			// than a wrong entry.
			continue
		}
		st.CardID, st.BoardID = block.ID, block.BoardID
		out = append(out, st)
	}
	return out, nil
}

// patchCardFields writes one of our own keys on a card, silently.
func (w *Writer) patchCardFields(cardID string, patch *model.BlockPatch) error {
	if _, err := w.cardBlock(cardID); err != nil {
		return err
	}
	return retryOnceInTheSameMillisecond(func() error {
		_, err := w.app.PatchBlockAndNotify(cardID, patch, model.SingleUser, true)
		return err
	})
}

// retryOnceInTheSameMillisecond runs a card write again a millisecond later.
//
// The block history's primary key is (id, insert_at) in whole milliseconds, so
// two writes to one card inside the same millisecond collide on it. Two writes
// that fast are always ours rather than a person's: a stage moves the card and
// then records where it now stands. Without the second attempt a route stops
// advancing for no reason anybody could see.
//
// Only for a write that can be repeated with the same result, which a field
// patch is. Carrying a card to another board is not one of them — see
// MoveCardToBoard, which has to ask the card where it ended up instead. It is
// deliberately not a loop: a second collision means the cause is not the clock.
func retryOnceInTheSameMillisecond(write func() error) error {
	if err := write(); err == nil {
		return nil
	}
	time.Sleep(2 * time.Millisecond)
	return write()
}

func flowStateFromField(raw any) (acp.FlowState, error) {
	var st acp.FlowState
	return st, reinterpretField(raw, &st)
}

// reinterpretField reads one of our own keys back into the real type. It
// arrives as whatever the block store decoded it into — and, on some paths, as
// the JSON text of itself — so it goes through JSON rather than being picked
// apart by hand. The same reasoning, and the same two cases, as acp.reinterpret
// for a board's properties.
func reinterpretField(raw any, into any) error {
	if text, ok := raw.(string); ok {
		if text == "" {
			return nil
		}
		return json.Unmarshal([]byte(text), into)
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return err
	}
	return json.Unmarshal(encoded, into)
}
