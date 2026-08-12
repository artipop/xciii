package boardadapter

import (
	"context"
	"fmt"
	"strings"

	"github.com/artipop/xciii/server/app"
	"github.com/artipop/xciii/server/model"
	"github.com/artipop/xciii/server/utils"

	"github.com/artipop/xciii/internal/sources"
)

// The board as internal/sources writes to it.
//
// It is a type of its own rather than more methods on Writer for one blunt
// reason: both halves of this app create cards from outside the board, and they
// mean different things by it. An agent creating a card from a planning
// conversation names a column and a property (acp.NewCard); a source filing what
// arrived names none — it is authored by the source, lands in «Входящие», and
// carries the body a service wrote. Two callers, two shapes, and Go allows one
// method of a name — so the source's half sits here, over the same Writer, and
// everything else it needs (comments, moves, the inbox, the column property) is
// promoted from it unchanged.
type SourceWriter struct {
	*Writer
}

var _ sources.BoardWriter = (*SourceWriter)(nil)

// NewSourceWriter builds the writer the sources pipeline is given.
func NewSourceWriter(a *app.App) *SourceWriter { return &SourceWriter{NewWriter(a)} }

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
func (w *SourceWriter) CreateCard(ctx context.Context, boardID string, spec CardSpec) (string, error) {
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

	// The link is the pipeline's own doing rather than a rule's, so it is not
	// looked up by name among the properties above: the board's url property is
	// found by type and made if the board has none. A rule that names a
	// property of its own for the link still wins — it was written against this
	// board by somebody looking at it.
	if url := strings.TrimSpace(spec.URL); url != "" {
		if id, err := w.ensureLinkProperty(boardID); err == nil {
			if _, taken := properties[id]; !taken {
				properties[id] = url
			}
		}
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
	// Which item of which source this card came from goes on the card, so the
	// board itself answers "have we brought this one already" — this machine's
	// table cannot, on a board that came from another machine.
	if err := w.setCardSource(created.ID, spec.Source, spec.Item); err != nil {
		w.logSourceOrigin(created.ID, err)
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

// Where a card came from lives on the card, under one key of its own — the same
// bargain as xciiiFlow (cardstate.go): a card block is what an export carries and
// an import renumbers, and a table keyed by card id is neither.
//
// It holds the source's name as well as the item's id, because the question
// asked of it is "did *this* source bring this id" and two sources may well use
// the same id space. The card's author answers the same question, but only for
// a source that was given a board account, and losing the account is allowed to
// lose the author — not the dedup.
// The prefix is the app's, not the agent integration's: sources are not part of
// it and must keep working with it switched off (docs/sources.md §18), so a
// card brought by a phone onto a household board has no business carrying an
// `acp` key. The board marker `xciiiTemplate` (templates.go) is the same case
// and the same prefix.
const cardFieldSource = "xciiiSource"

var _ sources.BoardItems = (*SourceWriter)(nil)

// cardSource is the field's shape. sources.ItemRef is the half the pipeline
// knows; the source's name is added here because the field has to stand on its
// own on the card.
type cardSource struct {
	Source     string `json:"source,omitempty"`
	ExternalID string `json:"externalId,omitempty"`
	Version    string `json:"version,omitempty"`
}

// setCardSource records the origin. A card with no origin — one a person typed
// — is left alone rather than given an empty key.
func (w *Writer) setCardSource(cardID, source string, ref sources.ItemRef) error {
	if strings.TrimSpace(source) == "" || strings.TrimSpace(ref.ExternalID) == "" {
		return nil
	}
	field := map[string]any{
		"source":     source,
		"externalId": ref.ExternalID,
		"version":    ref.Version,
	}
	return w.patchCardFields(cardID, &model.BlockPatch{UpdatedFields: map[string]any{cardFieldSource: field}})
}

// CardBySourceItem asks the board whether this source has already brought this
// item, and onto which card.
//
// It reads the board's cards rather than querying for the field: the board
// server has no index over what is inside a block's fields, and the alternative
// — a query shaped per database dialect over a JSON column — would be a patch
// to the fork for something a source poll does once per unknown item.
func (w *SourceWriter) CardBySourceItem(_ context.Context, boardID, source, externalID string) (string, string, bool, error) {
	blocks, err := w.app.GetBlocks(boardID, "", string(model.TypeCard))
	if err != nil {
		return "", "", false, fmt.Errorf("get cards of board %s: %w", boardID, err)
	}
	for _, block := range blocks {
		if block == nil || block.DeleteAt != 0 {
			continue
		}
		origin, ok := cardSourceOf(block)
		if !ok {
			continue
		}
		if !strings.EqualFold(origin.Source, source) || origin.ExternalID != externalID {
			continue
		}
		return block.ID, origin.Version, true, nil
	}
	return "", "", false, nil
}

func cardSourceOf(block *model.Block) (cardSource, bool) {
	raw, ok := block.Fields[cardFieldSource]
	if !ok || raw == nil {
		return cardSource{}, false
	}
	var origin cardSource
	if err := reinterpretField(raw, &origin); err != nil {
		return cardSource{}, false
	}
	return origin, origin.ExternalID != ""
}

// logSourceOrigin reports a card that was created but could not be stamped with
// where it came from. Deliberately not an error to the caller: the card exists,
// and reporting failure would have the pipeline create it again on the next
// poll. What is lost is only the board being able to tell another machine, and
// this machine's own table still remembers the item.
func (w *Writer) logSourceOrigin(cardID string, err error) {
	w.log.Warn("boardadapter: cannot record where the card came from", "card", cardID, "err", err)
}
