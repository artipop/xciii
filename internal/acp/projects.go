package acp

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Project registry: named local projects, edited from the desktop UI and
// persisted back into the config file. Cards are mapped to a project when one of
// their select/multiSelect option names (e.g. a tag) matches an entry name.

// Projects returns a snapshot of the registry.
func (m *Manager) Projects() []ProjectEntry {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	return append([]ProjectEntry(nil), m.cfg.Projects...)
}

// AddProject registers a local project under name (defaults to the directory
// basename) and persists the config. Any folder will do — see IsGitProject for
// what being under git adds.
//
// TODO: validate the name as a hostname label. A deploy target names its apps
// and its subdomain after the project (dokku.AppLabel), so a name that is not
// a valid DNS label is folded there silently, and two names that fold together
// would share one subdomain. The check belongs here, where the name is typed.
//
// TODO: this entry is also where a preview's own settings belong — config
// variables for the branch app, whether to request a Let's Encrypt certificate,
// how long a build may take. They were on the deploy target, which is wrong: a
// target is a machine, and those describe the thing being deployed.
func (m *Manager) AddProject(name, path string) (ProjectEntry, error) {
	if !filepath.IsAbs(path) {
		return ProjectEntry{}, fmt.Errorf("путь должен быть абсолютным: %s", path)
	}
	clean := filepath.Clean(path)
	info, err := os.Stat(clean)
	if err != nil || !info.IsDir() {
		return ProjectEntry{}, fmt.Errorf("каталог не найден: %s", clean)
	}
	// A project under git gets worktrees and branch-driven transitions; one
	// without is an ordinary folder an agent works in, which is all a board of
	// personal tasks ever needs. Neither is refused here (see IsGitProject).
	name = strings.TrimSpace(name)
	if name == "" {
		name = filepath.Base(clean)
	}

	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	for _, r := range m.cfg.Projects {
		if strings.EqualFold(r.Name, name) {
			return ProjectEntry{}, fmt.Errorf("имя %q уже занято (%s)", r.Name, r.Path)
		}
		if filepath.Clean(r.Path) == clean {
			return ProjectEntry{}, fmt.Errorf("проект уже добавлен как %q", r.Name)
		}
	}
	entry := ProjectEntry{Name: name, Path: clean}
	m.cfg.Projects = append(m.cfg.Projects, entry)
	return entry, m.persistConfigLocked()
}

// RemoveProject deletes a registry entry by name and persists the config.
func (m *Manager) RemoveProject(name string) error {
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	for i, r := range m.cfg.Projects {
		if strings.EqualFold(r.Name, name) {
			m.cfg.Projects = append(m.cfg.Projects[:i], m.cfg.Projects[i+1:]...)
			return m.persistConfigLocked()
		}
	}
	return fmt.Errorf("проект %q не найден", name)
}

func (m *Manager) persistConfigLocked() error {
	if m.cfgPath == "" {
		return nil // tests / ephemeral configs
	}
	if err := SaveConfig(m.cfgPath, m.cfg); err != nil {
		m.log.Error("acp: failed to persist config", "err", err)
		return fmt.Errorf("не удалось сохранить конфиг: %w", err)
	}
	return nil
}

// resolveProject maps a trigger event to a project path. Priority:
//  1. explicit repo_path card property (validated against whitelist+registry);
//  2. a select/multiSelect option name (tag) matching a registry entry;
//  3. the name of the column the card was dragged out of — supports boards
//     whose trigger property has one lane per project.
//
// resolveNamedProject looks a registry entry up by name. Opening a console on a
// card that carries no project tag would otherwise be a dead end: the card
// is not going to grow one just because someone wants to talk about it.
func (m *Manager) resolveNamedProject(name string) (string, error) {
	m.cfgMu.RLock()
	projects := append([]ProjectEntry(nil), m.cfg.Projects...)
	m.cfgMu.RUnlock()
	for _, r := range projects {
		if strings.EqualFold(strings.TrimSpace(name), r.Name) {
			if info, err := os.Stat(r.Path); err != nil || !info.IsDir() {
				return "", fmt.Errorf("проект %q указывает на несуществующий каталог %s", r.Name, r.Path)
			}
			return r.Path, nil
		}
	}
	return "", fmt.Errorf("проект %q не найден в реестре (%s)", name, projectNames(projects))
}

// cardProjectPathProps are the card fields that name a path outright, newest
// first. `repo_path` is what the field was called before projects were called
// projects, and a card that already carries one keeps working: a board is
// somebody's data, and renaming a field under them would quietly stop their
// cards from finding anywhere to run.
var cardProjectPathProps = []string{"project_path", "repo_path"}

// firstProp returns the first of the named card fields that has a value.
func firstProp(props map[string]string, names []string) string {
	for _, name := range names {
		if v := strings.TrimSpace(props[name]); v != "" {
			return v
		}
	}
	return ""
}

func (m *Manager) resolveProject(ev CardMoved) (string, error) {
	if explicit := firstProp(ev.Props, cardProjectPathProps); explicit != "" {
		m.cfgMu.RLock()
		cfg := m.cfg
		m.cfgMu.RUnlock()
		return cfg.ValidateProjectPath(explicit)
	}

	m.cfgMu.RLock()
	projects := append([]ProjectEntry(nil), m.cfg.Projects...)
	m.cfgMu.RUnlock()

	candidates := append(append([]string(nil), ev.OptionNames...), ev.FromColumn.Name)
	for _, opt := range candidates {
		for _, r := range projects {
			if strings.EqualFold(strings.TrimSpace(opt), r.Name) {
				if info, err := os.Stat(r.Path); err != nil || !info.IsDir() {
					return "", fmt.Errorf("проект %q указывает на несуществующий каталог %s", r.Name, r.Path)
				}
				return r.Path, nil
			}
		}
	}
	if len(projects) == 0 {
		return "", fmt.Errorf("у карточки не заполнено поле «Проекты» и в реестре нет ни одного проекта (меню доски → «Проекты…»)")
	}
	return "", fmt.Errorf("ни тег карточки, ни исходная колонка не совпали с проектом из реестра (%s)", projectNames(projects))
}

func projectNames(projects []ProjectEntry) string {
	names := make([]string, len(projects))
	for i, r := range projects {
		names[i] = r.Name
	}
	return strings.Join(names, ", ")
}
