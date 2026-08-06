package sources

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/artipop/xciii/internal/sources/plugin"
)

// The runner is tested against a fake connection rather than a real process:
// that a real one works over real stdio is settled in internal/sources/plugin,
// and what is worth pinning here is what the app does with the answers.

type fakePlugin struct {
	caps plugin.Capabilities

	mu      sync.Mutex
	polls   []string // the cursor each poll was given
	replies []pluginReply
	closed  bool
	handler plugin.Handler
}

type pluginReply struct {
	result plugin.PollResult
	err    error
}

func (f *fakePlugin) Capabilities() plugin.Capabilities { return f.caps }

func (f *fakePlugin) Poll(_ context.Context, cursor string) (plugin.PollResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.polls = append(f.polls, cursor)
	if len(f.replies) == 0 {
		return plugin.PollResult{}, nil
	}
	reply := f.replies[0]
	if len(f.replies) > 1 {
		f.replies = f.replies[1:]
	}
	return reply.result, reply.err
}

func (f *fakePlugin) Close() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = true
}

func (f *fakePlugin) pollCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.polls)
}

func (f *fakePlugin) cursors() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.polls...)
}

func item(id, title string) json.RawMessage {
	return json.RawMessage(`{"id":"` + id + `","title":"` + title + `"}`)
}

