package sources

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// fakeBoard is the board these tests write to: it records what happened instead
// of doing it, which is the whole of what the pipeline needs from a board.
//
// It is guarded, because the runner writes to it from the goroutine of the
// source it is running while the test reads it.
type fakeBoard struct {
	mu       sync.Mutex
	created  []CardSpec
	boards   []string
	comments []string
	moves    []string // "cardID:property:column"
	nextID   int
	failNext error

	// property is what the board answers when asked what its columns are. The
	// Russian name is the point: a board of this app's own says «Статус», and
	// the pipeline used to assume "Status" and miss every column.
	property string
}

func (f *fakeBoard) CreateCard(_ context.Context, boardID string, spec CardSpec) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.failNext != nil {
		err := f.failNext
		f.failNext = nil
		return "", err
	}
	f.nextID++
	f.created = append(f.created, spec)
	f.boards = append(f.boards, boardID)
	return "card" + string(rune('0'+f.nextID)), nil
}

func (f *fakeBoard) AddComment(_ context.Context, cardID, text string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.comments = append(f.comments, cardID+":"+text)
	return nil
}

func (f *fakeBoard) MoveCardByOptionName(_ context.Context, cardID, property, column string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.moves = append(f.moves, cardID+":"+property+":"+column)
	return nil
}

func (f *fakeBoard) ColumnProperty(_ context.Context, _ string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.property == "" {
		return "Статус", nil
	}
	return f.property, nil
}

// The readers a test uses. Snapshots rather than the slices themselves, so a
// test cannot read one while the runner appends to it.
func (f *fakeBoard) cards() []CardSpec {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]CardSpec(nil), f.created...)
}

func (f *fakeBoard) boardIDs() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.boards...)
}

func (f *fakeBoard) commentLines() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.comments...)
}

func (f *fakeBoard) moveLines() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.moves...)
}

func (f *fakeBoard) refuseOnce(err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.failNext = err
}

