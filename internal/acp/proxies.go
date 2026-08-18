package acp

import (
	"fmt"
	"strings"
)

// Proxy registry: named network configurations (proxy URL, bypass list, CA
// bundle), edited from the desktop UI and persisted into the config file.
// Agents reference an entry by name instead of carrying their own settings, so
// one configuration serves several agents and is changed in a single place.

// Proxies returns a snapshot of the registry.
func (m *Manager) Proxies() []ProxyEntry {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	return append([]ProxyEntry(nil), m.cfg.Proxies...)
}

// validateProxy normalizes and checks a registry entry.
func validateProxy(p ProxyEntry) (ProxyEntry, error) {
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" {
		return ProxyEntry{}, fmt.Errorf("имя конфигурации не может быть пустым")
	}
	net, err := p.NetworkSettings.Validate("") // kind-specific checks happen per agent
	if err != nil {
		return ProxyEntry{}, err
	}
	p.NetworkSettings = net
	if p.IsZero() {
		return ProxyEntry{}, fmt.Errorf("конфигурация %q пустая: задай прокси, список исключений или CA-сертификат", p.Name)
	}
	return p, nil
}

// AddProxy registers a new network configuration and persists the config.
func (m *Manager) AddProxy(p ProxyEntry) (ProxyEntry, error) {
	p, err := validateProxy(p)
	if err != nil {
		return ProxyEntry{}, err
	}
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	for _, e := range m.cfg.Proxies {
		if strings.EqualFold(e.Name, p.Name) {
			return ProxyEntry{}, fmt.Errorf("конфигурация с именем %q уже существует", e.Name)
		}
	}
	m.cfg.Proxies = append(m.cfg.Proxies, p)
	return p, m.persistConfigLocked()
}

// UpdateProxy replaces an existing entry and persists. Agents referencing it are
// re-checked, so an edit cannot leave one unusable (e.g. a SOCKS URL under an
// agent whose CLI has no SOCKS support).
//
// Matched by id where the caller has one, so renaming a configuration is an
// edit rather than a lookup that fails — the same trap UpdateDeploy had.
func (m *Manager) UpdateProxy(p ProxyEntry) (ProxyEntry, error) {
	p, err := validateProxy(p)
	if err != nil {
		return ProxyEntry{}, err
	}
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	for i, e := range m.cfg.Proxies {
		if !sameProxyEntry(e, p) {
			continue
		}
		for _, a := range m.cfg.Agents {
			if !usesProxy(a, e) {
				continue
			}
			if _, err := p.NetworkSettings.Validate(a.Kind); err != nil {
				return ProxyEntry{}, fmt.Errorf("агент %q (%s) не сможет использовать эту конфигурацию: %w", a.Name, a.Kind, err)
			}
		}
		if name := strings.TrimSpace(p.Name); !strings.EqualFold(e.Name, name) {
			if _, taken := proxyByName(m.cfg.Proxies, name); taken {
				return ProxyEntry{}, fmt.Errorf("конфигурация с именем %q уже существует", name)
			}
		}
		p.ID = e.ID
		m.cfg.Proxies[i] = p
		return p, m.persistConfigLocked()
	}
	return ProxyEntry{}, fmt.Errorf("конфигурация %q не найдена", p.Name)
}

// RemoveProxy deletes an entry by name, refusing while agents still reference
// it — otherwise they would silently fall back to the app's own environment.
func (m *Manager) RemoveProxy(name string) error {
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()
	var used []string
	target, known := proxyByName(m.cfg.Proxies, name)
	for _, a := range m.cfg.Agents {
		if known && usesProxy(a, target) {
			used = append(used, a.Name)
		}
	}
	if len(used) > 0 {
		return fmt.Errorf("конфигурацию %q используют агенты: %s — сначала переключи их", name, strings.Join(used, ", "))
	}
	for i, e := range m.cfg.Proxies {
		if strings.EqualFold(e.Name, name) {
			m.cfg.Proxies = append(m.cfg.Proxies[:i], m.cfg.Proxies[i+1:]...)
			return m.persistConfigLocked()
		}
	}
	return fmt.Errorf("конфигурация %q не найдена", name)
}

// resolveNetwork returns the network settings an agent runs with: the registry
// entry it names, validated against its kind. An agent naming nothing runs with
// the app's own environment.
func (m *Manager) resolveNetwork(a AgentEntry) (NetworkSettings, error) {
	m.cfgMu.RLock()
	proxies := append([]ProxyEntry(nil), m.cfg.Proxies...)
	m.cfgMu.RUnlock()
	return resolveNetworkIn(proxies, a)
}

// resolveNetworkIn is resolveNetwork against an explicit registry snapshot, so
// callers already holding cfgMu can use it too.
func resolveNetworkIn(proxies []ProxyEntry, a AgentEntry) (NetworkSettings, error) {
	// The id is the selection; the name is only still read for an entry saved
	// before ids, which bindAgentRefs folds away the first time it is loaded.
	if p, ok := proxyByID(proxies, a.ProxyID); ok {
		return p.NetworkSettings.Validate(a.Kind)
	}
	name := strings.TrimSpace(a.ProxyName)
	if name == "" && strings.TrimSpace(a.ProxyID) == "" {
		return NetworkSettings{}, nil
	}
	if p, ok := proxyByName(proxies, name); ok {
		return p.NetworkSettings.Validate(a.Kind)
	}
	return NetworkSettings{}, fmt.Errorf("прокси-конфигурация агента %q не найдена в реестре (есть: %s)", a.Name, proxyNames(proxies))
}

func proxyNames(proxies []ProxyEntry) string {
	if len(proxies) == 0 {
		return "реестр пуст"
	}
	names := make([]string, len(proxies))
	for i, p := range proxies {
		names[i] = p.Name
	}
	return strings.Join(names, ", ")
}

// usesProxy reports whether this agent runs through this configuration — by id,
// and by name only for an entry whose name has not been folded into one yet.
func usesProxy(a AgentEntry, p ProxyEntry) bool {
	if id := strings.TrimSpace(a.ProxyID); id != "" {
		return id == p.ID
	}
	return strings.EqualFold(strings.TrimSpace(a.ProxyName), strings.TrimSpace(p.Name))
}

// sameProxyEntry is which row an edit is about: the id when the caller carries
// one, else the name — a form filled in before ids still has to find its row.
func sameProxyEntry(existing, edit ProxyEntry) bool {
	if id := strings.TrimSpace(edit.ID); id != "" {
		return existing.ID == id
	}
	return strings.EqualFold(existing.Name, strings.TrimSpace(edit.Name))
}
