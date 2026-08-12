package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/artipop/xciii/internal/sources"
)

// The way in for everything that has no plugin of its own: a script, a webhook
// forwarded here, a phone. It is a route on the front door, so it is reachable
// wherever the board is — over loopback from this machine, and over the tailnet
// door from a phone, which is the only supported way in from outside.
//
// It is deliberately not behind sameOrigin. The callers are not the page, so
// their Origin is somebody else's or absent, and the check would refuse every
// one of them. What guards it instead differs by door: on the tailnet the
// caller's identity is already known (tsnetdoor.go asks WhoIs), on loopback
// nothing is, so the source token carries it — any process on this machine can
// reach the port.

// maxIngestBody bounds one request. A card is text; anything larger is a
// mistake or an attack, and reading it into memory first would be both.
const maxIngestBody = 1 << 20 // 1 MiB

// sourceRoutes serves the ingest endpoint. Like terminalRoutes, it exists
// before the manager does — the manager needs the board server, which needs the
// port the front door is already listening on — so the manager is set later and
// every request until then is answered honestly.
type sourceRoutes struct {
	mu  sync.RWMutex
	mgr *sources.Manager
}

func newSourceRoutes() *sourceRoutes { return &sourceRoutes{} }

// SetManager hands over the manager once the sources subsystem is up.
func (s *sourceRoutes) SetManager(m *sources.Manager) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.mgr = m
}

func (s *sourceRoutes) manager() *sources.Manager {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.mgr
}

// ingestBody is the envelope: one item, or a batch of them. Both shapes are
// accepted because a phone that has been offline sends what it accumulated in
// one request, while a script sends one thing at a time, and asking either to
// speak the other's shape buys nothing.
type ingestBody struct {
	V     int            `json:"v"`
	Items []sources.Item `json:"items"`
}

func (s *sourceRoutes) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	name, ok := sourceNameFromPath(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "источники принимают только POST", http.StatusMethodNotAllowed)
		return
	}
	mgr := s.manager()
	if mgr == nil {
		http.Error(w, "источники выключены", http.StatusServiceUnavailable)
		return
	}
	entry, found := mgr.Source(name)
	if !found {
		http.Error(w, "нет такого источника", http.StatusNotFound)
		return
	}
	if !entry.CheckToken(bearerToken(r)) {
		// The same answer whether the token is wrong or the source has none, so
		// the endpoint does not report which sources are ready to be tried.
		http.Error(w, "неверный токен источника", http.StatusUnauthorized)
		return
	}

	items, err := readItems(w, r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if len(items) == 0 {
		http.Error(w, "в запросе нет ни одной записи", http.StatusBadRequest)
		return
	}

	res, err := mgr.Deliver(r.Context(), entry.Name, items)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(res)
}

// readItems accepts both shapes of the envelope. The batch is tried first: a
// body carrying "items" would otherwise decode as a single item with an empty
// title, and a card called «Без заголовка» is a worse answer than an error.
func readItems(w http.ResponseWriter, r *http.Request) ([]sources.Item, error) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxIngestBody))
	if err != nil {
		return nil, err
	}
	var batch ingestBody
	if err := json.Unmarshal(body, &batch); err != nil {
		return nil, err
	}
	items := batch.Items
	if len(items) == 0 {
		var single sources.Item
		if err := json.Unmarshal(body, &single); err != nil {
			return nil, err
		}
		if single.Title == "" && single.Body == "" && single.ExternalID == "" {
			return nil, nil
		}
		items = []sources.Item{single}
	}
	for i, it := range items {
		items[i] = it.WithFallbackID()
	}
	return items, nil
}

// bearerToken reads the credential. Only the Authorization header: a token in
// the query string ends up in every log and every history the request passes
// through.
func bearerToken(r *http.Request) string {
	const prefix = "Bearer "
	value := r.Header.Get("Authorization")
	if len(value) <= len(prefix) || !strings.EqualFold(value[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(value[len(prefix):])
}

// sourceNameFromPath matches /sources/ingest/{name}. The name is parsed here
// rather than taken from the mux pattern for the same reason terminalIDFromPath
// does it: one place decides what a valid path is, and it is testable.
func sourceNameFromPath(path string) (string, bool) {
	const prefix = "/sources/ingest/"
	if !strings.HasPrefix(path, prefix) {
		return "", false
	}
	name := strings.Trim(strings.TrimPrefix(path, prefix), "/")
	if name == "" || strings.Contains(name, "/") {
		return "", false
	}
	// Names are the user's own words and are usually Russian, so the segment
	// arrives percent-encoded.
	unescaped, err := url.PathUnescape(name)
	if err != nil {
		return "", false
	}
	return unescaped, true
}
