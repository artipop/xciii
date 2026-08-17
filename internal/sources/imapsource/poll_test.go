package imapsource

import (
	"context"
	"errors"
	"sort"
	"testing"

	"github.com/emersion/go-imap/v2"

	"github.com/artipop/xciii/sources/protocol"
	"github.com/artipop/xciii/sources/sdk"
)

// fakeMailbox is a mailboxClient with no network under it, so Poll's own
// logic — the baseline, the cursor advance, a UIDVALIDITY reset — can be
// driven directly (compare internal/vcs/github.go's httptest-backed tests).
type fakeMailbox struct {
	uidValidity uint32
	uidNext     uint32
	messages    map[uint32]fetchedMessage

	selectErr error
	searchErr error
	fetchErr  error

	closed bool
}

func (f *fakeMailbox) Select(string) (uint32, uint32, error) {
	if f.selectErr != nil {
		return 0, 0, f.selectErr
	}
	return f.uidValidity, f.uidNext, nil
}

func (f *fakeMailbox) SearchFrom(from uint32) ([]uint32, error) {
	if f.searchErr != nil {
		return nil, f.searchErr
	}
	var uids []uint32
	for uid := range f.messages {
		if uid >= from {
			uids = append(uids, uid)
		}
	}
	sort.Slice(uids, func(i, j int) bool { return uids[i] < uids[j] })
	return uids, nil
}

func (f *fakeMailbox) Fetch(uids []uint32) ([]fetchedMessage, error) {
	if f.fetchErr != nil {
		return nil, f.fetchErr
	}
	out := make([]fetchedMessage, 0, len(uids))
	for _, uid := range uids {
		if m, ok := f.messages[uid]; ok {
			out = append(out, m)
		}
	}
	return out, nil
}

func (f *fakeMailbox) Close() error {
	f.closed = true
	return nil
}

func dialing(mb mailboxClient, err error) dialFunc {
	return func(context.Context, connConfig) (mailboxClient, error) {
		if err != nil {
			return nil, err
		}
		return mb, nil
	}
}

func validReq(cursor string) sdk.PollRequest {
	return sdk.PollRequest{
		Config:      map[string]string{"host": "imap.example.com", "username": "alice", "mailbox": "INBOX"},
		Credentials: protocol.Credentials{AccessToken: "secret"},
		Cursor:      cursor,
	}
}

func TestAFreshSourceStartsFromTheBaselineRatherThanImportingABacklog(t *testing.T) {
	mb := &fakeMailbox{
		uidValidity: 7,
		uidNext:     6,
		messages: map[uint32]fetchedMessage{
			1: {UID: 1, Envelope: envelope("Старое письмо 1")},
			5: {UID: 5, Envelope: envelope("Старое письмо 5")},
		},
	}

	result, err := poll(context.Background(), dialing(mb, nil), validReq(""))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.Items) != 0 {
		t.Fatalf("a source that was just added must not import what was already in the mailbox, got %d items", len(result.Items))
	}

	c, ok := decodeCursor(result.Cursor)
	if !ok {
		t.Fatalf("the first poll must still return a usable cursor")
	}
	if c.UIDValidity != 7 || c.LastUID != 5 {
		t.Fatalf("baseline cursor should sit at uidNext-1, got %+v", c)
	}
	if !mb.closed {
		t.Fatalf("the mailbox connection must be closed after a poll")
	}
}

func TestALaterPollOnlyReturnsMessagesNewerThanTheCursor(t *testing.T) {
	mb := &fakeMailbox{
		uidValidity: 7,
		uidNext:     8,
		messages: map[uint32]fetchedMessage{
			5: {UID: 5, Envelope: envelope("До курсора — не должно вернуться")},
			6: {UID: 6, Envelope: envelope("Новое письмо 6")},
			7: {UID: 7, Envelope: envelope("Новое письмо 7")},
		},
	}
	cursor := cursor{UIDValidity: 7, LastUID: 5}.encode()

	result, err := poll(context.Background(), dialing(mb, nil), validReq(cursor))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.Items) != 2 {
		t.Fatalf("expected the two messages after the cursor, got %d", len(result.Items))
	}
	for _, item := range result.Items {
		if item.Title == "До курсора — не должно вернуться" {
			t.Fatalf("a message at or before the cursor's UID must not be returned again")
		}
	}

	c, _ := decodeCursor(result.Cursor)
	if c.LastUID != 7 {
		t.Fatalf("the cursor must advance to the highest UID seen, got %d", c.LastUID)
	}
}

