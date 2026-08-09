package sources

import (
	"embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Manifests this app ships. A service somebody else wrote an MCP server for is
// a file in the data directory; a service *this* app carries a server for is a
// file here, so it is in the dialog from the first run with nothing to install,
// no path to type and no runtime to have. Today that is Kaiten (see
// internal/sources/kaiten): its command is this binary re-invoked, which is
// what SelfCommand stands for.
//
//go:embed manifests/*.json
var builtinManifests embed.FS

// SelfCommand is what a manifest writes instead of a path to this application.
// A packaged app has no checkout to point at, and a person adding a source
// should not be asked where the app they are using lives.
const SelfCommand = "$self"

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

// Builtin returns the manifests this app ships. A file that does not validate
// is a bug in this repository rather than in somebody's data directory, so it
// is reported the same way and skipped the same way: the app has to come up.
func Builtin() ([]Manifest, []error) {
	entries, err := builtinManifests.ReadDir("manifests")
	if err != nil {
		return nil, []error{err}
	}
	var (
		out  []Manifest
		errs []error
	)
	for _, entry := range entries {
		raw, err := builtinManifests.ReadFile("manifests/" + entry.Name())
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", entry.Name(), err))
			continue
		}
		var manifest Manifest
		if err := json.Unmarshal(raw, &manifest); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", entry.Name(), err))
			continue
		}
		valid, err := manifest.Validate()
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", entry.Name(), err))
			continue
		}
		out = append(out, valid)
	}
	return out, errs
}

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

// SetCatalog hands over the manifests read from the manifests directory. What
// this app ships is added underneath them, so a file somebody wrote wins over a
// built-in one of the same name — the way to change what a shipped manifest
// does is to write your own beside it.
func (m *Manager) SetCatalog(manifests []Manifest) {
	own, _ := Builtin()
	catalog := append([]Manifest(nil), manifests...)
	for _, manifest := range own {
		if !hasManifest(catalog, manifest.Name) {
			catalog = append(catalog, manifest)
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.catalog = catalog
}
