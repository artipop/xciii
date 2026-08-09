package secrets

import (
	"errors"
	"strings"

	"github.com/zalando/go-keyring"
)

// The platform's own credential store: Keychain on macOS, Credential Manager on
// Windows, the Secret Service over D-Bus on Linux.
//
// Through zalando/go-keyring rather than through three implementations of our
// own, and rather than through cgo. This app already pays for cgo twice —
// SQLite and Wails — and a third reason to need a C toolchain, for what is
// three calls per platform, would be a bad trade: the library reaches Windows
// through wincred and Linux through D-Bus, both in pure Go, and macOS through
// the `security` tool. It also carries the one macOS quirk worth having
// somebody else's code for: `security` prints anything that is not plain ASCII
// as hex, with nothing to say that it did, and the library encodes and decodes
// around it.
//
// Where there is no store — a headless Linux with no secret service, which is
// what a server build runs on — this reports itself unavailable and the caller
// falls back to the file store. That is the right answer there rather than a
// worse one: a machine with no session has nowhere to keep a secret that is
// better than a file only its owner can read.

// Keyring stores secrets under one service name, which is the "where" a person
// sees in Keychain Access or Credential Manager. The key becomes the account,
// so one app's secrets are one group to look at, and to revoke, together.
type Keyring struct {
	Service string
}

var _ Store = Keyring{}

func (k Keyring) Get(key string) (string, error) {
	value, err := keyring.Get(k.Service, key)
	if err != nil {
		if errors.Is(err, keyring.ErrNotFound) {
			return "", ErrNotFound
		}
		return "", err
	}
	return value, nil
}

func (k Keyring) Set(key, value string) error {
	return keyring.Set(k.Service, key, value)
}

func (k Keyring) Delete(key string) error {
	err := keyring.Delete(k.Service, key)
	if errors.Is(err, keyring.ErrNotFound) {
		return ErrNotFound
	}
	return err
}

// probeKey is read to find out whether there is a store at all. Reading rather
// than writing: an item nothing uses would otherwise appear in somebody's
// keychain for no reason, and a store that answers "no such item" has answered.
const probeKey = "xciii.probe"

// OpenKeychain returns the platform's store when this machine has one.
//
// Availability cannot be asked for — the library has no such call — so it is
// found out by asking for something that is not there: ErrNotFound means a
// working store, and anything else means no store to work with (an unsupported
// platform, or a Linux with no secret service running).
func OpenKeychain(service string) (Store, bool) {
	store := Keyring{Service: strings.TrimSpace(service)}
	if store.Service == "" {
		return nil, false
	}
	if _, err := store.Get(probeKey); err != nil && !errors.Is(err, ErrNotFound) {
		return nil, false
	}
	return store, true
}
