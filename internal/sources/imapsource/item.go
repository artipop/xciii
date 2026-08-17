package imapsource

import (
	"bytes"
	"fmt"
	"io"
	"regexp"
	"strings"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-message/mail"

	"github.com/artipop/xciii/sources/sdk"
)

// itemFrom turns one fetched message into what the pipeline understands.
//
// ExternalID is the message's own Message-ID, stripped of the angle
// brackets the header carries it in — a value the message brought with it
// rather than one this plugin invented, so the same mail seen through two
// mailboxes (a forward, a shared account) still claims to be itself. A
// message with no Message-ID, which happens, falls back to its UID inside
// this mailbox.
//
// Version equals ExternalID: mail content never changes once delivered, so
// there is nothing for the pipeline's "comment on a changed item" policy to
// react to. That is correct, not a gap.
func itemFrom(m fetchedMessage, mailbox string) sdk.Item {
	id := strings.Trim(m.Envelope.MessageID, "<>")
	if id == "" {
		id = fmt.Sprintf("%s:%d", mailbox, m.UID)
	}

	item := sdk.Item{
		ExternalID: id,
		Version:    id,
		Title:      m.Envelope.Subject,
		At:         m.Envelope.Date,
		Props: map[string]string{
			"mailbox": mailbox,
			"from":    addressList(m.Envelope.From),
			"to":      addressList(m.Envelope.To),
		},
	}
	if body, ok := textBody(m.Raw); ok {
		item.Body = body
	}
	for _, f := range m.Flags {
		if f == imap.FlagFlagged {
			item.Labels = append(item.Labels, "flagged")
		}
	}
	return item
}

func addressList(addrs []imap.Address) string {
	if len(addrs) == 0 {
		return ""
	}
	parts := make([]string, len(addrs))
	for i := range addrs {
		parts[i] = addrs[i].Addr()
	}
	return strings.Join(parts, ", ")
}

// textBody picks the message's own text/plain part, or a stripped text/html
// one when that is all there is — Item.Body is markdown-to-be, and a raw
// HTML part read verbatim into a card is not that.
func textBody(raw []byte) (string, bool) {
	if len(raw) == 0 {
		return "", false
	}
	r, err := mail.CreateReader(bytes.NewReader(raw))
	if err != nil {
		return "", false
	}
	defer r.Close()

	var plain, html string
	for {
		part, err := r.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			break
		}
		header, ok := part.Header.(*mail.InlineHeader)
		if !ok {
			continue // an attachment, not a text part.
		}
		contentType, _, _ := header.ContentType()
		body, err := io.ReadAll(part.Body)
		if err != nil {
			continue
		}
		switch {
		case plain == "" && strings.HasPrefix(contentType, "text/plain"):
			plain = string(body)
		case html == "" && strings.HasPrefix(contentType, "text/html"):
			html = string(body)
		}
	}

	if plain != "" {
		return strings.TrimSpace(plain), true
	}
	if html != "" {
		return stripTags(html), true
	}
	return "", false
}

var tagPattern = regexp.MustCompile(`<[^>]*>`)

func stripTags(html string) string {
	return strings.TrimSpace(tagPattern.ReplaceAllString(html, ""))
}
