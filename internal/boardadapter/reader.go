// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package boardadapter

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/mattermost/focalboard/server/model"
)

// The board as a phone reads it.
//
// The page at /m has no board API of its own — it is served the bindings and
// the event socket and nothing else, which is what lets the same page work
// through the tailnet door — so what it needs from the board comes through
// here. It is a small, flat surface on purpose: a phone shows a list of cards
// and moves one, and everything else about a board belongs on a screen with
// room for it.
//
// Everything is named rather than identified, for the reason the agent's tools
// are: a column is what a person typed, and an id is what the board's own REST
// API would have made the page learn.

// BoardSummary is a board as a list shows it, with the columns a card can be
// moved into. The columns come with it because the two questions are always
// asked together — which board, then which column of it — and a phone on a
// slow connection should ask once.
type BoardSummary struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Icon  string `json:"icon,omitempty"`

	// Property is what this board calls the property its columns live in, and
	// Columns are the options of it, in the board's own order.
	Property string   `json:"property,omitempty"`
	Columns  []Column `json:"columns,omitempty"`
}

// Column is one column of a board: the name a person reads and the colour the
// board draws it in. The colour travels so that a phone can draw a column the
// way the board does rather than as plain text — the same chip, in the same
// colour, is what makes a list of columns recognisable as columns.
type Column struct {
	Value string `json:"value"`
	Color string `json:"color,omitempty"`
}

// CardSummary is a card as a list shows it: enough to recognise it and to
// decide where it belongs.
type CardSummary struct {
	ID      string `json:"id"`
	BoardID string `json:"boardId"`
	Title   string `json:"title"`
	Icon    string `json:"icon,omitempty"`
	Column  string `json:"column,omitempty"`

	// Author is who made the card — for what arrived, the source that brought
	// it. It is the board's own answer, so a phone says where a thing came from
	// without a property of ours beside it.
	Author string `json:"author,omitempty"`

	// Properties are the card's own, by the names a person reads. A card an
	// outside source left carries «Источник» and «Ссылка» among them, which is
	// how the inbox says where a thing came from without a second query.
	Properties map[string]string `json:"properties,omitempty"`

	UpdateAt int64 `json:"updateAt,omitempty"`
}

// Boards lists the boards of the single user this app runs as, newest first —
// the same order and the same set the sidebar shows.
func (w *Writer) Boards(ctx context.Context) ([]BoardSummary, error) {
	boards, err := w.app.GetBoardsForUserAndTeam(model.SingleUser, model.GlobalTeamID, false)
	if err != nil {
		return nil, fmt.Errorf("list boards: %w", err)
	}
	out := make([]BoardSummary, 0, len(boards))
	for _, board := range boards {
		if board.IsTemplate {
			continue
		}
		summary := BoardSummary{ID: board.ID, Title: board.Title, Icon: board.Icon}
		if property, columns, err := w.columnsOf(board); err == nil {
			summary.Property = property
			summary.Columns = columns
		}
		out = append(out, summary)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Title < out[j].Title })
	return out, nil
}

// columnsOf is the board's column property and its options, in the order the
// board keeps them — which is the order a person sees on the kanban.
func (w *Writer) columnsOf(board *model.Board) (string, []Column, error) {
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		return "", nil, err
	}
	views, err := w.app.GetBlocks(board.ID, board.ID, model.TypeView)
	if err != nil {
		return "", nil, err
	}
	name, ok := columnPropertyName(board, schema, views)
	if !ok {
		return "", nil, fmt.Errorf("на доске %s нет свойства-колонок", board.ID)
	}
	prop, ok := findCardProperty(board.CardProperties, name)
	if !ok {
		return name, nil, nil
	}
	options, _ := prop["options"].([]any)
	columns := make([]Column, 0, len(options))
	for _, option := range options {
		fields, ok := option.(map[string]any)
		if !ok {
			continue
		}
		value, ok := fields["value"].(string)
		if !ok {
			continue
		}
		color, _ := fields["color"].(string)
		columns = append(columns, Column{Value: value, Color: color})
	}
	return name, columns, nil
}

