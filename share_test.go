package main

import "testing"

// What the share extension opens has to be understood exactly as it was
// written, because the extension is the one part of this that cannot be
// debugged from here: it is a process the system starts, and everything it
// says arrives as this one string.
func TestAShareURLIsReadAsItWasWritten(t *testing.T) {
	req, ok := parseShareURL("xciii://share?url=https%3A%2F%2Fexample.com%2Fa&title=%D0%A1%D1%82%D0%B0%D1%82%D1%8C%D1%8F&text=%D0%BA%D1%83%D1%81%D0%BE%D0%BA")
	if !ok {
		t.Fatal("a share URL must be understood")
	}
	if req.URL != "https://example.com/a" || req.Title != "Статья" || req.Text != "кусок" {
		t.Fatalf("request: %+v", req)
	}

	// Which of the two shapes a URL ends up with depends on how whoever built
	// it joined the pieces, and a bug that only appears on another machine is
	// the worst kind there is.
	if _, ok := parseShareURL("xciii:///share?url=https://example.com/a"); !ok {
		t.Fatal("a path-shaped share URL must be understood too")
	}
}

// The scheme is ours and the app is launched by it, so anything else arriving
// on it is somebody else's idea and is ignored rather than guessed at.
func TestAnythingButAShareIsIgnored(t *testing.T) {
	for _, raw := range []string{
		"https://example.com/a",   // not our scheme
		"xciii://open?board=1",    // not an action we have
		"xciii://share",           // nothing shared
		"xciii://share?title=%20", // nothing but whitespace
		"",                        // nothing at all
		"xciii://share?url=%zz",   // a URL that will not parse
	} {
		if _, ok := parseShareURL(raw); ok {
			t.Errorf("%q should not open the share dialog", raw)
		}
	}
}

// macOS delivers a URL launch as an Apple Event rather than in argv, and Wails
// appends what it caught to the end of the arguments — so the URL is looked for
// rather than expected in a position.
func TestTheShareURLIsFoundWhereverItIsInTheArguments(t *testing.T) {
	req, ok := shareURLFrom([]string{"/Applications/XCIII.app/Contents/MacOS/XCIII", "xciii://share?url=https://example.com/a"})
	if !ok || req.URL != "https://example.com/a" {
		t.Fatalf("request: %+v, ok=%v", req, ok)
	}
	if _, ok := shareURLFrom([]string{"/Applications/XCIII.app/Contents/MacOS/XCIII"}); ok {
		t.Fatal("an ordinary launch must open the board, not the share dialog")
	}
}

// The dialog reads what was shared out of the address it was opened at, so the
// query has to survive the round trip — a title with a space in it is the
// ordinary case, not an edge one.
func TestWhatWasSharedSurvivesTheTripToThePage(t *testing.T) {
	req := shareRequest{URL: "https://example.com/a?x=1&y=2", Title: "Заголовок с пробелом"}
	round, ok := parseShareURL("xciii://share" + req.Query())
	if !ok {
		t.Fatal("the query the page is opened with must parse back")
	}
	if round.URL != req.URL || round.Title != req.Title {
		t.Fatalf("round trip: %+v", round)
	}

	// Nothing shared is nothing to ask about, and an empty query keeps the
	// dialog from opening on an empty form.
	if got := (shareRequest{}).Query(); got != "" {
		t.Fatalf("query: %q", got)
	}
}
