package acp

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Folder registry: places an agent can work, edited from the desktop UI and
// persisted back into the config file. Every entry has an id, and a card names
// its folder by that id — the id of the board option offering it — so what the
// entry is *called* stays a label.

// Workdirs returns a snapshot of the registry.
func (m *Manager) Workdirs() []WorkdirEntry {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	return append([]WorkdirEntry(nil), m.cfg.Workdirs...)
}

// workdirPaths is every registered folder's directory, for the jobs that sweep
// the disk rather than answer a question about a card.
func (m *Manager) workdirPaths() []string {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	out := make([]string, 0, len(m.cfg.Workdirs))
	for _, e := range m.cfg.Workdirs {
		if e.Path != "" {
			out = append(out, e.Path)
		}
	}
	return out
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
		return WorkdirEntry{}, fmt.Errorf("папка не найдена: %s", clean)
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
	entry := WorkdirEntry{ID: newWorkdirID(), Name: name, Path: clean, BoardID: boardID, Global: global, Kind: kind}
	// The base branch is a setting, prefilled from the repository rather than
	// guessed: written down now, it is a value somebody can see and change,
	// which "ask git every time" would never be.
	entry.BaseBranch = DefaultBaseBranch(m.rootCtx, clean)
	m.cfg.Workdirs = append(m.cfg.Workdirs, entry)
	return entry, m.persistConfigLocked()
}

// newWorkdirID makes the id a card will point at. It doubles as the id of the
// board option that offers the folder, so it has to be unique among a
// property's options and legible in the board's own JSON — a prefix and a uuid,
// which is what every other id in a board looks like.
func newWorkdirID() string { return "wd-" + uuid.NewString() }

// ensureWorkdirIDs gives an id to every entry written before there were any.
// Once, at startup, and persisted: the id is what the board's option is created
// under, so it has to exist before anything offers the folder to a board.
func (m *Manager) ensureWorkdirIDs() {
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	changed := false
	for i := range m.cfg.Workdirs {
		if strings.TrimSpace(m.cfg.Workdirs[i].ID) == "" {
			m.cfg.Workdirs[i].ID = newWorkdirID()
			changed = true
		}
	}
	if !changed {
		return
	}
	if err := m.persistConfigLocked(); err != nil {
		m.log.Warn("acp: cannot record the folders' ids", "err", err)
	}
}

// ShareWorkdir marks a folder as every board's. It is the answer to "this
// folder is already registered on another board": one checkout worked from two
// boards is an ordinary arrangement, and the alternative — refusing, and
// leaving somebody to find the board it belongs to and change it there — is a
// refusal that teaches nothing.
func (m *Manager) ShareWorkdir(name string) (WorkdirEntry, error) {
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	for i, r := range m.cfg.Workdirs {
		if !strings.EqualFold(r.Name, name) {
			continue
		}
		m.cfg.Workdirs[i].Global = true
		return m.cfg.Workdirs[i], m.persistConfigLocked()
	}
	return WorkdirEntry{}, fmt.Errorf("папка %q не найдена", name)
}

// WorkdirAt is the registry entry for a path, whichever board it belongs to.
// Asked before a folder is added, so "already added" can be an offer rather
// than an error.
func (m *Manager) WorkdirAt(path string) (WorkdirEntry, bool) {
	clean := filepath.Clean(strings.TrimSpace(path))
	if clean == "" || clean == "." {
		return WorkdirEntry{}, false
	}
	for _, r := range m.Workdirs() {
		if filepath.Clean(r.Path) == clean {
			return r, true
		}
	}
	return WorkdirEntry{}, false
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
	// Mode is how work here is arranged **on the board that asked**, resolved:
	// "worktree", "branch", or "plain" for a folder that is not a repository.
	// The screen draws the answer rather than the setting, so a folder that has
	// never been asked still says which of the two it does.
	Mode string `json:"mode"`
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
		out = append(out, m.workdirStatus(boardID, e))
	}
	return out
}

