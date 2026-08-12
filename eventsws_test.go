package main

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func dialEvents(t *testing.T, events *eventRoutes) *websocket.Conn {
	t.Helper()
	server := httptest.NewServer(events)
	t.Cleanup(server.Close)

	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatalf("dialing the event socket: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

// The Wails bus reaches the windows this application owns and nothing else, so
// a board opened on a phone would otherwise sit there showing a session that
// finished an hour ago.
func TestAPageHearsWhatTheAgentsAreDoing(t *testing.T) {
	events := newEventRoutes()
	conn := dialEvents(t, events)

	// The subscription is made when the socket is served, which is a goroutine
	// away from the dial returning.
	deadline := time.Now().Add(2 * time.Second)
	for {
		events.Emit("acp:session", map[string]string{"cardId": "card-1"})
		_ = conn.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
		_, message, err := conn.ReadMessage()
		if err == nil {
			var got struct {
				Event string            `json:"event"`
				Data  map[string]string `json:"data"`
			}
			if err := json.Unmarshal(message, &got); err != nil {
				t.Fatalf("unmarshalling %s: %v", message, err)
			}
			if got.Event != "acp:session" || got.Data["cardId"] != "card-1" {
				t.Errorf("received %s, want the session event for card-1", message)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("nothing arrived on the event socket: %v", err)
		}
	}
}

// Every one of these events is a nudge to refetch, so a page that stopped
// reading must cost the agent nothing: the message is dropped and the next one
// repairs whatever was missed.
func TestASlowPageDoesNotStallTheAgent(t *testing.T) {
	events := newEventRoutes()
	sub := events.subscribe()
	defer events.unsubscribe(sub)

	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 1000; i++ {
			events.Emit("acp:session", map[string]int{"n": i})
		}
	}()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("emitting blocked on a subscriber that never read")
	}
}
