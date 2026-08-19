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
	ensured  []string // "boardID:property:column"
	nextID   int
	failNext error

	// asked counts how often the board was asked what its columns are called:
	// once per batch is the whole point of the delivery scope.
	asked int
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
	f.asked++
	if f.property == "" {
		return "Статус", nil
	}
	return f.property, nil
}

func (f *fakeBoard) EnsureInbox(_ context.Context, boardID, property, column string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ensured = append(f.ensured, boardID+":"+property+":"+column)
	return "option-" + column, nil
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

func (f *fakeBoard) propertyAsks() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.asked
}

func (f *fakeBoard) ensuredLines() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.ensured...)
}

func (f *fakeBoard) refuseOnce(err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.failNext = err
}

func testManager(t *testing.T, entry SourceEntry) (*Manager, *fakeBoard, *Store) {
	t.Helper()
	store, err := newTestStore(t, filepath.Join(t.TempDir(), "sources.db"))
	if err != nil {
		t.Fatal(err)
	}
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
	// The way back to the original is a property; where it came from is not —
	// the card is authored by the source, which is the board's own answer and
	// the one the inbox groups by.
	props := board.cards()[0].Properties
	if props["Ссылка"] != "https://example.com/1" {
		t.Fatalf("properties: %+v", props)
	}
	if board.cards()[0].Source != "телефон" {
		t.Fatalf("the card should be authored by its source: %+v", board.cards()[0])
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
	// The inbox is made first — the column and the view of it. A board from
	// before the inbox existed has neither, and the move would have had
	// nowhere to land.
	if len(board.ensuredLines()) != 1 || board.ensuredLines()[0] != "board1:Статус:Входящие" {
		t.Fatalf("the inbox should have been ensured: %+v", board.ensuredLines())
	}
}

// A rule decides whether the item was claimed, not whether it is shown. One
// that names no column used to leave the card with its column property unset —
// standing outside every column of the board, where only somebody who thought
// to look for it would ever find it.
func TestARuleThatNamesNoColumnStillFilesTheCard(t *testing.T) {
	entry := phoneSource()
	entry.Rules[0].Column = ""
	m, board, _ := testManager(t, entry)

	res, err := m.Deliver(context.Background(), "телефон", []Item{{
		ExternalID: "n1", Title: "Доставка", Props: map[string]string{"app": "delivery"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if res.Created != 1 {
		t.Fatalf("result: %+v", res)
	}
	if len(board.moveLines()) != 1 || board.moveLines()[0] != "card1:Статус:Входящие" {
		t.Fatalf("it should have gone to the inbox: %+v", board.moveLines())
	}
	// The rule did claim it, so the event says the rule created a card. Where
	// it stands and who asked for it are separate answers.
	events, err := m.Events("телефон", 10)
	if err != nil || len(events) != 1 || events[0].Outcome != OutcomeCreated {
		t.Fatalf("events: %+v, %v", events, err)
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

// A batch is one poll, and a board does not rename its columns halfway through
// it. Asking once is not only cheaper — it is four board reads per card that a
// source bringing fifty cards no longer does.
func TestABatchAsksTheBoardOnce(t *testing.T) {
	entry := phoneSource()
	entry.Noisy = false
	entry.Rules = nil
	m, board, _ := testManager(t, entry)

	res, err := m.Deliver(context.Background(), "телефон", []Item{
		{ExternalID: "n1", Title: "Первое"},
		{ExternalID: "n2", Title: "Второе"},
		{ExternalID: "n3", Title: "Третье"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Created != 3 {
		t.Fatalf("result: %+v", res)
	}
	// Three cards, three moves — and one look at what the board calls its
	// columns and one making sure of the inbox.
	if len(board.moveLines()) != 3 {
		t.Fatalf("moves: %+v", board.moveLines())
	}
	if got := board.ensuredLines(); len(got) != 1 {
		t.Fatalf("инбокс должен заводиться раз на партию: %+v", got)
	}
	if got := board.propertyAsks(); got != 1 {
		t.Fatalf("свойство колонок должно спрашиваться раз на партию, спросили %d раз", got)
	}
}

// A rule that names an agent and no properties of its own: RenderProps answers
// nil for such a rule, and writing the agent into a nil map is a panic rather
// than a lost field.
func TestARuleMayNameAnAgentAndNoPropertiesAtAll(t *testing.T) {
	entry := SourceEntry{
		Name: "телефон", BoardID: "board1", Enabled: true, Noisy: true,
		Rules: []Rule{{Name: "всё", Then: ActionCard, Column: "Сегодня", Agent: "claude"}},
	}
	m, board, _ := testManager(t, entry)

	if _, err := m.Deliver(context.Background(), "телефон", []Item{deliveryItem()}); err != nil {
		t.Fatal(err)
	}
	if len(board.cards()) != 1 {
		t.Fatalf("created: %+v", board.cards())
	}
	if board.cards()[0].Properties["Agent"] != "claude" {
		t.Fatalf("properties: %+v", board.cards()[0].Properties)
	}
}

// The link travels as the card's own field rather than as a property named in
// this package: which property holds it is the board's answer, and a name here
// would have obliged every board to speak one language.
func TestTheLinkTravelsBesideTheCardRatherThanAsANamedProperty(t *testing.T) {
	m, board, _ := testManager(t, phoneSource())

	if _, err := m.Deliver(context.Background(), "телефон", []Item{deliveryItem()}); err != nil {
		t.Fatal(err)
	}
	if board.cards()[0].URL != "https://example.com/1" {
		t.Fatalf("card: %+v", board.cards()[0])
	}
}

// fakeBoardItems is the board asked what a source has already brought it.
type fakeBoardItems struct {
	cards map[string]string // source + "\x00" + externalID → card id
	// version is what the board says the item was at when it was brought.
	version string
	fail    error
}

func (f *fakeBoardItems) CardBySourceItem(_ context.Context, _, source, externalID string) (string, string, bool, error) {
	if f.fail != nil {
		return "", "", false, f.fail
	}
	cardID, ok := f.cards[source+"\x00"+externalID]
	return cardID, f.version, ok, nil
}

// A board carried here from another machine already holds the cards a source
// made there, and this machine has never heard of the items. Asking the board
// is what stops the next poll turning every one of them into a second card.
func TestAnItemTheBoardAlreadyHoldsIsNotBroughtAgain(t *testing.T) {
	m, board, store := testManager(t, phoneSource())
	m.SetBoardItems(&fakeBoardItems{
		cards:   map[string]string{"телефон\x00n1": "cardFromElsewhere"},
		version: "v1",
	})

	res, err := m.Deliver(context.Background(), "телефон", []Item{deliveryItem()})
	if err != nil {
		t.Fatal(err)
	}
	if res.Created != 0 || res.Skipped != 1 {
		t.Fatalf("result: %+v", res)
	}
	if len(board.cards()) != 0 {
		t.Fatalf("a second card was made for an item the board already holds: %+v", board.cards())
	}

	// The board is asked once: the answer is written into this machine's own
	// table, so the next poll is the fast path again.
	if _, cardID, err := store.StateOf("телефон", "n1", "v1"); err != nil || cardID != "cardFromElsewhere" {
		t.Errorf("the board's answer was not remembered: %q, %v", cardID, err)
	}
}

// The same item at a newer version is not a new card either — it is a comment
// on the card the board already has.
func TestAChangedItemTheBoardHoldsIsCommentedOn(t *testing.T) {
	m, board, _ := testManager(t, phoneSource())
	m.SetBoardItems(&fakeBoardItems{
		cards:   map[string]string{"телефон\x00n1": "cardFromElsewhere"},
		version: "v0",
	})

	res, err := m.Deliver(context.Background(), "телефон", []Item{deliveryItem()})
	if err != nil {
		t.Fatal(err)
	}
	if res.Created != 0 || res.Commented != 1 {
		t.Fatalf("result: %+v", res)
	}
	if len(board.comments) != 1 {
		t.Fatalf("comments: %+v", board.comments)
	}
}

// A board that cannot be asked is not a board with nothing on it: the item is
// left for the next poll rather than turned into a card that may be a
// duplicate.
func TestAnItemIsLeftAloneWhileTheBoardCannotBeAsked(t *testing.T) {
	m, board, _ := testManager(t, phoneSource())
	m.SetBoardItems(&fakeBoardItems{fail: errors.New("доска недоступна")})

	res, err := m.Deliver(context.Background(), "телефон", []Item{deliveryItem()})
	if err != nil {
		t.Fatal(err)
	}
	// Counted as a failure, which is what leaves it to be tried again — one
	// item that could not be decided must not stop the rest of the batch.
	if res.Failed != 1 || res.Created != 0 {
		t.Fatalf("result: %+v", res)
	}
	if len(board.cards()) != 0 {
		t.Fatalf("a card was made anyway: %+v", board.cards())
	}
}
