// Package secrets keeps the credentials the app has to present to somebody
// else — an OAuth access token, an API key. It is deliberately not where an
// *inbound* token lives: a token the app only ever checks is kept as a hash,
// which cannot leak access at all (see internal/sources, TokenHash).
//
// The store the app uses is the operating system's own where there is one:
// Keychain on macOS (keychain_darwin.go). Credential Manager and the Secret
// Service are the same shape of thing and are not written yet, so on Windows
// and Linux this still falls back to the file store below — which keeps values
// in plain text, at 0600, and says so.
//
// Encrypting that file with a key lying beside it on the same disk would be
// theatre, and the app already keeps proxy passwords and a GitHub token in a
// config file at 0600 — so it is not a new exposure, but it is not the end
// state either.
package secrets

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Store is the whole surface. A key is a name the caller chose (a source's
// secretRef); what is behind it is a string.
type Store interface {
	Get(key string) (string, error)
	Set(key, value string) error
	Delete(key string) error
}

// ErrNotFound is returned when nothing is stored under the key. It is a value
// rather than a formatted error so a caller can tell "no credential yet" from
// "the store is broken", which are different situations: the first asks a
// person to connect the source, the second is a bug.
var ErrNotFound = fmt.Errorf("секрет не найден")

// FileStore keeps secrets in one JSON file. Safe for concurrent use.
type FileStore struct {
	path string

	mu     sync.Mutex
	loaded bool
	values map[string]string
}

var _ Store = (*FileStore)(nil)

// NewFileStore returns a store backed by path. The file is created on the first
// write, so a machine with no secrets has no file.
func NewFileStore(path string) *FileStore {
	return &FileStore{path: path, values: map[string]string{}}
}

func (s *FileStore) Get(key string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.loadLocked(); err != nil {
		return "", err
	}
	value, ok := s.values[key]
	if !ok {
		return "", ErrNotFound
	}
	return value, nil
}

func (s *FileStore) Set(key, value string) error {
	if strings.TrimSpace(key) == "" {
		return fmt.Errorf("у секрета нет имени")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.loadLocked(); err != nil {
		return err
	}
	s.values[key] = value
	return s.saveLocked()
}

func (s *FileStore) Delete(key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.loadLocked(); err != nil {
		return err
	}
	if _, ok := s.values[key]; !ok {
		return nil
	}
	delete(s.values, key)
	return s.saveLocked()
}

func (s *FileStore) loadLocked() error {
	if s.loaded {
		return nil
	}
	b, err := os.ReadFile(s.path)
	switch {
	case os.IsNotExist(err):
		s.values = map[string]string{}
	case err != nil:
		return err
	default:
		if err := json.Unmarshal(b, &s.values); err != nil {
			// A file that cannot be read is not quietly replaced: overwriting
			// it would destroy every credential in it, and a person can still
			// fix a file they are told about.
			return fmt.Errorf("не удалось прочитать %s: %w", s.path, err)
		}
	}
	s.loaded = true
	return nil
}

// saveLocked writes through a temporary file, so an interrupted write cannot
// leave the store as half a JSON document — which would take every other secret
// with it.
func (s *FileStore) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	out, err := json.MarshalIndent(s.values, "", "  ")
	if err != nil {
		return err
	}
	temp := s.path + ".tmp"
	if err := os.WriteFile(temp, append(out, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Chmod(temp, 0o600); err != nil {
		_ = os.Remove(temp)
		return err
	}
	return os.Rename(temp, s.path)
}

// Env is a read-only store over the environment, for a credential given to the
// app from outside — a CI run, a script, somebody who does not want the app to
// keep it at all. Keys are upper-cased and non-letters become underscores, so
// «почта» is XCIII_SOURCE_ТОКЕН-shaped rather than unreachable.
type Env struct {
	Prefix string
}

var _ Store = Env{}

func (e Env) Get(key string) (string, error) {
	if value, ok := os.LookupEnv(e.name(key)); ok {
		return value, nil
	}
	return "", ErrNotFound
}

// Set and Delete exist to satisfy the interface. The environment of a running
// process is not a place to keep anything: what is written here is gone at
// exit, and pretending otherwise would lose a token somebody typed.
func (e Env) Set(string, string) error {
	return fmt.Errorf("секрет из окружения нельзя изменить из приложения")
}

func (e Env) Delete(string) error {
	return fmt.Errorf("секрет из окружения нельзя удалить из приложения")
}

func (e Env) name(key string) string {
	var b strings.Builder
	b.WriteString(e.Prefix)
	for _, r := range strings.ToUpper(key) {
		switch {
		case r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	return b.String()
}

// Chain tries each store in order for a read, and writes to the first that
// accepts. It is how a credential from the environment wins over a stored one
// without the caller having to know either exists.
type Chain []Store

var _ Store = Chain{}

func (c Chain) Get(key string) (string, error) {
	for _, store := range c {
		value, err := store.Get(key)
		if err == nil {
			return value, nil
		}
		if err != ErrNotFound {
			return "", err
		}
	}
	return "", ErrNotFound
}

func (c Chain) Set(key, value string) error {
	for _, store := range c {
		if err := store.Set(key, value); err == nil {
			return nil
		}
	}
	return fmt.Errorf("секрет некуда сохранить")
}

func (c Chain) Delete(key string) error {
	for _, store := range c {
		if err := store.Delete(key); err != nil && err != ErrNotFound {
			continue
		}
	}
	return nil
}
