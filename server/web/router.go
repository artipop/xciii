package web

import (
	"net/http"
	"strings"
)

// Router is the surface every service registers its routes on. It is a thin
// layer over http.ServeMux, and that is the whole point: since Go 1.22 the
// standard mux matches "{name}" wildcards and a method in the pattern, which
// was all gorilla/mux was ever doing here. What it does not have is the other
// two things the board's routing used — a prefix shared by a group of routes,
// and middleware that runs only for the routes in that group — so those are
// what this adds, and nothing else.
//
// One behaviour is deliberately different from gorilla's. gorilla matched
// routes in registration order and quietly ignored the second registration of a
// path already taken; http.ServeMux panics on a conflict instead. A duplicate
// route is a bug either way, and one that announces itself at startup is the
// cheaper of the two — the board had exactly one, and it had been there for
// years.
type Router struct {
	mux    *http.ServeMux
	prefix string
	// Held rather than pre-composed so Group can extend the chain; the wrapping
	// happens once per route at registration, never per request.
	middleware []func(http.Handler) http.Handler
}

// NewRouter returns an empty router.
func NewRouter() *Router {
	return &Router{mux: http.NewServeMux()}
}

// Group returns a router registering under prefix, on the same mux, with mw run
// before every handler registered through it. As with gorilla's Use, the
// middleware runs only once a route in the group has matched, so a request for
// a path nobody claimed never reaches it.
func (r *Router) Group(prefix string, mw ...func(http.Handler) http.Handler) *Router {
	chain := make([]func(http.Handler) http.Handler, 0, len(r.middleware)+len(mw))
	chain = append(chain, r.middleware...)
	chain = append(chain, mw...)
	return &Router{mux: r.mux, prefix: r.prefix + prefix, middleware: chain}
}

// Handle registers h for a standard-library pattern — "GET /boards/{boardID}",
// or a bare path to accept any method — under this router's prefix.
func (r *Router) Handle(pattern string, h http.Handler) {
	for i := len(r.middleware) - 1; i >= 0; i-- {
		h = r.middleware[i](h)
	}
	r.mux.Handle(r.pattern(pattern), h)
}

// HandleFunc is Handle for a plain function.
func (r *Router) HandleFunc(pattern string, h http.HandlerFunc) {
	r.Handle(pattern, h)
}

// pattern splices this router's prefix into a stdlib pattern, which carries the
// method in front of the path and so cannot simply be concatenated.
func (r *Router) pattern(pattern string) string {
	method, path, found := strings.Cut(pattern, " ")
	if !found {
		return r.prefix + pattern
	}
	return method + " " + r.prefix + path
}

// ServeHTTP makes the router the handler for a server. A group serves the whole
// mux, not its own subtree: they all share one.
func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	r.mux.ServeHTTP(w, req)
}

// Handler answers which route claims a request, and under which pattern. It is
// how a test asks the question the standard mux answers differently from
// gorilla: gorilla took the first route registered, this takes the most
// specific one, and a route table written for the first rule has to be checked
// against the second.
func (r *Router) Handler(req *http.Request) (http.Handler, string) {
	return r.mux.Handler(req)
}
