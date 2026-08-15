package main

import (
	"strings"
	"testing"

	"github.com/artipop/xciii/internal/acp"
)

func keys(waits []acp.Attention) []string {
	out := make([]string, 0, len(waits))
	for _, a := range waits {
		out = append(out, a.Key)
	}
	return out
}

// The point of the whole feature: an agent that stops to ask something reaches
// somebody who is not looking at the board.
func TestAWaitNobodyHasHeardOfIsAnnounced(t *testing.T) {
	fresh, stale := alertPlan(map[string]bool{}, []acp.Attention{{Key: "t1", Title: "Почини логин"}})
	if got := keys(fresh); len(got) != 1 || got[0] != "t1" {
		t.Fatalf("fresh = %v, want the one wait", got)
	}
	if len(stale) != 0 {
		t.Fatalf("stale = %v, want nothing to take down", stale)
	}
}

// Said once. A notification that comes back every time the manager re-reports
// the same wait is the spam the acknowledgement was built to end
// (internal/acp/attentionack.go), and it would come back here instead.
func TestAWaitAlreadyAnnouncedIsNotAnnouncedAgain(t *testing.T) {
	waiting := []acp.Attention{{Key: "t1"}}
	fresh, stale := alertPlan(map[string]bool{"t1": true}, waiting)
	if len(fresh) != 0 || len(stale) != 0 {
		t.Fatalf("fresh = %v, stale = %v, want neither", keys(fresh), stale)
	}
}

// Being told is one act wherever it happens. A person who waved the
// notification away on the board, on a second window or on their phone has been
// told, and the copy standing in the notification centre has to go with it.
func TestAnAcknowledgedWaitTakesItsNotificationDown(t *testing.T) {
	fresh, stale := alertPlan(map[string]bool{"t1": true}, []acp.Attention{{Key: "t1", Acked: true}})
	if len(fresh) != 0 {
		t.Fatalf("fresh = %v, want nothing announced again", keys(fresh))
	}
	if len(stale) != 1 || stale[0] != "t1" {
		t.Fatalf("stale = %v, want the acknowledged wait", stale)
	}
}

// An agent that was answered is not still asking, and a notification saying it
// is outlives the truth.
func TestAWaitThatEndedTakesItsNotificationDown(t *testing.T) {
	_, stale := alertPlan(map[string]bool{"t1": true}, nil)
	if len(stale) != 1 || stale[0] != "t1" {
		t.Fatalf("stale = %v, want the wait that ended", stale)
	}
}

// The acknowledgement is dropped when the CLI does a turn and stops again,
// because that is a new question. It has to reach a person as one.
func TestAWaitRaisedAgainIsAnnouncedAgain(t *testing.T) {
	// Acknowledged: the notification comes down and this side forgets it.
	_, stale := alertPlan(map[string]bool{"t1": true}, []acp.Attention{{Key: "t1", Acked: true}})
	told := map[string]bool{"t1": true}
	for _, key := range stale {
		delete(told, key)
	}
	fresh, _ := alertPlan(told, []acp.Attention{{Key: "t1"}})
	if got := keys(fresh); len(got) != 1 || got[0] != "t1" {
		t.Fatalf("fresh = %v, want the wait announced afresh", got)
	}
}

// What a notification has to carry is which agent and which card: the person
// reading it is somewhere else entirely and has neither in front of them.
func TestANotificationNamesTheAgentAndTheCard(t *testing.T) {
	a := acp.Attention{Key: "t1", Agent: "клаус", Title: "Почини логин", Text: "агент ждёт ответа в терминале"}
	if got := alertTitle(a); got != "клаус спрашивает" {
		t.Errorf("title = %q", got)
	}
	if got := alertBody(a); !strings.Contains(got, "Почини логин") || !strings.Contains(got, "ждёт ответа") {
		t.Errorf("body = %q, want the card and the question", got)
	}
}

// A conversation with no card behind it can still be waiting, and a notification
// with an empty body says nothing at all.
func TestAWaitWithNothingToQuoteStillSaysWhatToDo(t *testing.T) {
	if got := alertBody(acp.Attention{Key: "t1"}); got == "" {
		t.Fatal("a wait with no card and no question should still say something")
	}
}

// A menu of the menu bar is read standing up: a card whose title is a paragraph
// must not make the menu as wide as the screen.
func TestALongCardTitleIsClippedInTheMenu(t *testing.T) {
	long := strings.Repeat("длинный заголовок ", 20)
	got := alertMenuLabel(acp.Attention{Key: "t1", Agent: "клаус", Title: long})
	if n := len([]rune(got)); n > 64 {
		t.Fatalf("label is %d runes: %q", n, got)
	}
	if !strings.HasSuffix(got, "…") {
		t.Errorf("a clipped label should say it was clipped: %q", got)
	}
}
