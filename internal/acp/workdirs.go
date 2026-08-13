package acp

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Folder registry: named local folders, edited from the desktop UI and
// persisted back into the config file. Cards are mapped to a folder when one of
// their select/multiSelect option names (e.g. a tag) matches an entry name.

// Workdirs returns a snapshot of the registry.
func (m *Manager) Workdirs() []WorkdirEntry {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	return append([]WorkdirEntry(nil), m.cfg.Workdirs...)
}

// WorkdirsForBoard is the registry as one board sees it: its own folders and
// the ones marked global. An empty boardID asks for all of them, which is what
// a place with no board behind it (the planning dialog) gets.
func (m *Manager) WorkdirsForBoard(boardID string) []WorkdirEntry {
	out := make([]WorkdirEntry, 0, 4)
	for _, p := range m.Workdirs() {
		if p.OfferedOn(boardID) {
			out = append(out, p)
		}
	}
	return out
}

// AddWorkdir registers a local folder under name (defaults to the directory
// basename) and persists the config. Any folder will do — see IsGitWorkdir for
// what being under git adds.
//
// kind is what the person adding it was asked for, and the only value with a
// meaning is WorkdirGit: the setup step of a board that publishes a branch or
// waits for one demands a repository, so answering it with a folder that has
// no git is refused here, where the answer is given, rather than three days
// later when a card cannot find a branch. Everywhere else passes "" — what a
// folder is gets asked when it matters, so a folder that becomes a repository
// later needs nobody to re-add it.
//
// TODO: validate the name as a hostname label. A deploy target names its apps
// and its subdomain after the folder (dokku.AppLabel), so a name that is not
// a valid DNS label is folded there silently, and two names that fold together
// would share one subdomain. The check belongs here, where the name is typed.
//
// TODO: this entry is also where a preview's own settings belong — config
// variables for the branch app, whether to request a Let's Encrypt certificate,
// how long a build may take. They were on the deploy target, which is wrong: a
// target is a machine, and those describe the thing being deployed.
func (m *Manager) AddWorkdir(name, path, boardID, kind string, global bool) (WorkdirEntry, error) {
	if !filepath.IsAbs(path) {
		return WorkdirEntry{}, fmt.Errorf("путь должен быть абсолютным: %s", path)
	}
	clean := filepath.Clean(path)
	info, err := os.Stat(clean)
	if err != nil || !info.IsDir() {
		return WorkdirEntry{}, fmt.Errorf("каталог не найден: %s", clean)
	}
	// A folder under git gets a branch of its own and every transition that
	// waits for one; one without is an ordinary folder an agent works in, which
	// is all a board of personal tasks ever needs. Only a declared repository is
	// refused here (see IsGitWorkdir).
	kind = strings.TrimSpace(strings.ToLower(kind))
	if kind == WorkdirGit && !IsGitWorkdir(m.rootCtx, clean) {
		return WorkdirEntry{}, fmt.Errorf("в папке %s нет git — этой доске нужен репозиторий: сделайте её репозиторием (git init) или выберите другую", clean)
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = filepath.Base(clean)
	}

	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	// Names and paths stay unique across the machine even though a folder now
	// belongs to a board: a card names its folder by name, and two entries
	// answering to one name would make which folder a card meant a matter of
	// registry order. The way to work one folder from two boards is the global
	// flag, and the error says so.
	for _, r := range m.cfg.Workdirs {
		if strings.EqualFold(r.Name, name) {
			return WorkdirEntry{}, fmt.Errorf("имя %q уже занято (%s)", r.Name, r.Path)
		}
		if filepath.Clean(r.Path) == clean {
			return WorkdirEntry{}, fmt.Errorf("папка уже добавлена как %q — отметьте её общей, чтобы она была доступна и на этой доске", r.Name)
		}
	}
	entry := WorkdirEntry{Name: name, Path: clean, BoardID: boardID, Global: global, Kind: kind}
	// The base branch is a setting, prefilled from the repository rather than
	// guessed: written down now, it is a value somebody can see and change,
	// which "ask git every time" would never be.
	entry.BaseBranch = DefaultBaseBranch(m.rootCtx, clean)
	m.cfg.Workdirs = append(m.cfg.Workdirs, entry)
	return entry, m.persistConfigLocked()
}

