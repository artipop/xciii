package acp

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// testSession builds a manager with a writable artifacts directory and a
// session pointed at it, which is all reportTestRun needs.
func testSession(t *testing.T, mutate func(*Config)) (*Manager, *fakeWriter, *Session) {
	t.Helper()
	cfg := DefaultConfig(t.TempDir())
	if mutate != nil {
		mutate(&cfg)
	}
	w := newFakeWriter()
	m := NewManager(cfg, "", nil, w, &fakeEmitter{}, nil)
	s := &Session{
		ID:     "sess-1",
		CardID: "card-1",
		Test:   &TestRun{URL: "https://feat-x.example.com", Branch: "feat/x", Artifacts: t.TempDir()},
	}
	return m, w, s
}

// writeRun fakes what a test session leaves behind: screenshots saved by the
// agent's browser server and the result.json the agent is asked to write.
func writeRun(t *testing.T, dir string, res TestResult, shots ...string) {
	t.Helper()
	if len(shots) > 0 {
		if err := os.MkdirAll(filepath.Join(dir, ScreenshotDir), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for i, name := range shots {
		path := filepath.Join(dir, ScreenshotDir, fmt.Sprintf("%02d-%s.png", i+1, name))
		if err := os.WriteFile(path, []byte("\x89PNG"+name), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if res.At.IsZero() {
		res.At = time.Now()
	}
	out, err := json.MarshalIndent(res, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ResultFile), out, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestProjectrtTestRunPassMovesTheCardAndAttachsEvidence(t *testing.T) {
	m, w, s := testSession(t, nil)
	writeRun(t, s.Test.Artifacts, TestResult{
		Verdict: VerdictPass,
		Summary: "Оформление заказа работает",
		Steps:   []string{"открыл каталог", "оформил заказ"},
	}, "catalog", "checkout")

	m.reportTestRun(s, "агент что-то написал", nil)

	comments := w.cardComments("card-1")
	if len(comments) != 1 {
		t.Fatalf("comments: %v", comments)
	}
	for _, want := range []string{"Тест пройден", "Оформление заказа работает", "открыл каталог", "https://feat-x.example.com"} {
		if !strings.Contains(comments[0], want) {
			t.Fatalf("comment is missing %q:\n%s", want, comments[0])
		}
	}
	// With a structured report, the agent's prose is redundant.
	if strings.Contains(comments[0], "агент что-то написал") {
		t.Fatalf("the final message should not be repeated:\n%s", comments[0])
	}

	attached := w.cardAttachments()
	if len(attached) != 2 {
		t.Fatalf("attachments: %+v", attached)
	}
	if !strings.HasSuffix(attached[0].name, ".png") || attached[0].mime != "image/png" {
		t.Fatalf("attachment: %+v", attached[0])
	}
	if string(attached[0].data) != "\x89PNGcatalog" {
		t.Fatalf("attachment contents: %q", attached[0].data)
	}

	// The verdict lands on the card, and nothing moves it: a card on a route is
	// moved by the route reading that verdict, and a card that is not on one
	// stays where it is. The machine's settings used to name a column to send it
	// to, which named a column on everybody's board (contradiction 9).
	if moves := w.cardMoves(); len(moves) != 0 {
		t.Fatalf("a test with no route behind it moved the card: %+v", moves)
	}
}

func TestProjectrtTestRunFailListsTheBugs(t *testing.T) {
	m, w, s := testSession(t, nil)
	writeRun(t, s.Test.Artifacts, TestResult{
		Verdict: VerdictFail,
		Summary: "Корзина не открывается",
		Bugs:    []string{"Клик по «Купить» ничего не делает; в консоли TypeError"},
	}, "broken")

	m.reportTestRun(s, "", nil)

	comment := w.cardComments("card-1")[0]
	for _, want := range []string{"Тест не пройден", "Дефекты", "TypeError"} {
		if !strings.Contains(comment, want) {
			t.Fatalf("comment is missing %q:\n%s", want, comment)
		}
	}
	if moves := w.cardMoves(); len(moves) != 0 {
		t.Fatalf("a failed test with no route behind it moved the card: %+v", moves)
	}
}

func TestProjectrtTestRunBlockedLeavesTheCardAlone(t *testing.T) {
	m, w, s := testSession(t, nil)
	writeRun(t, s.Test.Artifacts, TestResult{
		Verdict: VerdictBlocked,
		Summary: "Превью не открывается: 502",
	})

	m.reportTestRun(s, "", nil)

	if comment := w.cardComments("card-1")[0]; !strings.Contains(comment, "🚧") {
		t.Fatalf("comment: %s", comment)
	}
	if moves := w.cardMoves(); len(moves) != 0 {
		t.Fatalf("a blocked run must not move the card: %+v", moves)
	}
}

func TestProjectrtTestRunWithoutAVerdict(t *testing.T) {
	m, w, s := testSession(t, nil)
	// The agent took a screenshot but never called report_result.
	writeRun(t, s.Test.Artifacts, TestResult{Verdict: VerdictPass})
	if err := os.Remove(filepath.Join(s.Test.Artifacts, ResultFile)); err != nil {
		t.Fatal(err)
	}

	m.reportTestRun(s, "я всё посмотрел, вроде работает", nil)

	comment := w.cardComments("card-1")[0]
	if !strings.Contains(comment, "вердикта нет") {
		t.Fatalf("comment: %s", comment)
	}
	// Without a report, the agent's own words are all there is.
	if !strings.Contains(comment, "я всё посмотрел") {
		t.Fatalf("the final message should be kept when there is no report:\n%s", comment)
	}
	if moves := w.cardMoves(); len(moves) != 0 {
		t.Fatalf("no verdict must mean no move: %+v", moves)
	}
}

func TestProjectrtTestRunOnABrokenOffTurnStillReports(t *testing.T) {
	m, w, s := testSession(t, nil)
	writeRun(t, s.Test.Artifacts, TestResult{
		Verdict: VerdictFail,
		Summary: "Не дошёл до конца",
		Bugs:    []string{"страница висит"},
	}, "hang")

	m.reportTestRun(s, "", context.DeadlineExceeded)

	comment := w.cardComments("card-1")[0]
	if !strings.Contains(comment, "Сессия прервалась") {
		t.Fatalf("comment: %s", comment)
	}
	if len(w.cardAttachments()) != 1 {
		t.Fatalf("evidence collected before the timeout must still be attached: %+v", w.cardAttachments())
	}
}

// What used to stand here: a test that an empty column name in the machine's
// settings left the card where it was. There is no such name any more, and
// leaving the card alone is what always happens now.

func TestProjectrtTestRunCapsAttachments(t *testing.T) {
	m, w, s := testSession(t, nil)
	shots := make([]string, maxAttachments+5)
	for i := range shots {
		shots[i] = "step"
	}
	writeRun(t, s.Test.Artifacts, TestResult{Verdict: VerdictPass, Summary: "ок"}, shots...)

	m.reportTestRun(s, "", nil)

	if got := len(w.cardAttachments()); got != maxAttachments {
		t.Fatalf("attachments: %d, want %d", got, maxAttachments)
	}
}
