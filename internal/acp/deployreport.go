package acp

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/artipop/xciii/internal/dokku"
)

// What a finished deploy session tells its route. "The agent stopped talking"
// is not "the branch is live", so the answer comes from the record the dokku
// MCP server left behind rather than from the session's status.

// applyDeployOutcome reads the recorded deploy result and turns it into the
// event the card's stage moves on. It also says so on the card when the agent's
// own summary would have been misleading.
func (m *Manager) applyDeployOutcome(s *Session) {
	if s.Deploy == nil {
		return
	}
	if s.Artifacts == "" {
		// Nothing was recorded, so the session status is all there is.
		return
	}
	res, err := dokku.ReadOutcome(s.Artifacts)
	switch {
	case os.IsNotExist(err):
		s.setOutcome(TriggerFailure, "деплой не выполнялся")
		m.comment(s, "Деплой не подтверждён: инструмент `deploy_branch` ни разу не отработал, так что ветка не опубликована.")
	case err != nil:
		m.log.Warn("acp: cannot read deploy outcome", "session", s.ID, "err", err)
	case !res.OK:
		s.setOutcome(TriggerFailure, "деплой упал")
		m.comment(s, fmt.Sprintf("Деплой ветки `%s` не удался: %s", res.Branch, res.Error))
	default:
		s.setOutcome(TriggerSuccess, "ветка задеплоена")
		// The stage's declared writes get the preview address — the fact a later
		// stage (or an edge) reads. It used to live only in comments, where no
		// transition can reach it.
		m.writeStageFields(s, res.URL)
	}
}

// writeStageFields puts one machine-produced value into every property the
// stage declared it writes. Failures are said on the card rather than swallowed:
// a route built on this value will stand still, and «свойства нет» is fixable
// where «карточка не едет» is a mystery.
func (m *Manager) writeStageFields(s *Session, value string) {
	if len(s.Writes) == 0 || m.writer == nil || s.CardID == "" {
		return
	}
	fields := map[string]string{}
	for _, w := range s.Writes {
		fields[w.Property] = value
	}
	ctx, cancel := context.WithTimeout(m.rootCtx, 10*time.Second)
	defer cancel()
	if err := m.writer.SetCardFields(ctx, s.CardID, fields); err != nil {
		m.log.Warn("acp: cannot write the stage's declared fields", "session", s.ID, "err", err)
		m.comment(s, fmt.Sprintf("Не удалось записать результат стадии на карточку: %v", err))
	}
}
