package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/artipop/xciii/internal/appschema"
	"github.com/artipop/xciii/internal/sources"
)

// recordingBoard stands in for the board: the endpoint is being tested, not the
// board server, and everything past CreateCard is covered in internal/sources.
type recordingBoard struct{ created []sources.CardSpec }

func (b *recordingBoard) CreateCard(_ context.Context, _ string, spec sources.CardSpec) (string, error) {
	b.created = append(b.created, spec)
	return "card1", nil
}
func (b *recordingBoard) AddComment(context.Context, string, string) error { return nil }
func (b *recordingBoard) MoveCardByOptionName(context.Context, string, string, string) error {
	return nil
}
func (b *recordingBoard) ColumnProperty(context.Context, string) (string, error) {
	return "Статус", nil
}
func (b *recordingBoard) EnsureInbox(_ context.Context, _, _, column string) (string, error) {
	return "option-" + column, nil
}

const testToken = "test-token"

func ingestRoutes(t *testing.T) (*sourceRoutes, *recordingBoard) {
	t.Helper()
	db, err := appschema.Open(filepath.Join(t.TempDir(), "sources.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	store := sources.NewStore(db, "")

	board := &recordingBoard{}
	cfg := sources.Config{Sources: []sources.SourceEntry{{
		Name: "телефон", BoardID: "board1", Enabled: true, Noisy: true,
		TokenHash: sources.HashToken(testToken),
		Rules:     []sources.Rule{{Then: sources.ActionCard}},
	}}}
	routes := newSourceRoutes()
	routes.SetManager(sources.NewManager(cfg, "", store, board, nil))
	return routes, board
}

func post(t *testing.T, h http.Handler, path, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestAPostedNotificationBecomesACard(t *testing.T) {
	routes, board := ingestRoutes(t)

	rec := post(t, routes, "/sources/ingest/%D1%82%D0%B5%D0%BB%D0%B5%D1%84%D0%BE%D0%BD", testToken,
		`{"v":1,"id":"n1","title":"Доставка завтра","body":"Заказ №123"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var res sources.Result
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.Created != 1 {
		t.Fatalf("result: %+v", res)
	}
	if len(board.created) != 1 || board.created[0].Title != "Доставка завтра" {
		t.Fatalf("created: %+v", board.created)
	}
}

// A phone that has been offline sends what it accumulated in one request.
func TestABatchIsOneRequest(t *testing.T) {
	routes, board := ingestRoutes(t)

	rec := post(t, routes, "/sources/ingest/телефон", testToken,
		`{"v":1,"items":[{"id":"n1","title":"Первое"},{"id":"n2","title":"Второе"}]}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if len(board.created) != 2 {
		t.Fatalf("created: %+v", board.created)
	}
}

// The mobile network drops the answer and the client repeats the request. Two
// identical bodies with no id of their own are still one thing.
func TestTheSameBodyTwiceIsOneCard(t *testing.T) {
	routes, board := ingestRoutes(t)
	body := `{"v":1,"title":"Доставка завтра","body":"Заказ №123"}`

	post(t, routes, "/sources/ingest/телефон", testToken, body)
	post(t, routes, "/sources/ingest/телефон", testToken, body)

	if len(board.created) != 1 {
		t.Fatalf("created: %+v", board.created)
	}
}

// The token is the whole of the protection on the loopback door: any process on
// this machine can reach the port.
func TestWithoutTheRightTokenNothingIsAccepted(t *testing.T) {
	routes, board := ingestRoutes(t)
	body := `{"v":1,"id":"n1","title":"Доставка"}`

	for _, token := range []string{"", "не тот"} {
		if got := post(t, routes, "/sources/ingest/телефон", token, body).Code; got != http.StatusUnauthorized {
			t.Fatalf("token %q: status %d", token, got)
		}
	}
	if len(board.created) != 0 {
		t.Fatalf("nothing should have been written: %+v", board.created)
	}
}

func TestAnUnknownSourceIsRefused(t *testing.T) {
	routes, _ := ingestRoutes(t)

	if got := post(t, routes, "/sources/ingest/почта", testToken, `{"v":1,"title":"x"}`).Code; got != http.StatusNotFound {
		t.Fatalf("status %d", got)
	}
}

// The client is written by a person, so a broken envelope has to say so rather
// than be quietly accepted as an empty card.
func TestABrokenEnvelopeIsAnError(t *testing.T) {
	routes, _ := ingestRoutes(t)

	if got := post(t, routes, "/sources/ingest/телефон", testToken, `{`).Code; got != http.StatusBadRequest {
		t.Fatalf("broken json: %d", got)
	}
	if got := post(t, routes, "/sources/ingest/телефон", testToken, `{"v":1}`).Code; got != http.StatusBadRequest {
		t.Fatalf("nothing in it: %d", got)
	}
}

func TestOnlyPostIsAccepted(t *testing.T) {
	routes, _ := ingestRoutes(t)

	req := httptest.NewRequest(http.MethodGet, "/sources/ingest/телефон", nil)
	rec := httptest.NewRecorder()
	routes.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status %d", rec.Code)
	}
}

// Until the board exists there is no manager, and a request has to be answered
// honestly rather than by a nil dereference.
func TestBeforeTheSubsystemIsUpTheEndpointSaysSo(t *testing.T) {
	if got := post(t, newSourceRoutes(), "/sources/ingest/телефон", testToken, `{"v":1}`).Code; got != http.StatusServiceUnavailable {
		t.Fatalf("status %d", got)
	}
}

// The endpoint as it is actually reached: through the front door, which guards
// the Host and sends everything else to the board. Ingest is the one route that
// is not same-origin — the caller is a script or a phone, never the page — so
// this is where that is proven, together with the door not swallowing it.
func TestIngestWorksThroughTheFrontDoor(t *testing.T) {
	routes, board := ingestRoutes(t)
	door := newFrontDoor(named("wails"), named("acp"), routes, named("board"), "127.0.0.1:9000")

	req := httptest.NewRequest(http.MethodPost, "/sources/ingest/телефон",
		strings.NewReader(`{"v":1,"id":"n1","title":"Доставка завтра"}`))
	req.Host = "127.0.0.1:9000"
	req.Header.Set("Authorization", "Bearer "+testToken)
	// A curl or a phone sends no Origin at all; a webhook forwarded here sends
	// somebody else's. Neither may be refused.
	req.Header.Set("Origin", "https://hooks.example.com")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	rec := httptest.NewRecorder()
	door.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if len(board.created) != 1 {
		t.Fatalf("created: %+v", board.created)
	}
}

// The door in front of it still refuses a Host it was not published under: the
// answer to DNS rebinding covers this route like every other.
func TestIngestIsStillBehindTheHostGuard(t *testing.T) {
	routes, board := ingestRoutes(t)
	door := newFrontDoor(named("wails"), named("acp"), routes, named("board"), "127.0.0.1:9000")

	req := httptest.NewRequest(http.MethodPost, "/sources/ingest/телефон",
		strings.NewReader(`{"v":1,"id":"n1","title":"Доставка"}`))
	req.Host = "board.example.com"
	req.Header.Set("Authorization", "Bearer "+testToken)
	rec := httptest.NewRecorder()
	door.ServeHTTP(rec, req)

	if rec.Code == http.StatusOK || len(board.created) != 0 {
		t.Fatalf("status %d, created %+v", rec.Code, board.created)
	}
}

func TestSourceNameFromPath(t *testing.T) {
	for path, want := range map[string]string{
		"/sources/ingest/phone":  "phone",
		"/sources/ingest/phone/": "phone",
		"/sources/ingest/%D1%82%D0%B5%D0%BB%D0%B5%D1%84%D0%BE%D0%BD": "телефон",
	} {
		got, ok := sourceNameFromPath(path)
		if !ok || got != want {
			t.Errorf("%s → %q, %v", path, got, ok)
		}
	}
	for _, path := range []string{"/sources/ingest/", "/sources/ingest", "/acp/terminal/x/ws", "/sources/ingest/a/b"} {
		if _, ok := sourceNameFromPath(path); ok {
			t.Errorf("%s should not have matched", path)
		}
	}
}
