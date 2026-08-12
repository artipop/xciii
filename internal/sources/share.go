package sources

import (
	"strings"
	"time"
)

// The share sheet, as this package sees it.
//
// What the system's «Поделиться» hands over is one link and a title, from an
// app that knows nothing about boards — so it arrives here exactly as a phone's
// notification does, and takes the same path: rules, «Входящие», an author of
// its own, the event log, and the same record that keeps a repeat from becoming
// a second card. That is the whole reason it is a source and not a third way
// into the board.
//
// The one thing it does differently is name its board, because a person is
// looking at the dialog when it happens — see SourceEntry.PickBoard.

// ShareSourceName is what the share sheet is called on the board and in the
// registry. A person's own word rather than "share": it is what they will read
// as the author of every card that arrived this way.
const ShareSourceName = "Поделиться"

// ShareSource is the registry entry the share sheet delivers under, made the
// first time anything is shared. BoardID is the board the dialog offered first
// and nothing more — every item names its own.
//
// It carries no rules, so nothing is claimed and everything lands in
// «Входящие», which is what a link somebody sent to themselves is: something to
// look at, not something with a place already decided.
func ShareSource(boardID string) SourceEntry {
	return SourceEntry{
		Name:      ShareSourceName,
		BoardID:   boardID,
		Global:    true,
		Enabled:   true,
		PickBoard: true,
		// A share that is repeated is a person sharing again, and a comment on
		// the old card is a better answer than a second one.
		Update: UpdateComment,
	}
}

// ShareItem is what the dialog sends: a link, what it was called, and whatever
// the person typed before pressing the button.
//
// A shared link identifies itself by the link and the board it went to, so
// sharing the same page to that board again is the same item and the pipeline
// skips it — the card is already in the inbox, and a second one saying the same
// thing is what makes an inbox worth ignoring. The dialog reports that back
// rather than swallowing it, since a button that appears to do nothing is worse
// than one that says the thing is already there. Sharing to *another* board is
// a different item, which is what a person means by doing it.
//
// Anything without a link — a selection of text — falls back to the hash of
// what it says (WithFallbackID), which is the same rule every other source
// without ids of its own gets.
func ShareItem(boardID, title, url, note string) Item {
	title = strings.TrimSpace(title)
	url = strings.TrimSpace(url)
	boardID = strings.TrimSpace(boardID)
	if title == "" {
		// A card called «Без названия» says nothing; the link says where it
		// goes, which is the whole of what was shared.
		title = url
	}
	it := Item{
		Title:   title,
		Body:    strings.TrimSpace(note),
		URL:     url,
		BoardID: boardID,
		At:      time.Now(),
	}
	if url != "" {
		it.ExternalID = "share:" + boardID + "|" + url
	}
	return it.WithFallbackID()
}