func TestAMailboxUIDValidityChangeResetsToTheBaseline(t *testing.T) {
	// The server renumbered the mailbox (recreated, migrated). Reading the
	// old cursor's UID range against the new numbering would mean something
	// else entirely, so this must behave exactly like a first poll rather
	// than dump everything currently in the mailbox as "new".
	mb := &fakeMailbox{
		uidValidity: 99,
		uidNext:     3,
		messages: map[uint32]fetchedMessage{
			1: {UID: 1, Envelope: envelope("После переисчисления")},
			2: {UID: 2, Envelope: envelope("После переисчисления 2")},
		},
	}
	oldCursor := cursor{UIDValidity: 7, LastUID: 5}.encode()

	result, err := poll(context.Background(), dialing(mb, nil), validReq(oldCursor))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.Items) != 0 {
		t.Fatalf("a UIDVALIDITY change must reset to the baseline, not surface the whole mailbox as new, got %d items", len(result.Items))
	}

	c, _ := decodeCursor(result.Cursor)
	if c.UIDValidity != 99 || c.LastUID != 2 {
		t.Fatalf("expected a fresh baseline for the new UIDVALIDITY, got %+v", c)
	}
}

func TestANoOpPollKeepsTheSameCursor(t *testing.T) {
	mb := &fakeMailbox{uidValidity: 7, uidNext: 6, messages: map[uint32]fetchedMessage{}}
	cursor := cursor{UIDValidity: 7, LastUID: 5}.encode()

	result, err := poll(context.Background(), dialing(mb, nil), validReq(cursor))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.Items) != 0 {
		t.Fatalf("nothing new arrived, so there must be no items")
	}
	if result.Cursor != cursor {
		t.Fatalf("a poll with nothing new must hand the same cursor back, got %q want %q", result.Cursor, cursor)
	}
}

func TestABadPasswordIsNeedsReauthNotRetryable(t *testing.T) {
	err := loginError{errors.New("AUTHENTICATIONFAILED")}

	_, gotErr := poll(context.Background(), dialing(nil, err), validReq(""))

	assertKind(t, gotErr, sdk.NeedsReauth("").Kind)
}

func TestANetworkFailureIsRetryable(t *testing.T) {
	_, gotErr := poll(context.Background(), dialing(nil, errors.New("connection refused")), validReq(""))

	assertKind(t, gotErr, sdk.Retryable("").Kind)
}

func TestAMissingMailboxIsBadConfigOnTheMailboxField(t *testing.T) {
	mb := &fakeMailbox{selectErr: errors.New("NO [NONEXISTENT] Unknown Mailbox")}

	_, gotErr := poll(context.Background(), dialing(mb, nil), validReq(""))

	var sdkErr *sdk.Error
	if !errors.As(gotErr, &sdkErr) {
		t.Fatalf("expected an *sdk.Error, got %v (%T)", gotErr, gotErr)
	}
	if sdkErr.Kind != sdk.BadConfig("mailbox", "").Kind || sdkErr.Field != "mailbox" {
		t.Fatalf("expected bad_config on the mailbox field, got kind=%q field=%q", sdkErr.Kind, sdkErr.Field)
	}
}

func TestAMissingHostIsBadConfigBeforeAnyDialAttempt(t *testing.T) {
	req := validReq("")
	req.Config = map[string]string{"username": "alice"}

	dialed := false
	dial := func(context.Context, connConfig) (mailboxClient, error) {
		dialed = true
		return nil, errors.New("must not be called")
	}

	_, err := poll(context.Background(), dial, req)

	if dialed {
		t.Fatalf("a config that cannot work must be refused before touching the network")
	}
	assertKind(t, err, sdk.BadConfig("host", "").Kind)
}

func TestAMissingPasswordIsNeedsReauth(t *testing.T) {
	req := validReq("")
	req.Credentials.AccessToken = ""

	_, err := poll(context.Background(), dialing(nil, errors.New("unused")), req)

	assertKind(t, err, sdk.NeedsReauth("").Kind)
}

func envelope(subject string) imap.Envelope {
	return imap.Envelope{Subject: subject}
}

func assertKind(t *testing.T, err error, want string) {
	t.Helper()
	var sdkErr *sdk.Error
	if !errors.As(err, &sdkErr) {
		t.Fatalf("expected an *sdk.Error, got %v (%T)", err, err)
	}
	if sdkErr.Kind != want {
		t.Fatalf("got kind %q, want %q (%v)", sdkErr.Kind, want, err)
	}
}