// SetWorkdirBase changes what work in this folder branches from. Empty clears
// it, and the folder falls back to what git says.
func (m *Manager) SetWorkdirBase(name, branch string) (WorkdirEntry, error) {
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	for i, r := range m.cfg.Workdirs {
		if !strings.EqualFold(r.Name, name) {
			continue
		}
		m.cfg.Workdirs[i].BaseBranch = strings.TrimSpace(branch)
		return m.cfg.Workdirs[i], m.persistConfigLocked()
	}
	return WorkdirEntry{}, fmt.Errorf("папка %q не найдена", name)
}

// WorkdirStatus is a registry entry as a screen needs it: the entry, plus what
// git says about the folder right now. The fact is asked rather than
// remembered — `git init` in a folder somebody added last month makes it a
// repository, and nothing about the entry changed.
type WorkdirStatus struct {
	WorkdirEntry

	// Git is what the folder is at this moment.
	Git bool `json:"git"`
	// Base is the branch work here would start from, resolved when the entry
	// does not name one. Empty for a folder with no git.
	Base string `json:"base,omitempty"`
	// Broken says the entry was added as a repository and the git is gone —
	// the one state a screen has to show rather than quietly work around.
	Broken bool `json:"broken,omitempty"`
}

// WorkdirStatusesForBoard is WorkdirsForBoard with git asked about each entry.
// One `git rev-parse` per folder, on a list a person is looking at.
func (m *Manager) WorkdirStatusesForBoard(boardID string) []WorkdirStatus {
	entries := m.WorkdirsForBoard(boardID)
	out := make([]WorkdirStatus, 0, len(entries))
	for _, e := range entries {
		out = append(out, m.workdirStatus(e))
	}
	return out
}

func (m *Manager) workdirStatus(e WorkdirEntry) WorkdirStatus {
	st := WorkdirStatus{WorkdirEntry: e, Git: IsGitWorkdir(m.rootCtx, e.Path)}
	if st.Git {
		st.Base = m.BaseBranchOf(e)
	}
	st.Broken = e.DeclaredGit() && !st.Git
	return st
}

// BaseBranchOf is what work in this folder branches from and merges back into:
// what the entry says, else what git says.
func (m *Manager) BaseBranchOf(e WorkdirEntry) string {
	if b := strings.TrimSpace(e.BaseBranch); b != "" {
		return b
	}
	return DefaultBaseBranch(m.rootCtx, e.Path)
}

// UnattachedWorkdirs are the entries no board has claimed: what a registry
// written before folders belonged to a board is made of. They are offered
// nowhere, so the dialog lists them apart — otherwise a folder somebody added
// months ago would simply vanish, with its folder still in the config and its
// path refusing to be added again.
func (m *Manager) UnattachedWorkdirs() []WorkdirEntry {
	out := make([]WorkdirEntry, 0, 2)
	for _, p := range m.Workdirs() {
		if !p.Attached() {
			out = append(out, p)
		}
	}
	return out
}

// AttachWorkdir gives an unattached folder to a board — the way back into use
// for an entry the upgrade left behind, and the reason adding its folder again
// does not have to be refused.
func (m *Manager) AttachWorkdir(name, boardID string) (WorkdirEntry, error) {
	if strings.TrimSpace(boardID) == "" {
		return WorkdirEntry{}, fmt.Errorf("не указана доска")
	}
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	for i, p := range m.cfg.Workdirs {
		if !strings.EqualFold(p.Name, name) {
			continue
		}
		if p.Attached() {
			return WorkdirEntry{}, fmt.Errorf("папка %q уже принадлежит доске", p.Name)
		}
		m.cfg.Workdirs[i].BoardID = boardID
		return m.cfg.Workdirs[i], m.persistConfigLocked()
	}
	return WorkdirEntry{}, fmt.Errorf("папка %q не найдена", name)
}

// RemoveWorkdir deletes a registry entry by name and persists the config.
func (m *Manager) RemoveWorkdir(name string) error {
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	for i, r := range m.cfg.Workdirs {
		if strings.EqualFold(r.Name, name) {
			m.cfg.Workdirs = append(m.cfg.Workdirs[:i], m.cfg.Workdirs[i+1:]...)
			return m.persistConfigLocked()
		}
	}
	return fmt.Errorf("папка %q не найдена", name)
}

func (m *Manager) persistConfigLocked() error {
	if m.cfgPath == "" {
		return nil // tests / ephemeral configs
	}
	if err := SaveConfig(m.cfgPath, m.configToStore()); err != nil {
		m.log.Error("acp: failed to persist config", "err", err)
		return fmt.Errorf("не удалось сохранить конфиг: %w", err)
	}
	return nil
}

