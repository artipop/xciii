package sources

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Where manifests come from.
//
// A manifest is a file rather than a branch in this code, for the reason the
// whole subsystem is built on: a source is a plugin, and adding one must not
// mean editing the app. With MCP that goes one step further — a manifest is
// also the *entire* adapter (see mcpsource.go), so adding a service somebody
// already wrote an MCP server for is one JSON file and no program at all:
//
//	<dataDir>/sources/manifests/kaiten.json
//
// They are not copied into sources.json. The registry holds what a person
// configured — sources, and manifests they typed there themselves — while this
// is a directory that is read at startup, so a file that is edited takes effect
// on the next run and a file that is deleted stops being offered. A manifest in
// sources.json wins over one here of the same name: what somebody typed by hand
// is more likely to be what they meant than what they dropped in a folder.

// ManifestsDir is where manifests are read from, under the sources data
// directory.
const ManifestsDir = "manifests"

// LoadManifests reads every *.json in dir. A file that cannot be read or does
// not validate is reported and skipped, never fatal: one bad manifest must not
// take the other sources down with it, and the app has to come up to be able to
// say what was wrong.
func LoadManifests(dir string) ([]Manifest, []error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, []error{fmt.Errorf("каталог манифестов %s: %w", dir, err)}
	}
	var (
		out  []Manifest
		errs []error
	)
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".json") {
			continue
		}
		names = append(names, entry.Name())
	}
	// Read in name order so two manifests claiming one name resolve the same
	// way on every start rather than by whatever the filesystem said first.
	sort.Strings(names)
	for _, name := range names {
		path := filepath.Join(dir, name)
		raw, err := os.ReadFile(path)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", name, err))
			continue
		}
		var manifest Manifest
		if err := json.Unmarshal(raw, &manifest); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", name, err))
			continue
		}
		valid, err := manifest.Validate()
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", name, err))
			continue
		}
		out = append(out, valid)
	}
	return out, errs
}

// SetCatalog hands over the manifests read from the manifests directory.
func (m *Manager) SetCatalog(manifests []Manifest) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.catalog = append([]Manifest(nil), manifests...)
}
