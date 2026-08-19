package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/artipop/xciii/server/mlog"
	"github.com/artipop/xciii/server/web"
)

func routerWithAllRoutes(t *testing.T) *web.Router {
	t.Helper()
	a := NewAPI(nil, "", "", nil, mlog.CreateConsoleTestLogger(t))
	r := web.NewRouter()
	a.RegisterRoutes(r)
	return r
}

// The whole route table has to register cleanly, because the standard mux
// refuses a duplicate or ambiguous pattern by panicking — at startup, before
// anything is listening. gorilla took the first of two identical routes and
// dropped the second without a word, which is how the board carried a duplicate
// for years; this is the test that keeps the next one from reaching a release.
func TestEveryRouteRegistersWithoutConflict(t *testing.T) {
	require.NotPanics(t, func() { routerWithAllRoutes(t) })
}

// The routes that share a shape with a wildcard one. gorilla matched in
// registration order, so these worked because they were written first; the
// standard mux matches the most specific pattern instead, and this is the test
// that says the two rules agree here — a literal segment beats a wildcard, so
// /boards/search is the search and never a board called "search".
func TestALiteralPathWinsOverTheWildcardItLooksLike(t *testing.T) {
	r := routerWithAllRoutes(t)

	for _, tc := range []struct {
		name    string
		method  string
		url     string
		pattern string
	}{
		{
			"searching all boards is not a board named search",
			http.MethodGet, "/api/v2/boards/search",
			"GET /api/v2/boards/search",
		},
		{
			"reordering categories is not a category named reorder",
			http.MethodPut, "/api/v2/teams/t1/categories/reorder",
			"PUT /api/v2/teams/{teamID}/categories/reorder",
		},
		{
			"a board's own id still reaches the board route",
			http.MethodGet, "/api/v2/boards/b1",
			"GET /api/v2/boards/{boardID}",
		},
		{
			"a file's info is not a file named info",
			http.MethodGet, "/api/v2/files/teams/t1/b1/f1/info",
			"GET /api/v2/files/teams/{teamID}/{boardID}/{filename}/info",
		},
		{
			"one subscriber's subscriptions are not a block's",
			http.MethodGet, "/api/v2/subscriptions/u1",
			"GET /api/v2/subscriptions/{subscriberID}",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, pattern := r.Handler(httptest.NewRequest(tc.method, tc.url, nil))
			require.Equal(t, tc.pattern, pattern)
		})
	}
}

// A path segment is what the handler reads it as. This is the whole of what
// mux.Vars did, and getting it wrong is silent — an empty id reads as "not
// found" rather than as a routing bug.
func TestAPathSegmentReachesTheHandlerAsAValue(t *testing.T) {
	r := web.NewRouter()
	r.HandleFunc("GET /boards/{boardID}/blocks/{blockID}", func(w http.ResponseWriter, req *http.Request) {
		_, _ = w.Write([]byte(req.PathValue("boardID") + "/" + req.PathValue("blockID")))
	})

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/boards/b1/blocks/k1", nil))
	require.Equal(t, "b1/k1", w.Body.String())
}