// resolveWorkdir maps a trigger event to a folder path. Priority:
//  1. explicit repo_path card property (validated against whitelist+registry);
//  2. a select/multiSelect option name (tag) matching a registry entry;
//  3. the name of the column the card was dragged out of — supports boards
//     whose trigger property has one lane per folder.
//
// resolveNamedWorkdir looks a registry entry up by name. Opening a console on a
// card that carries no folder tag would otherwise be a dead end: the card
// is not going to grow one just because someone wants to talk about it.
func (m *Manager) resolveNamedWorkdir(name string) (string, error) {
	m.cfgMu.RLock()
	workdirs := append([]WorkdirEntry(nil), m.cfg.Workdirs...)
	m.cfgMu.RUnlock()
	for _, r := range workdirs {
		if strings.EqualFold(strings.TrimSpace(name), r.Name) {
			if info, err := os.Stat(r.Path); err != nil || !info.IsDir() {
				return "", fmt.Errorf("папка %q указывает на несуществующий каталог %s", r.Name, r.Path)
			}
			return r.Path, nil
		}
	}
	return "", fmt.Errorf("папка %q не найдена в реестре (%s)", name, workdirNames(workdirs))
}

// cardWorkdirPathProps are the card fields that name a path outright, newest
// first. `repo_path` is what the field was called before folders were called
// folders, and a card that already carries one keeps working: a board is
// somebody's data, and renaming a field under them would quietly stop their
// cards from finding anywhere to run.
var cardWorkdirPathProps = []string{"project_path", "repo_path"}

// firstProp returns the first of the named card fields that has a value.
func firstProp(props map[string]string, names []string) string {
	for _, name := range names {
		if v := strings.TrimSpace(props[name]); v != "" {
			return v
		}
	}
	return ""
}

// errNoWorkdir marks the refusals that mean "the card names no folder" — as
// opposed to a folder it names being broken. A session cannot run without one;
// a terminal is a conversation first, and StartCardTerminal opens it without a
// folder instead of refusing (a card can be talked over — wording, a plan —
// before anybody decides where the work lives).
type errNoWorkdir struct{ error }

// CardFolder answers where a conversation on this card would run: the folder
// the card resolves, or nothing. The terminal panel reads it before starting
// anything — «no folder» is a question for the person sitting there, never a
// silent temp directory — while the windowed path keeps Go's own fallback,
// since a window has no form to ask with.
func (m *Manager) CardFolder(cardID string) (string, bool) {
	if m.reader == nil {
		return "", false
	}
	ctx, cancel := context.WithTimeout(m.rootCtx, 5*time.Second)
	defer cancel()
	ev, err := m.reader.CardByID(ctx, cardID)
	if err != nil {
		return "", false
	}
	path, err := m.resolveWorkdir(ev)
	if err != nil {
		return "", false
	}
	return path, true
}

func (m *Manager) resolveWorkdir(ev CardMoved) (string, error) {
	if explicit := firstProp(ev.Props, cardWorkdirPathProps); explicit != "" {
		m.cfgMu.RLock()
		cfg := m.cfg
		m.cfgMu.RUnlock()
		return cfg.ValidateWorkdirPath(explicit)
	}

	// Only what this board offers: a tag left over from a template, or a column
	// that happens to be named like somebody else's folder, must not send an
	// agent into a checkout this board knows nothing about.
	workdirs := m.WorkdirsForBoard(ev.BoardID)

	candidates := append(append([]string(nil), ev.OptionNames...), ev.FromColumn.Name)
	for _, opt := range candidates {
		for _, r := range workdirs {
			if strings.EqualFold(strings.TrimSpace(opt), r.Name) {
				if info, err := os.Stat(r.Path); err != nil || !info.IsDir() {
					return "", fmt.Errorf("папка %q указывает на несуществующий каталог %s", r.Name, r.Path)
				}
				return r.Path, nil
			}
		}
	}
	if len(workdirs) == 0 {
		return "", errNoWorkdir{fmt.Errorf("у карточки не заполнено поле «Папки» и в реестре нет ни одной папки (меню доски → «Папки…»)")}
	}
	return "", errNoWorkdir{fmt.Errorf("ни тег карточки, ни исходная колонка не совпали с папкой из реестра (%s)", workdirNames(workdirs))}
}

func workdirNames(workdirs []WorkdirEntry) string {
	names := make([]string, len(workdirs))
	for i, r := range workdirs {
		names[i] = r.Name
	}
	return strings.Join(names, ", ")
}
