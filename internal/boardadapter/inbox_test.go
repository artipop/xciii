package boardadapter

import (
	"testing"
	"time"

	"github.com/artipop/xciii/server/app"
	"github.com/artipop/xciii/server/mlog"
	"github.com/artipop/xciii/server/model"
	"github.com/artipop/xciii/server/utils"
)

// The inbox is two columns and a view, and none of the three can be checked
// without a board: the option ids are made on the way in, the view is a block,
// and where a column ends up on the kanban is a list on another block. So this
// runs the real board server and looks at what a person would see.

// boardWithAKanban is the board a source arrives on: a column property and one
// kanban grouped by it, which is what every board of ours has.
func boardWithAKanban(t *testing.T, a *app.App) *model.Board {
	t.Helper()
	board, err := a.CreateBoard(&model.Board{
		TeamID: model.GlobalTeamID,
		Type:   model.BoardTypeOpen,
		Title:  "Доска",
		CardProperties: []map[string]any{
			{
				"id": "prop-status", "name": "Статус", "type": "select",
				"options": []any{
					map[string]any{"id": "opt-todo", "value": "Не начата", "color": ""},
					map[string]any{"id": "opt-done", "value": "Готово", "color": ""},
				},
			},
		},
	}, model.SingleUser, true)
	if err != nil {
		t.Fatal(err)
	}
	now := utils.GetMillis()
	view := &model.Block{
		ID:       utils.NewID(utils.IDTypeView),
		BoardID:  board.ID,
		ParentID: board.ID,
		Type:     model.TypeView,
		Title:    "Дела",
		Fields: map[string]any{
			"viewType":         "board",
			"groupById":        "prop-status",
			"visibleOptionIds": []any{"opt-todo", "opt-done"},
			"hiddenOptionIds":  []any{},
		},
		CreatedBy: model.SingleUser,
		CreateAt:  now,
		UpdateAt:  now,
	}
	if _, err := a.InsertBlocksAndNotify([]*model.Block{view}, model.SingleUser, false); err != nil {
		t.Fatal(err)
	}
	// The block history is keyed by (id, insert_at) in milliseconds, so a view
	// written and patched inside the same millisecond collides with its own
	// history row. Only a test builds a board that fast.
	time.Sleep(2 * time.Millisecond)
	return board
}

func viewsByTitle(t *testing.T, w *Writer, boardID string) map[string]*model.Block {
	t.Helper()
	views, err := w.boardViews(boardID)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]*model.Block{}
	for _, view := range views {
		out[view.Title] = view
	}
	return out
}

func optionID(t *testing.T, a *app.App, boardID, name string) string {
	t.Helper()
	board, err := a.GetBoard(boardID)
	if err != nil {
		t.Fatal(err)
	}
	schema, err := model.ParsePropertySchema(board)
	if err != nil {
		t.Fatal(err)
	}
	_, id, ok := findSelectOption(schema, "Статус", name)
	if !ok {
		t.Fatalf("колонки «%s» на доске нет", name)
	}
	return id
}

func ids(t *testing.T, raw any) []string {
	t.Helper()
	list, _ := raw.([]any)
	out := make([]string, 0, len(list))
	for _, item := range list {
		id, _ := item.(string)
		out = append(out, id)
	}
	return out
}

// A board that has just got its first source has an inbox: what arrives stands
// in one column and is read in a view of its own, and what the person types
// there stands in another — so that «Создать» on the inbox does not look like
// something that arrived and nobody has read.
func TestTheInboxIsTwoColumnsAndAViewShowingBoth(t *testing.T) {
	a := newTestApp(t)
	board := boardWithAKanban(t, a)
	w := NewWriter(a)

	inboxID, err := w.EnsureInbox(t.Context(), board.ID, "Статус", "Входящие")
	if err != nil {
		t.Fatal(err)
	}
	mineID := optionID(t, a, board.ID, MineColumnTitle)

	inbox, ok := viewsByTitle(t, w, board.ID)[InboxViewTitle]
	if !ok {
		t.Fatal("вида «Входящие» нет")
	}
	filter, _ := inbox.Fields["filter"].(map[string]any)
	clauses, _ := filter["filters"].([]any)
	if len(clauses) != 1 {
		t.Fatalf("фильтр вида: %+v", filter)
	}
	clause, _ := clauses[0].(map[string]any)
	values := ids(t, clause["values"])
	// «Мои задачи» first: the first value of the clause is what a card made in
	// this view becomes, and that is the whole mechanism behind the button.
	if len(values) != 2 || values[0] != mineID || values[1] != inboxID {
		t.Fatalf("фильтр пропускает %v, ожидалось [%s %s]", values, mineID, inboxID)
	}
}