func testManager(t *testing.T, entry SourceEntry) (*Manager, *fakeBoard, *Store) {
	t.Helper()
	store, err := OpenStore(filepath.Join(t.TempDir(), "sources.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	board := &fakeBoard{}
	// No config path: the registry is in memory, which is what a test wants.
	return NewManager(Config{Sources: []SourceEntry{entry}}, "", store, board, nil), board, store
}

func phoneSource() SourceEntry {
	return SourceEntry{
		Name: "телефон", BoardID: "board1", Enabled: true, Noisy: true,
		Rules: []Rule{{
			Name: "доставка",
			When: Match{Props: map[string]string{"app": "delivery"}},
			Then: ActionCard, Column: "Сегодня",
			Props: map[string]string{"Ссылка": "{{.URL}}"},
		}},
	}
}

func deliveryItem() Item {
	return Item{ExternalID: "n1", Version: "v1", Title: "Доставка завтра",
		Body: "Заказ №123", URL: "https://example.com/1",
		Props: map[string]string{"app": "delivery"}}
}

func TestAnItemBecomesACardInTheColumnItsRuleNames(t *testing.T) {
	m, board, _ := testManager(t, phoneSource())

	res, err := m.Deliver(context.Background(), "телефон", []Item{deliveryItem()})
	if err != nil {
		t.Fatal(err)
	}
	if res.Created != 1 {
		t.Fatalf("result: %+v", res)
	}
	if len(board.cards()) != 1 || board.cards()[0].Title != "Доставка завтра" {
		t.Fatalf("created: %+v", board.cards())
	}
	if board.boardIDs()[0] != "board1" {
		t.Fatalf("the card went to the wrong board: %q", board.boardIDs()[0])
	}
	props := board.cards()[0].Properties
	if props["Ссылка"] != "https://example.com/1" || props["Источник"] != "телефон" {
		t.Fatalf("properties: %+v", props)
	}
	// The move is what the automation sees: a card created straight into a
	// working column would start nothing, because the trigger fires on a change.
	// The property is the board's own answer, not a constant: this board calls
	// its columns «Статус», and a source that assumed "Status" moved nothing.
	if len(board.moveLines()) != 1 || board.moveLines()[0] != "card1:Статус:Сегодня" {
		t.Fatalf("moves: %+v", board.moveLines())
	}
}

func TestTheSameItemTwiceMakesOneCard(t *testing.T) {
	m, board, _ := testManager(t, phoneSource())
	ctx := context.Background()

	if _, err := m.Deliver(ctx, "телефон", []Item{deliveryItem()}); err != nil {
		t.Fatal(err)
	}
	res, err := m.Deliver(ctx, "телефон", []Item{deliveryItem()})
	if err != nil {
		t.Fatal(err)
	}
	if res.Skipped != 1 || res.Created != 0 {
		t.Fatalf("result: %+v", res)
	}
	if len(board.cards()) != 1 {
		t.Fatalf("a source reports its whole state every time: %+v", board.cards())
	}
}

func TestAChangedItemComesBackAsACommentOnItsOwnCard(t *testing.T) {
	m, board, _ := testManager(t, phoneSource())
	ctx := context.Background()

	if _, err := m.Deliver(ctx, "телефон", []Item{deliveryItem()}); err != nil {
		t.Fatal(err)
	}
	changed := deliveryItem()
	changed.Version = "v2"
	changed.Body = "Курьер задерживается"
	res, err := m.Deliver(ctx, "телефон", []Item{changed})
	if err != nil {
		t.Fatal(err)
	}

	if res.Commented != 1 || len(board.cards()) != 1 {
		t.Fatalf("an update must not create a second card: %+v %+v", res, board.cards())
	}
	if len(board.commentLines()) != 1 || !strings.Contains(board.commentLines()[0], "Курьер задерживается") {
		t.Fatalf("comments: %+v", board.commentLines())
	}
	if !strings.HasPrefix(board.commentLines()[0], "card1:") {
		t.Fatalf("the comment went to another card: %q", board.commentLines()[0])
	}
}

// A stream of notifications is mostly noise: there a rule is a subscription,
// and what no rule claimed is deliberately dropped.
func TestOnANoisySourceWhatMatchedNothingIsDropped(t *testing.T) {
	m, board, store := testManager(t, phoneSource())

	res, err := m.Deliver(context.Background(), "телефон",
		[]Item{{ExternalID: "n2", Title: "2 новых сообщения", Props: map[string]string{"app": "chat"}}})
	if err != nil {
		t.Fatal(err)
	}
	if res.Dropped != 1 || len(board.cards()) != 0 {
		t.Fatalf("result: %+v, created: %+v", res, board.cards())
	}
	// Dropped is still recorded: "why did nothing happen" is the only question
	// anybody asks of a source.
	events, err := store.Events("телефон", 10)
	if err != nil || len(events) != 1 || events[0].Outcome != OutcomeDropped {
		t.Fatalf("events: %+v, %v", events, err)
	}
}

// On an API source the opposite holds: losing an item silently is what makes an
// integration impossible to debug.
func TestOnAQuietSourceWhatMatchedNothingGoesToTheInbox(t *testing.T) {
	entry := phoneSource()
	entry.Noisy = false
	m, board, _ := testManager(t, entry)

	res, err := m.Deliver(context.Background(), "телефон",
		[]Item{{ExternalID: "n3", Title: "Счёт за свет"}})
	if err != nil {
		t.Fatal(err)
	}
	if res.Created != 1 || len(board.moveLines()) != 1 {
		t.Fatalf("result: %+v, moves: %+v", res, board.moveLines())
	}
	if board.moveLines()[0] != "card1:Статус:Входящие" {
		t.Fatalf("it should have gone to the inbox: %+v", board.moveLines())
	}
}

// A source may pin the property its columns live in, and then the board is not
// asked. This is the only way a board whose columns are not what it groups by
// can be fed at all.
func TestAPinnedColumnPropertyWinsOverTheBoard(t *testing.T) {
	entry := phoneSource()
	entry.Property = "Этап"
	m, board, _ := testManager(t, entry)

	if _, err := m.Deliver(context.Background(), "телефон", []Item{{
		ExternalID: "n1", Title: "Доставка", Props: map[string]string{"app": "delivery"},
	}}); err != nil {
		t.Fatal(err)
	}
	if len(board.moveLines()) != 1 || board.moveLines()[0] != "card1:Этап:Сегодня" {
		t.Fatalf("moves: %+v", board.moveLines())
	}
}

// An item lost to a failed write has to come back, so nothing is recorded until
// the card exists.
func TestAnItemIsNotForgottenWhenTheBoardRefusesIt(t *testing.T) {
	m, board, _ := testManager(t, phoneSource())
	board.refuseOnce(errors.New("доска недоступна"))
	ctx := context.Background()

	res, err := m.Deliver(ctx, "телефон", []Item{deliveryItem()})
	if err != nil {
		t.Fatal(err)
	}
	if res.Failed != 1 {
		t.Fatalf("result: %+v", res)
	}

	res, err = m.Deliver(ctx, "телефон", []Item{deliveryItem()})
	if err != nil {
		t.Fatal(err)
	}
	if res.Created != 1 || len(board.cards()) != 1 {
		t.Fatalf("the item should have come back: %+v, %+v", res, board.cards())
	}
}

func TestASourceThatIsOffAcceptsNothing(t *testing.T) {
	entry := phoneSource()
	entry.Enabled = false
	m, _, _ := testManager(t, entry)

	if _, err := m.Deliver(context.Background(), "телефон", []Item{deliveryItem()}); err == nil {
		t.Fatal("a disabled source must refuse, not silently accept")
	}
	if _, err := m.Deliver(context.Background(), "нет такого", nil); err == nil {
		t.Fatal("an unknown source must be refused")
	}
}

func TestASourceIsOfferedOnlyOnItsOwnBoard(t *testing.T) {
	m := NewManager(Config{Sources: []SourceEntry{
		{Name: "телефон", BoardID: "board1", Enabled: true},
		{Name: "почта", BoardID: "board2", Enabled: true},
		{Name: "общий", Global: true, Enabled: true},
	}}, "", nil, nil, nil)

	got := m.SourcesForBoard("board1")
	if len(got) != 2 || got[0].Name != "телефон" || got[1].Name != "общий" {
		t.Fatalf("board1 sees its own and the global one: %+v", got)
	}
	if len(m.SourcesForBoard("")) != 3 {
		t.Fatal("no board at all asks for the whole registry")
	}
}

func TestRemovingASourceForgetsWhatItBrought(t *testing.T) {
	m, board, store := testManager(t, phoneSource())
	ctx := context.Background()
	if _, err := m.Deliver(ctx, "телефон", []Item{deliveryItem()}); err != nil {
		t.Fatal(err)
	}

	if err := m.RemoveSource("телефон"); err != nil {
		t.Fatal(err)
	}
	if events, err := store.Events("телефон", 10); err != nil || len(events) != 0 {
		t.Fatalf("events survived removal: %+v, %v", events, err)
	}

	// A source created again under the same name must start clean, not ignore
	// everything it brings as already seen.
	if _, err := m.AddSource(phoneSource()); err != nil {
		t.Fatal(err)
	}
	res, err := m.Deliver(ctx, "телефон", []Item{deliveryItem()})
	if err != nil {
		t.Fatal(err)
	}
	if res.Created != 1 || len(board.cards()) != 2 {
		t.Fatalf("result: %+v, created: %+v", res, board.cards())
	}
}
