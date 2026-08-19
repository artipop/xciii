package acp

import (
	"testing"
	"time"

	"github.com/aymanbagabas/go-pty"
)

// waitingStage is a stage that has gone quiet, built by hand: what the ack is
// about is the raising and lowering of one wait, and driving a real CLI into and
// out of silence on demand is a test about the shell instead.
func waitingStage(t *testing.T) (*Manager, *Session, *TerminalSession, *fakeEmitter) {
	t.Helper()
	emitter := &fakeEmitter{}
	m := &Manager{ui: emitter}
	s := &Session{CardID: "card-1", BoardID: "board-1", Title: "Починить логин", Agent: AgentEntry{Name: "clauuus"}}
	term := &TerminalSession{ID: "term-1", launchedAt: time.Now()}

	tty, err := pty.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tty.Close() })
	term.tty = tty
	return m, s, term, emitter
}

func acked(e *fakeEmitter, key string) bool {
	p := lastAttention(e, key)
	return p != nil && p["acked"] == true
}

// attentionsFor counts how many times the app has said something about one wait.
func attentionsFor(e *fakeEmitter, key string) int {
	e.mu.Lock()
	defer e.mu.Unlock()
	n := 0
	for i, name := range e.events {
		if name == EventAttention && e.payloads[i] != nil && e.payloads[i]["key"] == key {
			n++
		}
	}
	return n
}

// The whole point of the ✕ and of the button beside it: a person who has dealt
// with a wait has dealt with it, and looking at the agent must not be what
// brings the notification back.
//
// It used to be. A stage's wait is the CLI drawing nothing, opening the terminal
// tells the CLI how big the window is, and a TUI redraws itself when it is
// resized — so the silence broke, the wait came down, and forty-five seconds
// later it went up again about the very thing the person had just been looking
// at. For as long as the agent stood there.
func TestLookingAtAWaitDoesNotBringItBack(t *testing.T) {
	m, s, term, emitter := waitingStage(t)

	m.raiseStageWait(s, term, true)
	if acked(emitter, term.ID) {
		t.Fatal("a wait nobody has seen arrived already acknowledged")
	}

	m.AckAttention(term.ID)
	if !acked(emitter, term.ID) {
		t.Fatal("acknowledging the wait was not said back, so other windows keep drawing it")
	}

	// Somebody opened the terminal: the window tells the CLI its size and the
	// CLI repaints, which ends the silence and starts it again.
	if err := term.Resize(100, 40); err != nil {
		t.Fatal(err)
	}
	term.publish([]byte("\x1b[2J redrawn "))
	m.raiseStageWait(s, term, false)
	m.raiseStageWait(s, term, true)

	if !acked(emitter, term.ID) {
		t.Error("the wait was announced again after somebody had just looked at it")
	}
	// And it is still a wait: the card keeps its amber button, because the agent
	// really is still standing there.
	if p := lastAttention(emitter, term.ID); p == nil || p["awaiting"] != true {
		t.Errorf("acknowledging the wait took it off the card too: %v", p)
	}
}

// The other half, and the reason the ack is dropped by anything at all: an agent
// that came back to life, did something and stopped again is asking a new
// question. That one a person wants to hear about.
func TestAnAgentThatComesBackToLifeIsAnnouncedAgain(t *testing.T) {
	m, s, term, emitter := waitingStage(t)

	m.raiseStageWait(s, term, true)
	m.AckAttention(term.ID)

	// Long enough after the last resize that the output cannot be the repaint it
	// provoked — which is the only thing that separates the CLI working from the
	// CLI being looked at.
	term.mu.Lock()
	term.resizedAt = time.Now().Add(-time.Minute)
	term.mu.Unlock()
	term.publish([]byte("running the tests\n"))

	m.raiseStageWait(s, term, false)
	m.raiseStageWait(s, term, true)

	if acked(emitter, term.ID) {
		t.Error("the agent worked and stopped again, and nobody was told")
	}
}

// An acknowledgement is of one wait and must not outlive it: the next stage to
// run in this terminal is a different piece of work, and it starts with nobody
// having been told anything.
func TestTheAcknowledgementDoesNotOutliveTheStage(t *testing.T) {
	m, s, term, emitter := waitingStage(t)

	m.raiseStageWait(s, term, true)
	m.AckAttention(term.ID)
	if !m.ackStanding(term.ID) {
		t.Fatal("the acknowledgement was not recorded")
	}

	// What watchStageQuiet does on its way out, however the stage ended.
	m.clearAck(term.ID)

	m.raiseStageWait(s, term, true)
	if acked(emitter, term.ID) {
		t.Error("the next stage in this terminal started already waved away")
	}
}

// The same thing with the real machinery behind it: a card on a route, a CLI in
// a pty, and watchStageQuiet deciding on its own when the silence has broken and
// come back. The unit tests above pin the rule; this one is the proof that the
// watcher honours it, because the watcher is what was announcing every
// forty-five seconds.
func TestTheWatcherDoesNotAnnounceAWaitTwice(t *testing.T) {
	m, _, events, _, emitter := stageManager(t, "echo working; sleep 30", nil)
	m.terminalQuiet = 500 * time.Millisecond

	events.ch <- moveEvent("cardQuiet", "opt-backlog", "opt-agent")
	term := liveStageTerminal(t, m, "cardQuiet")

	waitFor(t, 15*time.Second, "the card to say it is waiting", func() bool {
		p := lastAttention(emitter, term.ID)
		return p != nil && p["awaiting"] == true
	})

	m.AckAttention(term.ID)
	// The ack is said back on the same record, so the raise this test is about
	// has to be told apart from it — and not by the timestamp, which is whole
	// seconds. Counting is what says the watcher spoke: it takes the wait down
	// and puts it up again, which is two more than are here now.
	said := attentionsFor(emitter, term.ID)

	// Somebody opened the terminal: the window says how big it is and the CLI
	// repaints. The watcher sees output, takes the wait down, and puts it back
	// up half a second later — which is the moment this is all about.
	if err := term.Resize(120, 40); err != nil {
		t.Fatal(err)
	}
	term.publish([]byte("\x1b[2J redrawn "))

	waitFor(t, 15*time.Second, "the watcher to raise the wait again", func() bool {
		p := lastAttention(emitter, term.ID)
		return attentionsFor(emitter, term.ID) >= said+2 && p["awaiting"] == true
	})
	if p := lastAttention(emitter, term.ID); p["acked"] != true {
		t.Errorf("the watcher announced a wait the person had just looked at: %v", p)
	}
}

// A question is the other kind of wait, and it is keyed by its own id rather
// than by a terminal — so acknowledging one must reach it too, or the ✕ on a
// deploy's question would do nothing.
func TestAQuestionCanBeAcknowledgedToo(t *testing.T) {
	emitter := &fakeEmitter{}
	m := &Manager{ui: emitter}
	q := Question{ID: "q1", CardID: "card-1", BoardID: "board-1", Text: "Выкатывать?", AskedAt: time.Now()}
	m.questions = map[string]*pendingQuestion{q.ID: {q: q, reply: make(chan Answer, 1)}}

	m.emitQuestion(q, true)
	m.AckAttention("q:" + q.ID)

	if !acked(emitter, "q:"+q.ID) {
		t.Error("acknowledging a question was not said back")
	}
	for _, a := range m.Attention() {
		if a.Key == "q:"+q.ID && !a.Acked {
			t.Error("a page opening now would announce a question somebody has already seen")
		}
	}
}