// BoardCards lists a board's cards with the column each one stands in.
//
// The card's text is deliberately not among them: it lives in blocks of its
// own, one query per card, and a list that costs a query per row is a list
// that stops working on the board where it matters most. A title and where the
// card came from is what a phone decides on.
func (w *Writer) BoardCards(ctx context.Context, boardID string) ([]CardSummary, error) {
	board, err := w.app.GetBoard(boardID)
	if err != nil {
		return nil, fmt.Errorf("get board %s: %w", boardID, err)
	}
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		return nil, err
	}
	views, err := w.app.GetBlocks(boardID, boardID, model.TypeView)
	if err != nil {
		return nil, fmt.Errorf("get views of board %s: %w", boardID, err)
	}
	property, _ := columnPropertyName(board, schema, views)
	authors := w.boardAuthors(boardID)
	blocks, err := w.app.GetBlocks(boardID, "", model.TypeCard)
	if err != nil {
		return nil, fmt.Errorf("list cards of board %s: %w", boardID, err)
	}

	out := make([]CardSummary, 0, len(blocks))
	for _, block := range blocks {
		if isTemplate, _ := block.Fields["isTemplate"].(bool); isTemplate {
			continue
		}
		icon, _ := block.Fields["icon"].(string)
		card := CardSummary{
			ID:         block.ID,
			BoardID:    boardID,
			Title:      block.Title,
			Icon:       icon,
			Properties: displayProperties(schema, block),
			Author:     authors[block.CreatedBy],
			UpdateAt:   block.UpdateAt,
		}
		card.Column = card.Properties[property]
		out = append(out, card)
	}
	// Newest first: a list on a phone is read from the top, and what changed
	// last is what a person is looking for.
	sort.SliceStable(out, func(i, j int) bool { return out[i].UpdateAt > out[j].UpdateAt })
	return out, nil
}

// boardAuthors maps the board's members to the names a person reads. Read once
// per board rather than per card: a list of a hundred cards is a handful of
// authors, and asking for each of them would be a query a row.
func (w *Writer) boardAuthors(boardID string) map[string]string {
	members, err := w.app.GetMembersForBoard(boardID)
	if err != nil {
		return nil
	}
	out := make(map[string]string, len(members))
	for _, member := range members {
		user, err := w.app.GetUser(member.UserID)
		if err != nil || user == nil {
			continue
		}
		out[user.ID] = user.Username
	}
	return out
}

// displayProperties turns a card's stored properties into the names and values a
// person reads. A select becomes the option's own text; anything else is taken
// as it is, and what the board has no definition for is left out — it is a
// leftover of a property somebody deleted.
func displayProperties(schema model.PropSchema, block *model.Block) map[string]string {
	stored, ok := block.Fields["properties"].(map[string]any)
	if !ok || len(stored) == 0 {
		return nil
	}
	out := make(map[string]string, len(stored))
	for id, value := range stored {
		def, ok := schema[id]
		if !ok {
			continue
		}
		if text := propertyText(def, value); text != "" {
			out[def.Name] = text
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func propertyText(def model.PropDef, value any) string {
	switch typed := value.(type) {
	case string:
		if option, ok := def.Options[typed]; ok {
			return option.Value
		}
		return typed
	case []any:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			id, ok := item.(string)
			if !ok {
				continue
			}
			if option, ok := def.Options[id]; ok {
				parts = append(parts, option.Value)
			} else {
				parts = append(parts, id)
			}
		}
		return strings.Join(parts, ", ")
	default:
		return ""
	}
}

// MoveCardToBoard carries a card to another board and, if a column is named,
// puts it there.
//
// The move into the column is the one write here that lets the board notify,
// and it has to: a person moved this card, so a column that runs an agent has
// to start one, exactly as it would if the card had been dragged. Everything
// else in this file is the integration's own bookkeeping and must stay quiet.
func (w *Writer) MoveCardToBoard(ctx context.Context, cardID, toBoardID, column string) error {
	if _, err := w.app.MoveCardToBoard(cardID, toBoardID, model.SingleUser); err != nil {
		return fmt.Errorf("перенос карточки %s на доску %s: %w", cardID, toBoardID, err)
	}
	if strings.TrimSpace(column) == "" {
		return nil
	}
	board, err := w.app.GetBoard(toBoardID)
	if err != nil {
		return fmt.Errorf("get board %s: %w", toBoardID, err)
	}
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		return err
	}
	views, err := w.app.GetBlocks(toBoardID, toBoardID, model.TypeView)
	if err != nil {
		return fmt.Errorf("get views of board %s: %w", toBoardID, err)
	}
	property, ok := columnPropertyName(board, schema, views)
	if !ok {
		return fmt.Errorf("на доске %s нет свойства-колонок", toBoardID)
	}
	propID, optionID, ok := findSelectOption(schema, property, column)
	if !ok {
		return fmt.Errorf("на доске %s нет колонки %q", toBoardID, column)
	}
	patch := &model.CardPatch{UpdatedProperties: map[string]any{propID: optionID}}
	_, err = w.app.PatchCard(patch, cardID, model.SingleUser, false)
	return err
}
