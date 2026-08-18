package acp

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/artipop/xciii/internal/dokku"
)

// Deploy target registry: named Dokku destinations, edited from the desktop UI
// and persisted into the config file. A card moved into the deploy column is
// matched to one of these, and the entry is what the session's MCP server is
// configured from.

// Deploys returns a snapshot of the registry.
func (m *Manager) Deploys() []DeployEntry {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	return append([]DeployEntry(nil), m.cfg.Deploys...)
}

// validateDeploy normalizes and checks a registry entry.
func validateDeploy(d DeployEntry) (DeployEntry, error) {
	d.Name = strings.TrimSpace(d.Name)
	if d.Name == "" {
		return DeployEntry{}, fmt.Errorf("имя цели не может быть пустым")
	}
	target, err := d.Target.Validate()
	if err != nil {
		return DeployEntry{}, fmt.Errorf("цель %q: %w", d.Name, err)
	}
	d.Target = target

	if key := strings.TrimSpace(d.SSHKey); key != "" {
		if _, err := os.Stat(key); err != nil {
			return DeployEntry{}, fmt.Errorf("ssh-ключ не найден: %s", key)
		}
	}
	return d, nil
}

// AddDeploy registers a new Dokku destination and persists the config.
func (m *Manager) AddDeploy(d DeployEntry) (DeployEntry, error) {
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	d, err := validateDeploy(d)
	if err != nil {
		return DeployEntry{}, err
	}
	for _, e := range m.cfg.Deploys {
		if strings.EqualFold(e.Name, d.Name) {
			return DeployEntry{}, fmt.Errorf("цель с именем %q уже существует", e.Name)
		}
	}
	m.cfg.Deploys = append(m.cfg.Deploys, d)
	// The id is minted by the store, so the entry is read back out of the
	// registry rather than returned as it went in: a caller that pins this
	// target — a column, a route stage — needs the id, and the copy made before
	// the write has none.
	err = m.persistConfigLocked()
	return m.cfg.Deploys[len(m.cfg.Deploys)-1], err
}

// UpdateDeploy replaces an existing entry and persists.
//
// Matched by id, which is what makes renaming a target possible at all: matched
// by name, the lookup used the *new* name and found nothing, so the one edit
// somebody actually wants to make was the one that could not be made.
func (m *Manager) UpdateDeploy(d DeployEntry) (DeployEntry, error) {
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	d, err := validateDeploy(d)
	if err != nil {
		return DeployEntry{}, err
	}
	for i, e := range m.cfg.Deploys {
		if !sameDeployEntry(e, d) {
			continue
		}
		if name := strings.TrimSpace(d.Name); !strings.EqualFold(e.Name, name) {
			if _, taken := deployByName(m.cfg.Deploys, name); taken {
				return DeployEntry{}, fmt.Errorf("цель с именем %q уже существует", name)
			}
		}
		d.ID = e.ID
		m.cfg.Deploys[i] = d
		return d, m.persistConfigLocked()
	}
	return DeployEntry{}, fmt.Errorf("цель %q не найдена", d.Name)
}

// sameDeployEntry is which registry row an edit is about: the id when the
// caller carries one, and otherwise the name — a form filled in before ids
// existed still has to find its row.
func sameDeployEntry(existing, edit DeployEntry) bool {
	if id := strings.TrimSpace(edit.ID); id != "" {
		return existing.ID == id
	}
	return strings.EqualFold(existing.Name, strings.TrimSpace(edit.Name))
}

// RemoveDeploy deletes an entry by name and persists the config. Apps already
// running on the host are left alone — they are removed from the agent console.
func (m *Manager) RemoveDeploy(name string) error {
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	for i, e := range m.cfg.Deploys {
		if strings.EqualFold(e.Name, name) {
			m.cfg.Deploys = append(m.cfg.Deploys[:i], m.cfg.Deploys[i+1:]...)
			return m.persistConfigLocked()
		}
	}
	return fmt.Errorf("цель %q не найдена", name)
}

// resolveDeployTarget maps a card to a Dokku destination: a select/multiSelect
// option naming an entry, otherwise the single registered entry. A target is a
// host rather than a per-folder setting, so one entry usually answers for
// everything and a card names one only where there are several hosts.
func (m *Manager) resolveDeployTarget(ev CardMoved) (DeployEntry, error) {
	m.cfgMu.RLock()
	deploys := append([]DeployEntry(nil), m.cfg.Deploys...)
	m.cfgMu.RUnlock()

	if len(deploys) == 0 {
		return DeployEntry{}, fmt.Errorf("не настроено ни одной цели деплоя (меню доски → «Цели деплоя…»)")
	}
	for _, opt := range ev.OptionNames {
		for _, d := range deploys {
			if strings.EqualFold(strings.TrimSpace(opt), d.Name) {
				return d, nil
			}
		}
	}
	if len(deploys) == 1 {
		return deploys[0], nil
	}
	return DeployEntry{}, fmt.Errorf("не понятно, куда деплоить: тег карточки не совпал ни с одной целью из реестра (%s)", deployNames(deploys))
}

