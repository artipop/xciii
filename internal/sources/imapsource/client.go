package imapsource

import (
	"context"
	"fmt"
	"net"
	"sort"
	"strconv"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
)

// mailboxClient is the one mailbox open for a poll. Poll talks to this
// interface and nothing else, which is what lets its logic — the baseline,
// the cursor advance, a UIDVALIDITY reset, error classification — be driven
// by a fake in tests instead of a real server, the same seam
// internal/vcs/github.go uses an injected *http.Client for.
type mailboxClient interface {
	// Select opens the mailbox and reports its UIDVALIDITY and UIDNEXT.
	Select(mailbox string) (uidValidity uint32, uidNext uint32, err error)
	// SearchFrom returns the UIDs of every message with UID >= from.
	SearchFrom(from uint32) ([]uint32, error)
	// Fetch returns the envelope, flags and raw RFC 822 body of each UID.
	Fetch(uids []uint32) ([]fetchedMessage, error)
	Close() error
}

// fetchedMessage is one message as the server gave it, before item.go turns
// it into what the pipeline understands.
type fetchedMessage struct {
	UID      uint32
	Envelope imap.Envelope
	Flags    []imap.Flag
	Raw      []byte
}

// connConfig is what dialing needs: the manifest's fields plus the one
// credential a source of auth type "token" is handed.
type connConfig struct {
	Host     string
	Port     int
	Username string
	Password string
}

// dialFunc opens a mailbox. Plugin() runs with dialIMAP; a test runs with a
// fake that never touches the network.
type dialFunc func(ctx context.Context, cfg connConfig) (mailboxClient, error)

// loginError marks a failed LOGIN apart from every other way dialing can
// fail: a bad password needs a person, a network hiccup does not.
type loginError struct{ err error }

func (e loginError) Error() string { return e.err.Error() }
func (e loginError) Unwrap() error { return e.err }

// dialIMAP is the dialFunc a real poll runs with: implicit TLS on the usual
// port, STARTTLS everywhere else — a plain, unencrypted IMAP session is not
// offered, since the one thing carried over it is a password.
func dialIMAP(_ context.Context, cfg connConfig) (mailboxClient, error) {
	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))

	var (
		client *imapclient.Client
		err    error
	)
	if cfg.Port == 993 {
		client, err = imapclient.DialTLS(addr, nil)
	} else {
		client, err = imapclient.DialStartTLS(addr, nil)
	}
	if err != nil {
		return nil, fmt.Errorf("подключение к %s: %w", addr, err)
	}

	if err := client.Login(cfg.Username, cfg.Password).Wait(); err != nil {
		_ = client.Close()
		return nil, loginError{err}
	}
	return &imapMailbox{client: client}, nil
}

type imapMailbox struct {
	client *imapclient.Client
}

func (m *imapMailbox) Select(mailbox string) (uint32, uint32, error) {
	data, err := m.client.Select(mailbox, nil).Wait()
	if err != nil {
		return 0, 0, err
	}
	return data.UIDValidity, uint32(data.UIDNext), nil
}

func (m *imapMailbox) SearchFrom(from uint32) ([]uint32, error) {
	var set imap.UIDSet
	set.AddRange(imap.UID(from), 0) // 0 is "*": everything from `from` up.
	data, err := m.client.UIDSearch(&imap.SearchCriteria{UID: []imap.UIDSet{set}}, nil).Wait()
	if err != nil {
		return nil, err
	}
	found := data.AllUIDs()
	out := make([]uint32, len(found))
	for i, uid := range found {
		out[i] = uint32(uid)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out, nil
}

func (m *imapMailbox) Fetch(uids []uint32) ([]fetchedMessage, error) {
	if len(uids) == 0 {
		return nil, nil
	}
	var set imap.UIDSet
	for _, uid := range uids {
		set.AddNum(imap.UID(uid))
	}
	bufs, err := m.client.Fetch(set, &imap.FetchOptions{
		Envelope:    true,
		Flags:       true,
		UID:         true,
		BodySection: []*imap.FetchItemBodySection{{}},
	}).Collect()
	if err != nil {
		return nil, err
	}

	out := make([]fetchedMessage, 0, len(bufs))
	for _, b := range bufs {
		var env imap.Envelope
		if b.Envelope != nil {
			env = *b.Envelope
		}
		out = append(out, fetchedMessage{
			UID:      uint32(b.UID),
			Envelope: env,
			Flags:    b.Flags,
			Raw:      b.FindBodySection(&imap.FetchItemBodySection{}),
		})
	}
	return out, nil
}

func (m *imapMailbox) Close() error {
	_ = m.client.Logout().Wait()
	return m.client.Close()
}
