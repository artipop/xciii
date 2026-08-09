package boardadapter

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"unicode"

	"github.com/mattermost/focalboard/server/model"

	"github.com/artipop/xciii/internal/acp"
)

// Agents as board users: a registered agent gets a board account named
// after it, so a card is handed to an agent by assigning it in a person
// property ("Assignee") exactly like a teammate. The desktop app runs the
// server in-process, which is what makes this possible at all — the /register
// endpoint is closed in single-user mode.

// agentEmailDomain is the reserved (RFC 2606) domain the accounts are created
// under, so an agent can never collide with a real address.
const agentEmailDomain = "agents.invalid"

var _ acp.BoardUsers = (*EventsBackend)(nil)

// EnsureAgentUsers creates the missing agent accounts and makes every agent a
// member of the board. Idempotent: an existing account is reused, and an
// existing membership is left as it is. Accounts are never deleted — a card can
// still name an agent long after its registry entry is gone.
func (b *EventsBackend) EnsureAgentUsers(ctx context.Context, boardID string, agents []acp.AgentUser) ([]acp.AgentUser, error) {
	b.mu.Lock()
	a := b.app
	b.mu.Unlock()
	if a == nil {
		return nil, fmt.Errorf("board app is not ready")
	}
	if boardID == "" {
		return nil, fmt.Errorf("не указана доска")
	}
	board, err := a.GetBoard(boardID)
	if err != nil {
		return nil, fmt.Errorf("get board %s: %w", boardID, err)
	}
	if board == nil {
		return nil, fmt.Errorf("доска %s не найдена", boardID)
	}

	out := make([]acp.AgentUser, 0, len(agents))
	for _, agent := range agents {
		if agent.Username == "" {
			continue
		}
		user, err := a.GetUserByUsername(agent.Username)
		if err != nil {
			return out, fmt.Errorf("поиск пользователя %q: %w", agent.Username, err)
		}
		if user == nil {
			password, err := randomPassword()
			if err != nil {
				return out, err
			}
			// The account exists to be assigned, not to be logged into: the
			// password is random and never shown anywhere.
			if err := a.RegisterUser(agent.Username, agent.Username+"@"+agentEmailDomain, password); err != nil {
				return out, fmt.Errorf("создание пользователя %q: %w", agent.Username, err)
			}
			if user, err = a.GetUserByUsername(agent.Username); err != nil || user == nil {
				return out, fmt.Errorf("пользователь %q создан, но не найден: %w", agent.Username, err)
			}
			agent.Created = true
		}
		agent.UserID = user.ID

		// Membership is what puts the agent into the board's person picker
		// without searching for it.
		member := &model.BoardMember{
			BoardID:         boardID,
			UserID:          user.ID,
			SchemeEditor:    true,
			SchemeCommenter: true,
			SchemeViewer:    true,
		}
		if _, err := a.AddMemberToBoard(member); err != nil {
			return out, fmt.Errorf("добавление %q в участники доски: %w", agent.Username, err)
		}
		out = append(out, agent)
	}
	return out, nil
}

// sourceEmailDomain is the reserved (RFC 2606) domain a source's account is
// created under, for the reason the agents' one is: it can never collide with
// a real address.
const sourceEmailDomain = "sources.invalid"

// EnsureSourceUser gives a source a board account so that a card it left is
// *authored* by it — the board's own answer to "who made this", rather than a
// property of ours saying the same thing beside it.
//
// This is the agents' arrangement applied to sources, and for the same reason:
// the board already knows how to name whoever created a card and how to group
// by it, so a source that is a user needs no machinery of its own. What a
// person makes stays theirs; what arrived is the source's.
//
// Idempotent, and the account is never deleted: a card can still name a source
// long after its registry entry is gone.
func (w *Writer) EnsureSourceUser(ctx context.Context, boardID, source string) (string, error) {
	if source == "" {
		return "", nil
	}
	username := sourceUsername(source)
	user, err := w.app.GetUserByUsername(username)
	if err != nil {
		return "", fmt.Errorf("поиск пользователя %q: %w", username, err)
	}
	if user == nil {
		password, err := randomPassword()
		if err != nil {
			return "", err
		}
		// The account exists to be named, not to be logged into.
		if err := w.app.RegisterUser(username, username+"@"+sourceEmailDomain, password); err != nil {
			return "", fmt.Errorf("создание пользователя %q: %w", username, err)
		}
		if user, err = w.app.GetUserByUsername(username); err != nil || user == nil {
			return "", fmt.Errorf("пользователь %q создан, но не найден: %w", username, err)
		}
	}

	// Membership is what makes the name resolve on the board rather than
	// showing as somebody nobody here knows.
	member := &model.BoardMember{
		BoardID:         boardID,
		UserID:          user.ID,
		SchemeCommenter: true,
		SchemeViewer:    true,
	}
	if _, err := w.app.AddMemberToBoard(member); err != nil {
		return "", fmt.Errorf("добавление %q в участники доски: %w", username, err)
	}
	return user.ID, nil
}

// sourceUsername is the account name a source gets: its own name, reduced to
// what a username may hold. Its own name and not a prefixed one, because the
// board shows the username wherever it names the author — the group headings of
// the inbox among them — and «source-почта» is not what the source is called.
//
// This is the agents' arrangement again: an agent's account is its own name
// too. Two of them called the same thing would share an identity, which is why
// the card write below treats a refused account as no author at all rather than
// as a failure.
func sourceUsername(source string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(source)) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '_':
			b.WriteByte('-')
		}
	}
	return b.String()
}

// RetireAgentUser takes an unregistered agent off every board it belongs to, so
// it stops being offered as an assignee, and reports how many memberships were
// dropped. The account is deliberately left in place: cards may still name it
// (its name would otherwise vanish from them), and registering the agent again
// gives it the same identity back.
func (b *EventsBackend) RetireAgentUser(ctx context.Context, agent acp.AgentUser) (int, error) {
	b.mu.Lock()
	a := b.app
	b.mu.Unlock()
	if a == nil {
		return 0, fmt.Errorf("board app is not ready")
	}
	if agent.Username == "" {
		return 0, nil
	}

	user, err := a.GetUserByUsername(agent.Username)
	if err != nil {
		return 0, fmt.Errorf("поиск пользователя %q: %w", agent.Username, err)
	}
	if user == nil {
		return 0, nil // never provisioned; nothing to take away
	}

	members, err := a.GetMembersForUser(user.ID)
	if err != nil {
		return 0, fmt.Errorf("список досок пользователя %q: %w", agent.Username, err)
	}
	removed := 0
	for _, member := range members {
		if err := a.DeleteBoardMember(member.BoardID, user.ID); err != nil {
			return removed, fmt.Errorf("удаление %q из участников доски %s: %w", agent.Username, member.BoardID, err)
		}
		removed++
	}
	return removed, nil
}

// randomPassword returns a password no one knows, long enough for the server's
// own validation.
func randomPassword() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("не удалось сгенерировать пароль: %w", err)
	}
	return hex.EncodeToString(buf), nil
}