// runnerManager wires a manager whose plugin is the fake above.
func runnerManager(t *testing.T, entry SourceEntry, fake *fakePlugin) (*Manager, *fakeBoard) {
	t.Helper()
	store, err := OpenStore(filepath.Join(t.TempDir(), "sources.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })

	board := &fakeBoard{}
	m := NewManager(Config{
		Sources: []SourceEntry{entry},
		Plugins: []Manifest{{Name: "телефон-плагин", Command: "/bin/true"}},
	}, "", store, board, nil)
	m.SetDialer(func(context.Context, SourceEntry, Manifest, plugin.Credentials, plugin.Handler) (conn, error) {
		return fake, nil
	})
	return m, board
}

func pluginSource() SourceEntry {
	return SourceEntry{
		Name: "телефон", Plugin: "телефон-плагин", BoardID: "board1",
		Enabled: true, Noisy: true, IntervalSeconds: 1,
		Rules: []Rule{{Then: ActionCard, Column: "Сегодня"}},
	}
}

// A source that has just been switched on has been waiting for whoever switched
// it on, not for the schedule.
func TestASourceIsAskedAsSoonAsItStarts(t *testing.T) {
	fake := &fakePlugin{
		caps:    plugin.Capabilities{Poll: true, Cursor: true},
		replies: []pluginReply{{result: plugin.PollResult{Items: []json.RawMessage{item("n1", "Доставка")}, Cursor: "c1"}}},
	}
	m, board := runnerManager(t, pluginSource(), fake)

	m.Start(context.Background())
	defer m.Stop(time.Second)

	waitFor(t, func() bool { return len(board.cards()) == 1 })
	if board.cards()[0].Title != "Доставка" {
		t.Fatalf("created: %+v", board.cards())
	}
	if got := m.Status("телефон"); got.State != StateRunning || got.LastPoll == nil {
		t.Fatalf("status: %+v", got)
	}
}

// The cursor is the plugin's own bookmark: the app stores it and hands it back,
// and never looks inside.
func TestTheCursorIsHandedBackOnTheNextPoll(t *testing.T) {
	restore := minInterval
	minInterval = 10 * time.Millisecond
	t.Cleanup(func() { minInterval = restore })

	fake := &fakePlugin{
		caps: plugin.Capabilities{Poll: true, Cursor: true},
		replies: []pluginReply{
			{result: plugin.PollResult{Items: []json.RawMessage{item("n1", "Первое")}, Cursor: "c1"}},
			{result: plugin.PollResult{Cursor: "c1"}},
		},
	}
	entry := pluginSource()
	entry.IntervalSeconds = 1
	m, _ := runnerManager(t, entry, fake)

	m.Start(context.Background())
	defer m.Stop(time.Second)

	waitFor(t, func() bool { return fake.pollCount() >= 2 })
	got := fake.cursors()
	if got[0] != "" || got[1] != "c1" {
		t.Fatalf("cursors: %+v", got)
	}
}

// A dead credential is not worth asking about again: the service can see every
// attempt, and only a person can fix it.
func TestADeadCredentialStopsTheSourceAndSaysSo(t *testing.T) {
	fake := &fakePlugin{
		caps: plugin.Capabilities{Poll: true},
		replies: []pluginReply{{err: &plugin.Error{
			Message: "токен отозван", Kind: plugin.KindNeedsReauth,
		}}},
	}
	m, _ := runnerManager(t, pluginSource(), fake)

	m.Start(context.Background())
	defer m.Stop(time.Second)

	waitFor(t, func() bool { return m.Status("телефон").State == StateNeedsReauth })
	if got := m.Status("телефон"); got.Error == "" {
		t.Fatalf("status says nothing about why: %+v", got)
	}
	// Stopped, not slowed: one attempt and no more.
	time.Sleep(50 * time.Millisecond)
	if fake.pollCount() != 1 {
		t.Fatalf("kept asking: %d polls", fake.pollCount())
	}
}

// A network failure is worth coming back for, so the source stays up.
func TestANetworkFailureIsNotTheEndOfTheSource(t *testing.T) {
	restore := minInterval
	minInterval = 10 * time.Millisecond
	t.Cleanup(func() { minInterval = restore })

	fake := &fakePlugin{
		caps: plugin.Capabilities{Poll: true},
		replies: []pluginReply{
			{err: &plugin.Error{Message: "сеть недоступна", Kind: plugin.KindRetryable}},
			{result: plugin.PollResult{Items: []json.RawMessage{item("n1", "Позже")}}},
		},
	}
	m, board := runnerManager(t, pluginSource(), fake)

	m.Start(context.Background())
	defer m.Stop(time.Second)

	waitFor(t, func() bool { return len(board.cards()) == 1 })
	if got := m.Status("телефон"); got.State != StateRunning {
		t.Fatalf("status after recovery: %+v", got)
	}
}

// A push plugin talks when it has something; there is nothing to ask it for.
func TestAPushPluginsItemsGoDownTheSamePipeline(t *testing.T) {
	fake := &fakePlugin{caps: plugin.Capabilities{Push: true}}
	m, board := runnerManager(t, pluginSource(), fake)
	// The handler is created on the source's own goroutine, so it is handed
	// over rather than assigned to a variable both sides touch.
	handlers := make(chan plugin.Handler, 1)
	m.SetDialer(func(_ context.Context, _ SourceEntry, _ Manifest, _ plugin.Credentials, h plugin.Handler) (conn, error) {
		handlers <- h
		return fake, nil
	})

	m.Start(context.Background())
	defer m.Stop(time.Second)

	handler := <-handlers
	handler.Items([]json.RawMessage{item("n1", "Пришло само")}, "")

	waitFor(t, func() bool { return len(board.cards()) == 1 })
	if fake.pollCount() != 0 {
		t.Fatalf("a plugin that does not poll was polled %d times", fake.pollCount())
	}
}

// One unreadable payload must not discard the batch it arrived in.
func TestABadPayloadCostsItselfAndNotTheBatch(t *testing.T) {
	fake := &fakePlugin{
		caps: plugin.Capabilities{Poll: true},
		replies: []pluginReply{{result: plugin.PollResult{Items: []json.RawMessage{
			json.RawMessage(`{"id":`),
			item("n2", "Второе"),
		}}}},
	}
	m, board := runnerManager(t, pluginSource(), fake)

	m.Start(context.Background())
	defer m.Stop(time.Second)

	waitFor(t, func() bool { return len(board.cards()) == 1 })
	if board.cards()[0].Title != "Второе" {
		t.Fatalf("created: %+v", board.cards())
	}
}

// A source naming a plugin nobody registered says so instead of failing
// silently — the commonest way a hand-edited registry goes wrong.
func TestASourceWithoutItsPluginSaysSo(t *testing.T) {
	entry := pluginSource()
	entry.Plugin = "нет такого"
	m, _ := runnerManager(t, entry, &fakePlugin{})

	m.Start(context.Background())
	defer m.Stop(time.Second)

	waitFor(t, func() bool { return m.Status("телефон").State == StateError })
	events, err := m.Events("телефон", 10)
	if err != nil || len(events) == 0 {
		t.Fatalf("events: %+v, %v", events, err)
	}
}

func TestStoppingClosesThePlugin(t *testing.T) {
	fake := &fakePlugin{caps: plugin.Capabilities{Push: true}}
	m, _ := runnerManager(t, pluginSource(), fake)

	m.Start(context.Background())
	waitFor(t, func() bool { return m.Status("телефон").State == StateRunning })
	m.Stop(2 * time.Second)

	fake.mu.Lock()
	defer fake.mu.Unlock()
	if !fake.closed {
		t.Fatal("the plugin was left running")
	}
}

func TestAManifestHasToBeStartable(t *testing.T) {
	if _, err := (Manifest{Name: "gmail"}).Validate(); err == nil {
		t.Fatal("a manifest with no command must be refused")
	}
	if _, err := (Manifest{Name: "gmail", Command: "npx", Fields: []Field{{Key: "label", Type: "мяу"}}}).Validate(); err == nil {
		t.Fatal("a field type outside the closed set must be refused")
	}
	got, err := (Manifest{Name: "gmail", Command: "npx", Args: []string{"-y", "pkg"}, Fields: []Field{{Key: "label"}}}).Validate()
	if err != nil {
		t.Fatal(err)
	}
	if got.Fields[0].Type != "string" {
		t.Errorf("a field with no type is text: %+v", got.Fields[0])
	}
	if argv := got.Argv(); len(argv) != 3 || argv[0] != "npx" {
		t.Errorf("argv: %+v", argv)
	}
}

func TestAFailureToStartIsNotSilent(t *testing.T) {
	m, _ := runnerManager(t, pluginSource(), &fakePlugin{})
	m.SetDialer(func(context.Context, SourceEntry, Manifest, plugin.Credentials, plugin.Handler) (conn, error) {
		return nil, errors.New("исполняемый файл не найден")
	})

	m.Start(context.Background())
	defer m.Stop(time.Second)

	waitFor(t, func() bool { return m.Status("телефон").State == StateError })
	if got := m.Status("телефон").Error; got == "" {
		t.Fatal("the status does not say what went wrong")
	}
}

// waitFor polls a condition, because what is being waited on happens on another
// goroutine and a sleep long enough to be safe is a slow test.
func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("не дождались")
}
