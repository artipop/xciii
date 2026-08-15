package main

import (
	"strconv"
	"strings"

	"github.com/artipop/xciii/internal/acp"
)

// What a person is told when they are not looking at the board.
//
// A wait already says itself twice: the card grows an amber button, and the page
// draws a notification of its own (attentionNotifications.tsx). Both of those
// need somebody to be looking at a window — and the case this is for is the one
// where nobody is: the app is minimised, hidden behind an editor, or the person
// is in another space entirely. So the same wait goes out through the two
// surfaces the desktop keeps for exactly that, the OS notification centre and
// the menu bar (alerts_desktop.go).
//
// The two are not the same kind of thing, and the setting is what separates
// them. **The dot in the menu bar is an indicator**, like the card's amber
// button: it is drawn while an agent is waiting and it interrupts nobody, so it
// is not a setting and it stands whether notifications are on or off. **A
// notification interrupts**, so it is the switch — «Уведомлять, когда агент
// ждёт», the one the page already had, and reading it here rather than adding a
// second one is what keeps "tell me" a single answer (uisettings.go).
//
// This file is the part with no window in it, so that the decision can be
// tested without an application: everything below is a pure function of the
// waits and of what a person has already been told.

// alertPlan works out what a change in the waiting list means for the
// notifications standing in the OS notification centre.
//
// told is the keys that have one; waiting is what the manager says is still
// waiting. fresh is what nobody has been told about yet, stale is what is
// standing for a wait that has ended or been acknowledged and should come down.
//
// Acknowledged waits are stale rather than absent, which is the whole reason
// this is not a set difference: a person who waved the notification away on
// another window, or on their phone, has been told (internal/acp/attentionack.go)
// — but the wait itself stands, and so does the dot.
func alertPlan(told map[string]bool, waiting []acp.Attention) (fresh []acp.Attention, stale []string) {
	live := make(map[string]bool, len(waiting))
	for _, a := range waiting {
		if a.Acked || a.Key == "" {
			continue
		}
		live[a.Key] = true
		if !told[a.Key] {
			fresh = append(fresh, a)
		}
	}
	for key := range told {
		if !live[key] {
			stale = append(stale, key)
		}
	}
	return fresh, stale
}

// alertTitle is who is asking — the same sentence the card and the page's own
// notification use (attentionHeading in attention.ts), so one wait reads the
// same wherever a person meets it.
func alertTitle(a acp.Attention) string {
	if a.Agent != "" {
		return a.Agent + " спрашивает"
	}
	return "Агент спрашивает"
}

// alertBody is what is being asked, in one line: the card it is about and the
// question itself. The subtitle field is deliberately unused — Windows drops it
// — and the card is the fact that identifies the wait, so it goes in the body
// where every platform shows it.
func alertBody(a acp.Attention) string {
	parts := make([]string, 0, 2)
	if title := strings.TrimSpace(a.Title); title != "" {
		parts = append(parts, title)
	}
	if text := strings.TrimSpace(a.Text); text != "" {
		parts = append(parts, text)
	}
	if len(parts) == 0 {
		return "Откройте терминал, чтобы ответить."
	}
	return strings.Join(parts, " — ")
}

// alertMenuLabel is one waiting agent as a line of the menu bar's menu. It is
// clipped rather than wrapped: a menu that is as wide as somebody's card title
// is a menu that covers the screen.
func alertMenuLabel(a acp.Attention) string {
	label := alertTitle(a)
	if title := strings.TrimSpace(a.Title); title != "" {
		label += ": " + title
	}
	return clipLabel(label, 64)
}

// hiddenWaitsLabel stands for the waits the menu stopped naming. It counts and
// does not inflect: «ждут»/«ждёт» would have to agree with the number, and the
// number is the whole of what this line says.
func hiddenWaitsLabel(n int) string {
	return "…и ещё " + strconv.Itoa(n)
}

// clipLabel cuts to n runes, not bytes: every label here is Russian.
func clipLabel(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return strings.TrimRight(string(runes[:n-1]), " ") + "…"
}
