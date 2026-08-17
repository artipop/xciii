package imapsource

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	"github.com/artipop/xciii/sources/sdk"
)

// cursor is what Poll hands back and is handed next time — opaque to the
// app, meaningful only here. UIDValidity pins it to one incarnation of the
// mailbox: a server that renumbers UIDs (the mailbox was recreated)
// invalidates it, and Poll starts over at the baseline rather than read a
// UID range that no longer means what it did.
type cursor struct {
	UIDValidity uint32 `json:"uidValidity"`
	LastUID     uint32 `json:"lastUID"`
}

func decodeCursor(raw string) (cursor, bool) {
	if raw == "" {
		return cursor{}, false
	}
	var c cursor
	if err := json.Unmarshal([]byte(raw), &c); err != nil {
		return cursor{}, false
	}
	return c, true
}

func (c cursor) encode() string {
	b, _ := json.Marshal(c)
	return string(b)
}

// poll is Plugin()'s Poll, taking the dialer as a parameter so a test can
// drive it against a fake mailboxClient instead of a real server.
func poll(ctx context.Context, dial dialFunc, req sdk.PollRequest) (sdk.PollResult, error) {
	cfg, err := configFrom(req.Config, req.Credentials.AccessToken)
	if err != nil {
		return sdk.PollResult{}, err
	}

	mailbox, err := dial(ctx, cfg)
	if err != nil {
		return sdk.PollResult{}, classifyDialError(err)
	}
	defer mailbox.Close()

	mailboxName := mailboxOf(req.Config)
	uidValidity, uidNext, err := mailbox.Select(mailboxName)
	if err != nil {
		return sdk.PollResult{}, sdk.BadConfig("mailbox", "папка %q недоступна: %v", mailboxName, err)
	}

	prev, hadCursor := decodeCursor(req.Cursor)

	// No cursor yet, or this is not the mailbox incarnation the cursor was
	// cut for: this is the baseline. Nothing already sitting in the mailbox
	// counts as new — a source that was only just added does not import a
	// backlog, it starts listening from here (docs/sources.md).
	if !hadCursor || prev.UIDValidity != uidValidity {
		next := cursor{UIDValidity: uidValidity, LastUID: baselineUID(uidNext)}
		return sdk.PollResult{Cursor: next.encode()}, nil
	}

	uids, err := mailbox.SearchFrom(prev.LastUID + 1)
	if err != nil {
		return sdk.PollResult{}, sdk.Retryable("поиск новых писем: %v", err)
	}
	if len(uids) == 0 {
		return sdk.PollResult{Cursor: prev.encode()}, nil
	}

	messages, err := mailbox.Fetch(uids)
	if err != nil {
		return sdk.PollResult{}, sdk.Retryable("получение писем: %v", err)
	}

	items := make([]sdk.Item, 0, len(messages))
	last := prev.LastUID
	for _, m := range messages {
		items = append(items, itemFrom(m, mailboxName))
		if m.UID > last {
			last = m.UID
		}
	}

	return sdk.PollResult{
		Items:  items,
		Cursor: cursor{UIDValidity: uidValidity, LastUID: last}.encode(),
	}, nil
}

// baselineUID is where a freshly added (or just reset) source starts
// counting from: UIDNEXT is the UID the server will hand out next, so
// nothing at or before UIDNEXT-1 is new.
func baselineUID(uidNext uint32) uint32 {
	if uidNext == 0 {
		return 0
	}
	return uidNext - 1
}

func configFrom(config map[string]string, password string) (connConfig, error) {
	host := strings.TrimSpace(config["host"])
	if host == "" {
		return connConfig{}, sdk.BadConfig("host", "не задан адрес сервера")
	}
	username := strings.TrimSpace(config["username"])
	if username == "" {
		return connConfig{}, sdk.BadConfig("username", "не задан логин")
	}
	if strings.TrimSpace(password) == "" {
		return connConfig{}, sdk.NeedsReauth("не задан пароль")
	}

	port := 993
	if raw := strings.TrimSpace(config["port"]); raw != "" {
		p, err := strconv.Atoi(raw)
		if err != nil || p <= 0 || p > 65535 {
			return connConfig{}, sdk.BadConfig("port", "непонятный порт %q", raw)
		}
		port = p
	}

	return connConfig{Host: host, Port: port, Username: username, Password: password}, nil
}

func mailboxOf(config map[string]string) string {
	if m := strings.TrimSpace(config["mailbox"]); m != "" {
		return m
	}
	return "INBOX"
}

// classifyDialError turns a dial/login failure into the error kind the app
// acts on: a dead password needs a person, everything else is worth another
// try on the usual schedule.
func classifyDialError(err error) error {
	var le loginError
	if errors.As(err, &le) {
		return sdk.NeedsReauth("не удалось войти: %v", le.err)
	}
	return sdk.Retryable("не удалось подключиться: %v", err)
}
