package acp

// Why a card is standing still, said where the card already says where it
// stands — on its route strip — rather than in its comments.
//
// Every one of these used to be a comment: «Агент не запущен: …», «Колонка
// занята…», «нет перехода по событию…». A comment is the durable record of
// work, and these are not work — they are the current state of the machinery,
// true only until somebody fixes the registry or moves the card, and stale the
// moment they do. A card that failed to start three times carried three
// comments saying so, from an account named SINGLE-USER, above the one comment
// worth reading. The state now lives in one record per card, replaced by a
// newer reason and deleted by any progress, and the strip (or the terminal
// panel, for a card outside any route) draws it while it is true.

// stallCard records why nothing started and nudges every open view of the
// card. nodeID is the stage the reason belongs to, empty for a standalone
// trigger column.
func (m *Manager) stallCard(cardID, nodeID, reason string) {
	m.stallCardKind(cardID, nodeID, "", reason)
}

// stallCardConversation is the one reason a person can act on where they are
// standing: the card's conversation stopped without a verdict. It is drawn on
// the card's own terminal button as well as on the route strip, because unlike
// every other reason recorded here it has somewhere to go — that terminal.
func (m *Manager) stallCardConversation(cardID, nodeID, reason string) {
	m.stallCardKind(cardID, nodeID, StallKindConversation, reason)
}

func (m *Manager) stallCardKind(cardID, nodeID, kind, reason string) {
	if err := m.store.SetStall(StallRecord{CardID: cardID, NodeID: nodeID, Kind: kind, Reason: reason}); err != nil {
		m.log.Warn("acp: cannot record why the card stalled", "card", cardID, "err", err)
		return
	}
	m.log.Info("acp: card stalled", "card", cardID, "node", nodeID, "reason", reason)
	m.emitStall(cardID, reason)
}

// stallCardSoft records the reason only when none is recorded. It is for the
// consequences of a failure that was already explained: a stage that would not
// start raises «шаг упал», and a route with no failure edge would then report
// the missing edge — over the reason the person actually needs. The first
// reason is the root cause; any progress deletes it and lets a later one in.
func (m *Manager) stallCardSoft(cardID, nodeID, reason string) {
	if _, ok, _ := m.store.Stall(cardID); ok {
		return
	}
	m.stallCard(cardID, nodeID, reason)
}

// clearStall forgets the reason. Called wherever the card makes progress — a
// session starts, a stage is entered, the card leaves the column — so a
// recorded reason is always the current one.
func (m *Manager) clearStall(cardID string) {
	changed, err := m.store.ClearStall(cardID)
	if err != nil {
		m.log.Warn("acp: cannot clear the stall record", "card", cardID, "err", err)
		return
	}
	if changed {
		m.emitStall(cardID, "")
	}
}

// emitStall rides the session event: the strip and the card's panels already
// refetch on it, and a stall is session state — the session there isn't.
func (m *Manager) emitStall(cardID, reason string) {
	m.ui.Emit(EventSession, map[string]any{
		"cardId": cardID,
		"stall":  reason,
	})
}

// CutOffConversations is every card whose conversation stopped without a
// verdict, as card id → reason. The board asks once and draws the answer on
// each of its cards, exactly as it does for the terminals that are running.
func (m *Manager) CutOffConversations() map[string]string {
	out, err := m.store.StallsOfKind(StallKindConversation)
	if err != nil {
		m.log.Warn("acp: cannot read which conversations were cut off", "err", err)
		return map[string]string{}
	}
	return out
}

// CardStall is the card's recorded reason, for the surfaces that draw it.
func (m *Manager) CardStall(cardID string) (StallRecord, bool) {
	r, ok, err := m.store.Stall(cardID)
	if err != nil {
		m.log.Warn("acp: cannot read the stall record", "card", cardID, "err", err)
		return StallRecord{}, false
	}
	return r, ok
}
