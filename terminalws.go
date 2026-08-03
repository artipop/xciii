// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/artipop/trixi/internal/acp"
)

// The terminal window talks to its pty over a WebSocket on the front door:
// GET /acp/terminal/{id}/ws. Binary frames are the terminal's bytes in both
// directions — output as it arrives, keystrokes as they are typed — and text
// frames are the few things that are not bytes (a resize).
//
// A socket rather than the Wails event bus because this is a byte stream with
// backpressure: an agent printing a build log would otherwise become thousands
// of runtime events, each one JSON, all of them broadcast to every window.
// The front door already carries the board's own WebSocket, so there is nothing
// new to arrange — and the same-origin guard in front of /acp/ is what keeps a
// web page from opening a terminal on somebody's machine.

// terminalRoutes serves the terminal sockets. The manager arrives later than
// the front door does — it needs the board server, which needs the port the
// front door is already listening on — so it is set once, afterwards.
type terminalRoutes struct {
	mu  sync.RWMutex
	mgr *acp.Manager
}

func newTerminalRoutes() *terminalRoutes { return &terminalRoutes{} }

// SetManager hands over the manager once the ACP integration is up. Until then
// every request is answered honestly rather than with a nil dereference.
func (t *terminalRoutes) SetManager(m *acp.Manager) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.mgr = m
}

func (t *terminalRoutes) manager() *acp.Manager {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.mgr
}

var terminalUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 32 * 1024,
	// The front door checks the origin for every /acp/ request before this is
	// reached, and it knows the address the page was published under, which
	// this does not.
	CheckOrigin: func(*http.Request) bool { return true },
}

func (t *terminalRoutes) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	id, ok := terminalIDFromPath(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	mgr := t.manager()
	if mgr == nil {
		http.Error(w, "agent integration is off", http.StatusServiceUnavailable)
		return
	}
	session := mgr.Terminal(id)
	if session == nil {
		http.Error(w, "no such terminal", http.StatusNotFound)
		return
	}

	conn, err := terminalUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return // Upgrade has already written the error
	}
	serveTerminalSocket(conn, session)
}

// terminalIDFromPath matches /acp/terminal/{id}/ws.
func terminalIDFromPath(path string) (string, bool) {
	rest, ok := strings.CutPrefix(path, "/acp/terminal/")
	if !ok {
		return "", false
	}
	id, ok := strings.CutSuffix(rest, "/ws")
	if !ok || id == "" || strings.Contains(id, "/") {
		return "", false
	}
	return id, true
}

// terminalControl is the one message that is not raw bytes.
type terminalControl struct {
	Type string `json:"type"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}

func serveTerminalSocket(conn *websocket.Conn, session *acp.TerminalSession) {
	// Every way out of this function ends in a close frame. Dropping the
	// connection instead reaches the page as code 1006 — an abnormal close —
	// and a CLI that simply finished would be drawn as a failure.
	defer func() {
		_ = conn.WriteControl(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
			time.Now().Add(2*time.Second))
		_ = conn.Close()
	}()

	history, updates, unsubscribe := session.Subscribe()
	defer unsubscribe()

	// One writer, as gorilla requires: the reader loop hands nothing to the
	// socket, it only writes to the pty.
	writes := make(chan []byte, 64)
	done := make(chan struct{})
	var closeOnce sync.Once
	stop := func() { closeOnce.Do(func() { close(done) }) }

	go func() {
		defer stop()
		for {
			kind, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			switch kind {
			case websocket.BinaryMessage:
				if err := session.Write(data); err != nil {
					return
				}
			case websocket.TextMessage:
				var msg terminalControl
				if err := json.Unmarshal(data, &msg); err != nil {
					continue
				}
				if msg.Type == "resize" {
					if err := session.Resize(msg.Cols, msg.Rows); err != nil {
						log.Printf("terminal %s: resize failed: %v", session.ID, err)
					}
				}
			}
		}
	}()

	if len(history) > 0 {
		writes <- history
	}
	go func() {
		defer stop()
		for chunk := range updates {
			select {
			case writes <- chunk:
			case <-done:
				return
			}
		}
	}()

	ping := time.NewTicker(30 * time.Second)
	defer ping.Stop()
	for {
		select {
		case chunk := <-writes:
			if err := conn.WriteMessage(websocket.BinaryMessage, chunk); err != nil {
				return
			}
		case <-ping.C:
			if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)); err != nil {
				return
			}
		case <-session.Done():
			drainAndSayGoodbye(conn, writes)
			return
		case <-done:
			// The subscription closes when the CLI exits, so this fires at the
			// same moment as the case above and Go picks between them. Both
			// have to end the same way, or a window would sometimes be told the
			// session ended and sometimes just lose the connection.
			select {
			case <-session.Done():
				drainAndSayGoodbye(conn, writes)
			default:
			}
			return
		}
	}
}

// drainAndSayGoodbye writes what the CLI printed on its way out, then says it
// has gone. The page draws the last lines and stops asking for more.
func drainAndSayGoodbye(conn *websocket.Conn, writes <-chan []byte) {
	for {
		select {
		case chunk := <-writes:
			if err := conn.WriteMessage(websocket.BinaryMessage, chunk); err != nil {
				return
			}
		default:
			_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"exit"}`))
			return
		}
	}
}
