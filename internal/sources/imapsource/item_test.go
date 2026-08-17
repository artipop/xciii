package imapsource

import (
	"strings"
	"testing"
	"time"

	"github.com/emersion/go-imap/v2"
)

func rawMessage(contentType, body string) []byte {
	return []byte("MIME-Version: 1.0\r\n" +
		"Content-Type: " + contentType + "\r\n" +
		"\r\n" + body)
}

func rawMultipart(plain, html string) []byte {
	return []byte("MIME-Version: 1.0\r\n" +
		"Content-Type: multipart/alternative; boundary=\"B\"\r\n" +
		"\r\n" +
		"--B\r\n" +
		"Content-Type: text/plain; charset=utf-8\r\n\r\n" +
		plain + "\r\n" +
		"--B\r\n" +
		"Content-Type: text/html; charset=utf-8\r\n\r\n" +
		html + "\r\n" +
		"--B--\r\n")
}

func TestItemPrefersThePlainTextPartOverHTML(t *testing.T) {
	m := fetchedMessage{
		UID:      1,
		Envelope: imap.Envelope{Subject: "Тема", MessageID: "<a@example.com>"},
		Raw:      rawMultipart("Обычный текст", "<p>HTML текст</p>"),
	}

	item := itemFrom(m, "INBOX")

	if item.Body != "Обычный текст" {
		t.Fatalf("expected the plain-text part, got %q", item.Body)
	}
}

func TestItemFallsBackToStrippedHTMLWhenThereIsNoPlainText(t *testing.T) {
	m := fetchedMessage{
		UID:      1,
		Envelope: imap.Envelope{Subject: "Тема", MessageID: "<a@example.com>"},
		Raw:      rawMessage(`text/html; charset=utf-8`, "<p>Только <b>HTML</b></p>"),
	}

	item := itemFrom(m, "INBOX")

	if strings.ContainsAny(item.Body, "<>") {
		t.Fatalf("tags must be stripped from an HTML-only body, got %q", item.Body)
	}
	if !strings.Contains(item.Body, "Только") || !strings.Contains(item.Body, "HTML") {
		t.Fatalf("the text itself must survive stripping, got %q", item.Body)
	}
}

func TestAMessageWithNoMessageIDFallsBackToItsMailboxAndUID(t *testing.T) {
	// Message-ID is what lets the same message survive being seen twice
	// without becoming a second card; a message that never had one still
	// needs a stable id, and the mailbox/UID pair it arrived under is the
	// only thing that qualifies.
	m := fetchedMessage{UID: 42, Envelope: imap.Envelope{Subject: "Без Message-ID"}}

	item := itemFrom(m, "Работа")

	if item.ExternalID != "Работа:42" {
		t.Fatalf("expected a mailbox:uid fallback id, got %q", item.ExternalID)
	}
	if item.Version != item.ExternalID {
		t.Fatalf("mail is immutable, so Version must equal ExternalID, got %q vs %q", item.Version, item.ExternalID)
	}
}

func TestMessageIDAnglesAreStrippedFromTheItemID(t *testing.T) {
	m := fetchedMessage{UID: 1, Envelope: imap.Envelope{MessageID: "<abc123@mail.example.com>"}}

	item := itemFrom(m, "INBOX")

	if item.ExternalID != "abc123@mail.example.com" {
		t.Fatalf("got %q, want the header value without angle brackets", item.ExternalID)
	}
}

func TestFlaggedMessagesCarryALabel(t *testing.T) {
	flagged := itemFrom(fetchedMessage{UID: 1, Flags: []imap.Flag{imap.FlagFlagged}}, "INBOX")
	plain := itemFrom(fetchedMessage{UID: 2}, "INBOX")

	if len(flagged.Labels) != 1 || flagged.Labels[0] != "flagged" {
		t.Fatalf("a \\Flagged message should carry the flagged label, got %v", flagged.Labels)
	}
	if len(plain.Labels) != 0 {
		t.Fatalf("a message with no flags should carry no labels, got %v", plain.Labels)
	}
}

func TestItemPropsCarryTheSenderRecipientAndMailbox(t *testing.T) {
	m := fetchedMessage{
		UID: 1,
		Envelope: imap.Envelope{
			From: []imap.Address{{Mailbox: "boss", Host: "example.com"}},
			To:   []imap.Address{{Mailbox: "me", Host: "example.com"}},
			Date: time.Date(2026, 8, 10, 9, 0, 0, 0, time.UTC),
		},
	}

	item := itemFrom(m, "Входящие")

	if item.Props["from"] != "boss@example.com" {
		t.Fatalf("got from=%q", item.Props["from"])
	}
	if item.Props["to"] != "me@example.com" {
		t.Fatalf("got to=%q", item.Props["to"])
	}
	if item.Props["mailbox"] != "Входящие" {
		t.Fatalf("got mailbox=%q", item.Props["mailbox"])
	}
	if !item.At.Equal(m.Envelope.Date) {
		t.Fatalf("At must be the envelope's own Date, got %v", item.At)
	}
}
