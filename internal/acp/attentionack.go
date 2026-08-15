package acp

import (
	"sync"
	"time"
)

// Having been told once is enough.
//
// A wait says itself in a notification, because a card's amber button is only
// seen by somebody already looking at the board. The notification interrupts, so
// it must be possible to be finished with it — and it was not: the ✕ and the
// «Открыть терминал» button both put it away in the page that drew it, keyed by
// when the wait was raised, and the wait was raised again every time the silence
// broke and came back.
//
// Which is a loop, and one the person's own act closes. A stage's wait is
// silence (AttentionTerminal); opening the terminal to look at it tells the CLI
// how big the window is; a TUI redraws itself when it is resized; the redraw is
// output, so the wait ends and is raised afresh forty-five seconds later, with a
// new timestamp the page had never dismissed. Look at it again and it comes back
// again. The card was right — the agent really is still waiting — and the
// notification was noise, since the person had just been there.
//
// So the ack lives here rather than in the page. Three things follow. It holds
// for every window at once, and for the phone, which is what a person means by
// "do not tell me this again" — the page that drew the notification is not the
// only one that drew it. It survives a reload, because a wait a person answered
// is not new to them because the board was refreshed. And it is dropped by the
// one thing that makes the wait worth announcing again: the CLI drawing
// something that is not the redraw our own looking provoked (workedAt). An agent
// that revives, does a turn and stops again is asking a *new* question, and that
// is a notification a person wants.
//
// Ends are the other way out. A wait that stops waiting takes its ack with it
// (emitAttentionRecord clears on Awaiting false), so an answered question and a
// finished stage leave nothing behind to suppress the next one.

// ackedWaits is the acknowledgements, keyed by Attention.Key and holding when
// the person made them — the time is what workedAt is compared against.
type ackedWaits struct {
	mu sync.Mutex
	at map[string]time.Time
}

// AckAttention records that a person has seen this wait. Unknown keys are
// accepted rather than refused: the page acks what it is drawing, and a wait
// that ended between the click and the call is exactly the case where nothing
// needs to happen.
func (m *Manager) AckAttention(key string) {
	if m == nil || key == "" {
		return
	}
	m.acked.mu.Lock()
	if m.acked.at == nil {
		m.acked.at = map[string]time.Time{}
	}
	m.acked.at[key] = time.Now()
	m.acked.mu.Unlock()

	// Said back, so every other window takes the notification down too — and so
	// the page that clicked does not have to guess what the record now says.
	if a, ok := m.waitByKey(key); ok {
		m.emitAttentionRecord(a)
	}
}

// ackStanding reports whether this wait has already been seen.
func (m *Manager) ackStanding(key string) bool {
	m.acked.mu.Lock()
	defer m.acked.mu.Unlock()
	_, ok := m.acked.at[key]
	return ok
}

// clearAck forgets an acknowledgement, so the next wait under this key is
// announced.
func (m *Manager) clearAck(key string) {
	m.acked.mu.Lock()
	delete(m.acked.at, key)
	m.acked.mu.Unlock()
}

// clearAckIfWorked drops the acknowledgement when the CLI has drawn something
// since it. That is the whole of "the terminal came back to life": a redraw we
// provoked by opening the window does not count, which is what workedAt is for.
func (m *Manager) clearAckIfWorked(key string, worked time.Time) {
	m.acked.mu.Lock()
	defer m.acked.mu.Unlock()
	if at, ok := m.acked.at[key]; ok && worked.After(at) {
		delete(m.acked.at, key)
	}
}

// waitByKey finds the live wait a key names, in either of the two places one
// can be: a stage that has gone quiet, or a question an agent is holding a turn
// open on.
func (m *Manager) waitByKey(key string) (Attention, bool) {
	m.stageMu.Lock()
	for _, a := range m.stageWaiting {
		if a.withKey().Key == key {
			m.stageMu.Unlock()
			return a, true
		}
	}
	m.stageMu.Unlock()
	for _, q := range m.Questions() {
		if a := q.attention(); a.withKey().Key == key {
			return a, true
		}
	}
	return Attention{}, false
}