// Both inbox columns are taken off the board's own kanban: what arrived and
// what the person typed are read on the inbox view, and the board of work
// stays the board of work. «Мои задачи» stood at the kanban's front for one
// version, and that was not what was asked for.
func TestBothInboxColumnsAreHiddenFromTheKanban(t *testing.T) {
	a := newTestApp(t)
	board := boardWithAKanban(t, a)
	w := NewWriter(a)

	inboxID, err := w.EnsureInbox(t.Context(), board.ID, "Статус", "Входящие")
	if err != nil {
		t.Fatal(err)
	}
	mineID := optionID(t, a, board.ID, MineColumnTitle)

	kanban := viewsByTitle(t, w, board.ID)["Дела"]
	visible := ids(t, kanban.Fields["visibleOptionIds"])
	hidden := ids(t, kanban.Fields["hiddenOptionIds"])
	if len(visible) != 2 {
		t.Fatalf("колонки канбана: %v", visible)
	}
	if len(hidden) != 2 || hidden[0] != inboxID || hidden[1] != mineID {
		t.Fatalf("скрытые колонки: %v", hidden)
	}

	// The second source on the same board runs all of this again, and finds
	// everything already answered: nothing is added twice and nothing moves.
	if _, err := w.EnsureInbox(t.Context(), board.ID, "Статус", "Входящие"); err != nil {
		t.Fatal(err)
	}
	after := viewsByTitle(t, w, board.ID)
	if len(after) != 2 {
		t.Fatalf("видов стало %d", len(after))
	}
	if got := ids(t, after["Дела"].Fields["hiddenOptionIds"]); len(got) != 2 {
		t.Fatalf("скрытые колонки после второго источника: %v", got)
	}
}

// A board the front-column version already arranged is put right on launch:
// «Мои задачи» leaves the kanban's front and joins «Входящие» among the hidden
// columns. The sweep runs from ImportTemplates, so having the templates is
// having the fix.
func TestALegacyFrontColumnIsHiddenOnLaunch(t *testing.T) {
	a := newTestApp(t)
	logger, _ := mlog.NewLogger()
	if err := ImportTemplates(a, logger); err != nil {
		t.Fatal(err)
	}
	template := installedTemplates(t, a)["home-chores"]
	bab, _, err := a.DuplicateBoard(template.ID, model.SingleUser, model.GlobalTeamID, false)
	if err != nil {
		t.Fatal(err)
	}
	board := bab.Boards[0]
	mineID := optionID(t, a, board.ID, MineColumnTitle)
	inboxID := optionID(t, a, board.ID, "Входящие")

	// The arrangement version 15 left behind: own tasks first, arrivals hidden.
	views, err := a.GetBlocks(board.ID, "", model.TypeView)
	if err != nil {
		t.Fatal(err)
	}
	for _, view := range views {
		if view.Title != "Дела" {
			continue
		}
		visible, _ := view.Fields["visibleOptionIds"].([]any)
		patch := &model.BlockPatch{UpdatedFields: map[string]any{
			"visibleOptionIds": append([]any{mineID}, visible...),
			"hiddenOptionIds":  []any{inboxID},
		}}
		if _, err := a.PatchBlock(view.ID, patch, model.SystemUserID); err != nil {
			t.Fatal(err)
		}
	}

	if err := ImportTemplates(a, logger); err != nil {
		t.Fatal(err)
	}

	w := NewWriter(a)
	kanban := viewsByTitle(t, w, board.ID)["Дела"]
	if visible := ids(t, kanban.Fields["visibleOptionIds"]); containsString(visible, mineID) {
		t.Fatalf("«Мои задачи» осталась на канбане: %v", visible)
	}
	if hidden := ids(t, kanban.Fields["hiddenOptionIds"]); !containsString(hidden, mineID) || !containsString(hidden, inboxID) {
		t.Fatalf("скрытые колонки: %v", hidden)
	}
}

func containsString(list []string, want string) bool {
	for _, item := range list {
		if item == want {
			return true
		}
	}
	return false
}

// An install that predates «Мои задачи» has an inbox filtered to what arrived,
// and the person's own card would have vanished the moment it was made. The
// view is brought up to date rather than replaced: it is in the sidebar, and a
// second «Входящие» beside it is worse than either.
func TestAnOlderInboxLearnsAboutOwnTasks(t *testing.T) {
	a := newTestApp(t)
	board := boardWithAKanban(t, a)
	w := NewWriter(a)

	inboxID, err := w.EnsureColumn(t.Context(), board.ID, "Статус", "Входящие")
	if err != nil {
		t.Fatal(err)
	}
	now := utils.GetMillis()
	old := &model.Block{
		ID:       utils.NewID(utils.IDTypeView),
		BoardID:  board.ID,
		ParentID: board.ID,
		Type:     model.TypeView,
		Title:    InboxViewTitle,
		Fields: map[string]any{
			"viewType": "board",
			"filter": map[string]any{
				"operation": "and",
				"filters": []any{map[string]any{
					"propertyId": "prop-status",
					"condition":  "includes",
					"values":     []any{inboxID},
				}},
			},
		},
		CreatedBy: model.SingleUser,
		CreateAt:  now,
		UpdateAt:  now,
	}
	if _, err := a.InsertBlocksAndNotify([]*model.Block{old}, model.SingleUser, false); err != nil {
		t.Fatal(err)
	}
	time.Sleep(2 * time.Millisecond)

	if _, err := w.EnsureInbox(t.Context(), board.ID, "Статус", "Входящие"); err != nil {
		t.Fatal(err)
	}
	mineID := optionID(t, a, board.ID, MineColumnTitle)

	views := viewsByTitle(t, w, board.ID)
	if len(views) != 2 {
		t.Fatalf("видов стало %d, ожидался тот же вид", len(views))
	}
	filter, _ := views[InboxViewTitle].Fields["filter"].(map[string]any)
	clauses, _ := filter["filters"].([]any)
	clause, _ := clauses[0].(map[string]any)
	if values := ids(t, clause["values"]); len(values) != 2 || values[0] != mineID {
		t.Fatalf("фильтр старого вида: %v", values)
	}
}
