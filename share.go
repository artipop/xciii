package main

import (
	"net/url"
	"strings"
)

// The system's «Поделиться», as this side of it works.
//
// The share extension inside the .app knows nothing about boards and never
// touches the network: it takes what was shared and opens
// `xciii://share?url=…&title=…`. Everything after that is here — a small window
// of ours on our own page, which is the only place that already has the board,
// the registry and a session. See docs/sources.md §24 for why the extension is
// that thin: it is a sandboxed process of its own, and giving it the board
// would mean giving it an address and a token, which means an App Group and a
// developer team, for a dialog we can draw ourselves.
//
// The scheme is registered in build/darwin/Info.plist (CFBundleURLTypes). Wails
// catches a launch-by-URL and hands it to the instance already running, so what
// arrives here is the URL and nothing else.

// shareScheme is the URL scheme the share extension opens. Registered in
// Info.plist; anything else arriving on it is ignored rather than guessed at.
const shareScheme = "xciii"

// shareWindowName names the window so a second share focuses the one already
// open instead of stacking dialogs — the same arrangement the terminal windows
// have, for the same reason.
const shareWindowName = "share"

// shareRequest is what was shared: a link, what the sharing app called it, and
// whatever text came with it (a selection, usually).
type shareRequest struct {
	URL   string
	Title string
	Text  string
}

// IsEmpty reports whether there is nothing to share. A share sheet that opens
// an empty dialog is worse than one that does nothing: the person has already
// been told, by the sheet closing, that something happened.
func (s shareRequest) IsEmpty() bool {
	return strings.TrimSpace(s.URL) == "" &&
		strings.TrimSpace(s.Title) == "" &&
		strings.TrimSpace(s.Text) == ""
}

// Query is the request as the page reads it, which is where it is read from:
// the dialog takes its input from the address, so the same page works when the
// app opens it, when a phone opens it and when somebody types it.
func (s shareRequest) Query() string {
	values := url.Values{}
	for key, value := range map[string]string{"url": s.URL, "title": s.Title, "text": s.Text} {
		if strings.TrimSpace(value) != "" {
			values.Set(key, value)
		}
	}
	if len(values) == 0 {
		return ""
	}
	return "?" + values.Encode()
}

// parseShareURL reads `xciii://share?url=…&title=…&text=…`.
//
// Both shapes are accepted — `xciii://share?…`, where "share" is the host, and
// `xciii:///share?…`, where it is the path — because which one a URL ends up
// with depends on how whoever built it joined the pieces, and refusing one of
// them would be a bug that only ever appears on somebody else's machine.
func parseShareURL(raw string) (shareRequest, bool) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || !strings.EqualFold(parsed.Scheme, shareScheme) {
		return shareRequest{}, false
	}
	action := parsed.Host
	if action == "" {
		action = strings.Trim(parsed.Path, "/")
	}
	if !strings.EqualFold(action, "share") {
		return shareRequest{}, false
	}
	query := parsed.Query()
	req := shareRequest{
		URL:   query.Get("url"),
		Title: query.Get("title"),
		Text:  query.Get("text"),
	}
	if req.IsEmpty() {
		return shareRequest{}, false
	}
	return req, true
}

// shareURLFrom finds the share URL among a launch's arguments. macOS delivers a
// URL launch as an Apple Event rather than in argv, and Wails puts what it
// caught at the end of Args — so this reads the whole list rather than a
// position, and answers for a plain `xciii://…` on the command line too.
func shareURLFrom(args []string) (shareRequest, bool) {
	for _, arg := range args {
		if req, ok := parseShareURL(arg); ok {
			return req, true
		}
	}
	return shareRequest{}, false
}

// openShare opens the dialog for what was shared, in a window of the app's own.
// It is the whole of what a share launch does.
func (a *App) openShare(req shareRequest) {
	wapp := a.app()
	if wapp == nil || req.IsEmpty() {
		return
	}
	openShareWindow(wapp, a.originURL()+"share"+req.Query())
}

// CloseShareWindow shuts the dialog. It is a binding because the window is the
// app's own rather than one the page opened, and a page may not close what it
// did not open.
func (a *App) CloseShareWindow() error {
	if wapp := a.app(); wapp != nil {
		closeShareWindow(wapp)
	}
	return nil
}
