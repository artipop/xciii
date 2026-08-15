package acp

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

// A question is an agent asking the person whose card it is working, and
// waiting for the answer.
//
// Both of the ways ACP has to ask arrive here: session/request_permission, when
// the agent wants a tool the policy does not cover, and the elicitation, when it
// wants an answer in words — the claude CLI's own AskUserQuestion comes through
// as a form of one property with a `oneOf` and a free-text field beside it.
//
// Asking does not stop the session: the SDK dispatches every inbound request on
// its own goroutine, so the agent keeps streaming and the turn is still open
// while the card waits. What stops is the one thing that asked.

// QuestionKind says which of the two arrived, because they are answered
// differently — one picks a permission option, the other fills in a form.
type QuestionKind string

const (
	QuestionPermission QuestionKind = "permission"
	QuestionForm       QuestionKind = "form"
)

// QuestionOption is one answer the agent offered.
type QuestionOption struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
	// Kind is the permission option's own kind (allow_once, reject_always, …),
	// kept because "always" is remembered for the rest of the session.
	Kind string `json:"kind,omitempty"`
}

// Question is what a card shows and what the UI answers.
type Question struct {
	ID        string       `json:"id"`
	SessionID string       `json:"sessionId"`
	CardID    string       `json:"cardId,omitempty"`
	BoardID   string       `json:"boardId,omitempty"`
	CardTitle string       `json:"cardTitle,omitempty"`
	Agent     string       `json:"agent,omitempty"`
	Kind      QuestionKind `json:"kind"`
	// Text is the question itself: the tool call's title for a permission, the
	// agent's message for a form.
	Text    string           `json:"text"`
	Tool    string           `json:"tool,omitempty"`
	Options []QuestionOption `json:"options,omitempty"`
	// FreeText says an answer may be typed instead of chosen. The claude
	// adapter always offers one beside its options, and a form with no options
	// at all is nothing but this.
	FreeText bool      `json:"freeText"`
	AskedAt  time.Time `json:"askedAt"`

	// field/freeField are the form properties an accepted answer goes under.
	// Not sent to the UI: it answers with an option id and a text, and what
	// they are called on the wire is this package's business.
	field     string
	freeField string
}

// Answer is the reply. An answer with neither an option nor text is a refusal,
// which is also what an agent gets when the app closes with the question open.
type Answer struct {
	OptionID string `json:"optionId,omitempty"`
	Text     string `json:"text,omitempty"`
	Declined bool   `json:"declined,omitempty"`
}

func (a Answer) empty() bool { return a.OptionID == "" && strings.TrimSpace(a.Text) == "" }

// pendingQuestion is one question and the channel its answer arrives on.
type pendingQuestion struct {
	q     Question
	reply chan Answer
}

// ask puts the question to the person and waits. ctx is the agent request's own
// context, so an agent that gives up on its question takes it back.
func (m *Manager) ask(ctx context.Context, s *Session, q Question) Answer {
	q.ID = uuid.NewString()
	q.SessionID = s.ID
	q.CardID = s.CardID
	q.BoardID = s.BoardID
	q.CardTitle = s.Title
	q.Agent = s.Agent.Name
	q.AskedAt = time.Now()

	reply := make(chan Answer, 1)
	m.questionsMu.Lock()
	if m.questions == nil {
		m.questions = map[string]*pendingQuestion{}
	}
	m.questions[q.ID] = &pendingQuestion{q: q, reply: reply}
	m.questionsMu.Unlock()

	s.appendEvent(m, "question", map[string]any{
		"questionId": q.ID, "kind": string(q.Kind), "text": q.Text, "tool": q.Tool,
	})
	m.setStatus(s, StatusWaitingPermission)
	m.emitQuestion(q, true)
	m.log.Info("acp: the agent is asking", "session", s.ID, "card", q.CardID, "kind", q.Kind, "tool", q.Tool)

	var answer Answer
	select {
	case answer = <-reply:
	case <-ctx.Done():
		// The agent withdrew the question — a cancelled turn, or its own
		// timeout. Nothing to answer any more.
		answer = Answer{Declined: true}
	case <-m.rootCtx.Done():
		answer = Answer{Declined: true}
	}

	m.questionsMu.Lock()
	delete(m.questions, q.ID)
	m.questionsMu.Unlock()

	m.setStatus(s, StatusRunning)
	m.emitQuestion(q, false)
	// Answered or withdrawn, this question is gone, and an acknowledgement of it
	// must not outlive it (attentionack.go).
	m.clearAck("q:" + q.ID)
	// The exchange itself is not commented on the card. A question is live —
	// it is on the card's face, in the notification and on «Ждут» while it
	// waits, and it is answered in any of them. Once answered it is the
	// agent's business, and the two comments it used to leave said nothing a
	// person would come back for.
	s.appendEvent(m, "answer", map[string]any{
		"questionId": q.ID, "optionId": answer.OptionID, "declined": answer.Declined,
	})
	return answer
}

// AnswerQuestion delivers a person's answer. It is safe to call twice: the
// second call finds nothing to answer and says so.
func (m *Manager) AnswerQuestion(id string, ans Answer) error {
	m.questionsMu.Lock()
	pending, ok := m.questions[id]
	m.questionsMu.Unlock()
	if !ok {
		return fmt.Errorf("вопрос %s уже неактуален", id)
	}
	select {
	case pending.reply <- ans:
		return nil
	default:
		// Buffered by one and removed by the asker, so a full channel means an
		// answer is already on its way.
		return fmt.Errorf("на этот вопрос уже отвечают")
	}
}

// Questions lists everything an agent is waiting to hear, oldest first.
func (m *Manager) Questions() []Question {
	m.questionsMu.Lock()
	out := make([]Question, 0, len(m.questions))
	for _, pending := range m.questions {
		out = append(out, pending.q)
	}
	m.questionsMu.Unlock()
	sort.Slice(out, func(i, j int) bool { return out[i].AskedAt.Before(out[j].AskedAt) })
	return out
}

// QuestionForCard is the card's own open question, if it has one.
func (m *Manager) QuestionForCard(cardID string) *Question {
	if cardID == "" {
		return nil
	}
	for _, q := range m.Questions() {
		if q.CardID == cardID {
			return &q
		}
	}
	return nil
}

// emitQuestion tells the UI a question opened or closed, as an attention: a
// card waiting to be answered is a card waiting for a person, and the board
// shows those in one place.
func (m *Manager) emitQuestion(q Question, open bool) {
	m.emitAttentionRecord(Attention{
		CardID:     q.CardID,
		BoardID:    q.BoardID,
		Title:      q.CardTitle,
		Agent:      q.Agent,
		Reason:     AttentionQuestion,
		Tool:       q.Tool,
		QuestionID: q.ID,
		Text:       q.Text,
		Options:    q.Options,
		FreeText:   q.FreeText,
		Awaiting:   open,
		Since:      q.AskedAt.Format(time.RFC3339),
	})
}

// attention describes an open question the way the board wants it.
func (q Question) attention() Attention {
	return Attention{
		CardID:     q.CardID,
		BoardID:    q.BoardID,
		Title:      q.CardTitle,
		Agent:      q.Agent,
		Reason:     AttentionQuestion,
		Tool:       q.Tool,
		QuestionID: q.ID,
		Text:       q.Text,
		Options:    q.Options,
		FreeText:   q.FreeText,
		Awaiting:   true,
		Since:      q.AskedAt.Format(time.RFC3339),
	}
}