func (m *Manager) workdirStatus(boardID string, e WorkdirEntry) WorkdirStatus {
	st := WorkdirStatus{WorkdirEntry: e, Git: IsGitWorkdir(m.rootCtx, e.Path), Mode: WorkModePlain}
	if st.Git {
		st.Base = m.BaseBranchOf(e)
		st.Mode = m.WorkMode(boardID, e)
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
	// The registries live in tables now (registrymove.go), so they are saved
	// whether or not there is a settings file to write — which is also what
	// gives a test a registry that survives a restart without one.
	if err := m.persistRegistriesLocked(); err != nil {
		m.log.Error("acp: failed to persist the registries", "err", err)
		return fmt.Errorf("не удалось сохранить реестры: %w", err)
	}
	if m.cfgPath == "" {
		return nil // tests / ephemeral configs
	}
	if err := SaveConfig(m.cfgPath, m.configToStore()); err != nil {
		m.log.Error("acp: failed to persist config", "err", err)
		return fmt.Errorf("не удалось сохранить конфиг: %w", err)
	}
	return nil
}

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

// resolveWorkdir maps a trigger event to a folder path.
//
// There used to be a step in front of this one: a card could name a directory
// outright, in a `project_path` or `repo_path` field, and that path won over
// the folder field. It was the second way to say the same thing (contradiction
// 6 of docs/model-graph.md) and the worse one — nothing creates such a field,
// it means nothing on another machine, and being a path rather than a reference
// it tied to no registry entry, so the only thing standing between a card and
// any directory on the disk was a whitelist in the settings file. Both are
// gone; a card says where it works by naming a folder, and only that.
func (m *Manager) resolveWorkdir(ev CardMoved) (string, error) {
	// Only what this board offers: a folder another board added must not take an
	// agent into a checkout this board knows nothing about.
	workdirs := m.WorkdirsForBoard(ev.BoardID)

	// The card's own folder field, found by the id the board recorded, and the
	// entry found by the id the option carries. Nothing is recognised by name:
	// this used to scan every selected option on the card — and then the name of
	// the column it came from — for anything spelled like a registry entry, so a
	// label named after a repository decided where an agent worked, and which of
	// two matches won changed between events (the names came from ranging over
	// the property schema, which is a Go map).
	entry, ok := m.cardWorkdir(ev, workdirs)
	if ok {
		if info, err := os.Stat(entry.Path); err != nil || !info.IsDir() {
			return "", fmt.Errorf("папка %q указывает на несуществующий каталог %s", entry.Name, entry.Path)
		}
		return entry.Path, nil
	}
	if len(workdirs) == 0 {
		return "", errNoWorkdir{fmt.Errorf("у карточки не заполнено поле «Папка» и в реестре нет ни одной папки (меню доски → «Папки…»)")}
	}
	return "", errNoWorkdir{fmt.Errorf("в поле «Папка» карточки не выбрана ни одна папка из реестра (%s)", workdirNames(workdirs))}
}

// cardWorkdir is the registry entry a card points at, among the ones this board
// offers.
//
// The option's **id** is the entry's id: the board's folder options are created
// under it (workdirSync.ts), so a card that names a folder is a card holding
// that id, and what the folder is called is free to change — or to stop being a
// folder name at all, which is where this is going: a place to work need not be
// a directory on this disk.
//
// Two fallbacks, both for data that predates the id. An option made before this
// carries an id of the board's own, so the entry is matched by the option's
// *name*; and a board that never recorded which property holds the folder gets
// the old scan across everything selected on the card, which is the only thing
// such a board can say.
func (m *Manager) cardWorkdir(ev CardMoved, workdirs []WorkdirEntry) (WorkdirEntry, bool) {
	if propID := m.boardProperty(ev.BoardID, BoardPropProject); propID != "" {
		for _, sel := range ev.SelectedOptions {
			if sel.PropertyID != propID {
				continue
			}
			for _, r := range workdirs {
				if r.ID != "" && r.ID == sel.OptionID {
					return r, true
				}
			}
			return matchWorkdirName(workdirs, sel.Name)
		}
		return WorkdirEntry{}, false
	}
	for _, name := range append(append([]string(nil), ev.OptionNames...), ev.FromColumn.Name) {
		if r, ok := matchWorkdirName(workdirs, name); ok {
			return r, true
		}
	}
	return WorkdirEntry{}, false
}

func matchWorkdirName(workdirs []WorkdirEntry, name string) (WorkdirEntry, bool) {
	name = strings.TrimSpace(name)
	if name == "" {
		return WorkdirEntry{}, false
	}
	for _, r := range workdirs {
		if strings.EqualFold(name, r.Name) {
			return r, true
		}
	}
	return WorkdirEntry{}, false
}

func workdirNames(workdirs []WorkdirEntry) string {
	names := make([]string, len(workdirs))
	for i, r := range workdirs {
		names[i] = r.Name
	}
	return strings.Join(names, ", ")
}
