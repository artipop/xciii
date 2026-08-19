package acp

import (
	"sync"
	"time"
)

// Having been told once is enough.
//
// The ack is kept here rather than in the page, so it holds for every window and
// for the phone at once — the page that drew the notification is not the only
// one that drew it — and survives a reload.
//
// It is dropped by the CLI drawing something that is *not* the redraw our own
// looking provoked (workedAt): going to look at an agent resizes its terminal,
// a TUI repaints when resized, and counting that as work made every wait come
// back a minute after somebody checked it. An agent that revives, does a turn
// and stops again is asking something new, which is worth saying.
//
// A wait that ends takes its ack with it (emitAttentionRecord clears on Awaiting
// false), so nothing is left behind to suppress the next one.

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
