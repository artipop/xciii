package web

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func ok(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }

func get(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	return w
}

// A group's prefix is the service's own business and never the route's: a route
// is written as the path it is documented under, and where the whole board
// hangs is decided in one place.
func TestAGroupPrefixesEveryRouteRegisteredThroughIt(t *testing.T) {
	r := NewRouter()
	api := r.Group("/api/v2")
	api.HandleFunc("GET /boards/{boardID}", func(w http.ResponseWriter, req *http.Request) {
		_, _ = w.Write([]byte(req.PathValue("boardID")))
	})

	require.Equal(t, "abc", get(t, r, "/api/v2/boards/abc").Body.String())
	require.Equal(t, http.StatusNotFound, get(t, r, "/boards/abc").Code)
}

// The base path the whole server can be moved under is a group around the
// groups, so a service that knows nothing about it still lands beneath it.
func TestGroupsNest(t *testing.T) {
	r := NewRouter()
	r.Group("/boards").Group("/api/v2").HandleFunc("GET /hello", ok)

	require.Equal(t, http.StatusOK, get(t, r, "/boards/api/v2/hello").Code)
}

// Middleware belongs to the group, and a route registered elsewhere must not
// pay for it — the CSRF check guards the API and would refuse the page itself.
func TestMiddlewareRunsOnlyForItsOwnGroup(t *testing.T) {
	r := NewRouter()
	var seen []string
	mark := func(name string) func(http.Handler) http.Handler {
		return func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				seen = append(seen, name)
				next.ServeHTTP(w, req)
			})
		}
	}
	r.Group("/api", mark("outer")).Group("/v2", mark("inner")).HandleFunc("GET /guarded", ok)
	r.HandleFunc("GET /open", ok)

	get(t, r, "/open")
	require.Empty(t, seen, "a route outside the group ran its middleware")

	get(t, r, "/api/v2/guarded")
	require.Equal(t, []string{"outer", "inner"}, seen, "middleware ran out of order")
}

// A request nobody claimed must not reach the group's middleware either: the
// panic handler and the CSRF check are about the API's own routes, and a 404 is
// the mux's answer before any of ours.
func TestMiddlewareDoesNotRunForAnUnmatchedPath(t *testing.T) {
	r := NewRouter()
	ran := false
	r.Group("/api", func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ran = true
			next.ServeHTTP(w, req)
		})
	}).HandleFunc("GET /known", ok)

	require.Equal(t, http.StatusNotFound, get(t, r, "/api/unknown").Code)
	require.False(t, ran)
}

// The method is part of the pattern, so the same path with two verbs is two
// routes and a third verb is refused by the mux rather than by the handler.
func TestTheMethodSelectsTheRoute(t *testing.T) {
	r := NewRouter()
	r.HandleFunc("GET /boards", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("list"))
	})
	r.HandleFunc("POST /boards", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("create"))
	})

	require.Equal(t, "list", get(t, r, "/boards").Body.String())

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/boards", nil))
	require.Equal(t, "create", w.Body.String())

	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodDelete, "/boards", nil))
	require.Equal(t, http.StatusMethodNotAllowed, w.Code)
}
