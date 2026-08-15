package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/artipop/xciii/internal/acp"
)

// The agent events a page listens to — a session changed state, a terminal
// opened or closed, a card is waiting for a person — go out over a socket on
// the front door: GET /acp/events/ws.
//
// They used to go over the Wails event bus alone, and that bus does not leave
// this machine: in a desktop build an event is delivered by running JS in the
// windows the application owns, so a page served to a phone over the tailnet
// door hears nothing at all. (A server build broadcasts over its own socket, so
// it did work there — one more way for the two builds to differ.) The front
// door is the one thing every client of this app has in common, window and
// phone alike, so the events ride it and the page has a single path to listen
// on.
//
// What is sent is what the bus carried: {"event": name, "data": payload}. The
// page unwraps it exactly as the bootstrap shim unwraps a Wails event.

// eventRoutes broadcasts UI events to every page that asked for them.
type eventRoutes struct {
	mu   sync.Mutex
	subs map[chan []byte]struct{}
}

func newEventRoutes() *eventRoutes {
	return &eventRoutes{subs: map[chan []byte]struct{}{}}
}

// newACPSockets is the /acp/ half of the front door: the sockets, and only the
// sockets. The pages around them (/acp/terminal/{id}) are webapp routes the
// board serves like any other.
// boardTools is not a socket but belongs to the same subtree: it is the other
// end of the MCP server an agent runs, and it is authenticated by a grant token
// rather than by the origin the request came from (boardapi.go).
func newACPSockets(terminals, events, boardTools, hook http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/acp/terminal/{id}/ws", terminals)
	mux.Handle("/acp/events/ws", events)
	mux.Handle("/acp/board/", boardTools)
	mux.Handle(acp.HookPath, hook)
	return mux
}

var eventUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
	// The front door checks the origin of every /acp/ request before this is
	// reached, and it knows the address the page was published under, which
	// this does not.
	CheckOrigin: func(*http.Request) bool { return true },
}

// Emit sends one event to every subscriber. A page that cannot keep up loses
// the message rather than slowing the agent down: every one of these events is
// a nudge to refetch, so the next one repairs whatever the last one missed.
func (e *eventRoutes) Emit(event string, payload any) {
	message, err := json.Marshal(struct {
		Event string `json:"event"`
		Data  any    `json:"data"`
	}{Event: event, Data: payload})
	if err != nil {
		log.Printf("events: dropping %s: %v", event, err)
		return
	}

	e.mu.Lock()
	defer e.mu.Unlock()
	for sub := range e.subs {
		select {
		case sub <- message:
		default:
		}
	}
}

func (e *eventRoutes) subscribe() chan []byte {
	sub := make(chan []byte, 64)
	e.mu.Lock()
	e.subs[sub] = struct{}{}
	e.mu.Unlock()
	return sub
}

func (e *eventRoutes) unsubscribe(sub chan []byte) {
	e.mu.Lock()
	delete(e.subs, sub)
	e.mu.Unlock()
}

func (e *eventRoutes) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := eventUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return // Upgrade has already written the error
	}
	defer conn.Close()

	sub := e.subscribe()
	defer e.unsubscribe(sub)

	// Nothing is expected from the page, but somebody has to read the socket:
	// without a reader a close frame is never noticed and the subscription
	// outlives the tab.
	closed := make(chan struct{})
	go func() {
		defer close(closed)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	ping := time.NewTicker(30 * time.Second)
	defer ping.Stop()
	for {
		select {
		case message := <-sub:
			if err := conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ping.C:
			if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)); err != nil {
				return
			}
		case <-closed:
			return
		}
	}
}