// resolveDeploy gathers what a deploy session needs: the target and the branch
// to publish. For an ordinary session it returns nothing and no error, so the
// launch path can call it unconditionally. pinned is the id of the target a
// column or a flow node fixed, which wins over the card's own resolution.
func (m *Manager) resolveDeploy(ev CardMoved, workdirPath string, deploy bool, pinned string) (*DeployEntry, string, error) {
	if !deploy {
		return nil, "", nil
	}
	// Publishing means pushing a branch, and a folder that is not under git
	// has none. Said here rather than three steps later, where it would read as
	// "branch not found" on a card that never had one.
	if !IsGitWorkdir(m.rootCtx, workdirPath) {
		return nil, "", fmt.Errorf("папка %s не под git — публиковать нечего: деплой работает с веткой", workdirPath)
	}
	target, err := m.resolveDeployTargetPinned(ev, pinned)
	if err != nil {
		return nil, "", err
	}
	target.Target = target.Target.WithBaseApp(m.deployAppName(workdirPath))

	// What to publish: what the card says, else the branch its own sessions
	// have been committing to — with worktrees the agent works on a branch the
	// card never learns about, and deploying the folder's checked-out one
	// would publish somebody else's work. That is also what the Deploy button
	// next to the branch does, so the column and the button agree.
	branch := strings.TrimSpace(ev.Props["branch"])
	if branch == "" {
		branch = m.cardBranch(ev.CardID)
	}
	if branch == "" {
		var err error
		if branch, err = resolveDeployBranch(ev, workdirPath); err != nil {
			return nil, "", err
		}
	}
	return &target, branch, nil
}

// resolveDeployTargetPinned is resolveDeployTarget with a pinned target taking
// precedence — how a column or a flow node fixes the destination for its stage
// alone. The pin is the registry entry's id: a target somebody renamed is the
// same target, and used to stop being one (contradiction 8).
func (m *Manager) resolveDeployTargetPinned(ev CardMoved, id string) (DeployEntry, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return m.resolveDeployTarget(ev)
	}
	m.cfgMu.RLock()
	deploys := append([]DeployEntry(nil), m.cfg.Deploys...)
	m.cfgMu.RUnlock()
	if d, ok := deployByID(deploys, id); ok {
		return d, nil
	}
	// The id is the board's and the registry is the machine's, so a board
	// carried here from another machine points at a target nobody registered.
	// Saying which id it is helps nobody; saying what this machine has is the
	// half a person can act on.
	return DeployEntry{}, fmt.Errorf("цель деплоя, назначенная этой стадии, не найдена в реестре машины (есть: %s)", deployNames(deploys))
}

// deployAppName is what a target without an explicit base app names its apps
// and its level of the hostname after: the folder's own name in the
// registry, or the directory it sits in for a folder that is not registered.
func (m *Manager) deployAppName(workdirPath string) string {
	if strings.TrimSpace(workdirPath) == "" {
		return ""
	}
	m.cfgMu.RLock()
	workdirs := append([]WorkdirEntry(nil), m.cfg.Workdirs...)
	m.cfgMu.RUnlock()

	if name := workdirNameForPath(workdirs, workdirPath); name != "" {
		return name
	}
	return filepath.Base(filepath.Clean(workdirPath))
}

// deployTools are the dokku tools a deploy session may use without asking, for
// the same reason a test session gets its browser tools: a card-triggered
// deploy has no console watching, and asking nobody means rejecting.
// destroy_deployment is deliberately absent — tearing a preview down is worth a
// human answer when there is one to be had.
func deployTools() map[string]bool {
	names := []string{"deploy_branch", "deployment_status", "app_logs", "list_deployments"}
	allow := make(map[string]bool, len(names))
	for _, n := range names {
		allow["mcp__"+dokku.ServerName+"__"+n] = true
	}
	return allow
}

// resolveDeployBranch is the branch a deploy session publishes: the card's
// explicit "branch" property, otherwise whatever the folder has checked out.
func resolveDeployBranch(ev CardMoved, workdirPath string) (string, error) {
	if b := strings.TrimSpace(ev.Props["branch"]); b != "" {
		return b, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return dokku.CurrentBranch(ctx, nil, workdirPath)
}

func workdirNameForPath(workdirs []WorkdirEntry, path string) string {
	for _, r := range workdirs {
		if r.Path == path {
			return r.Name
		}
	}
	return ""
}

func deployNames(deploys []DeployEntry) string {
	names := make([]string, len(deploys))
	for i, d := range deploys {
		names[i] = d.Name
	}
	return strings.Join(names, ", ")
}
