// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"encoding/json"
	"log"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// What the app remembers between launches, which is one thing: where the boards
// are. There is no config file on a phone, so it goes in the store the platform
// gives us — the Keychain on iOS, EncryptedSharedPreferences on Android — and
// that store is the right one for it anyway: an address names a machine on a
// private network, and is a fact about the person's tailnet.
//
// It is a list because a person has more than one desktop, and each of them
// publishes its own front door on the tailnet under its own name. The app shows
// one tab per machine and one frame behind each tab, so the machines stay what
// they are — separate boards on separate origins, each talking to its own
// desktop — rather than being merged into something neither of them serves.

// machinesKey is what the list is stored under, and addressKey is the single
// address earlier versions kept. Both are read on launch, so both names are
// part of the app's compatibility surface.
const (
	machinesKey = "xciii.board.machines"
	addressKey  = "xciii.board.address"
)

// Machine is one board, as the page needs it: what was typed (which is what a
// person recognises and what removing one names), the address to load, and the
// word on the tab.
type Machine struct {
	Address string `json:"address"`
	URL     string `json:"url"`
	Label   string `json:"label"`
}

// Settings is the service the app's own page calls. Its methods are the whole
// surface: which boards there are, add this one, forget that one.
type Settings struct {
	store  secureStore
	window *application.WebviewWindow
}

func newSettings() *Settings { return &Settings{store: platformStore{}} }

// attach hands the service the window, and arranges the way back.
//
// The window stays on the app's own page for good now — the boards are frames
// inside it — so a failed navigation is no longer the ordinary way to a wrong
// address. It is kept because a frame is still allowed to navigate the window
// that holds it, and a window taken somewhere it cannot load would be an app
// with no address bar and no way home.
func (s *Settings) attach(window *application.WebviewWindow) {
	s.window = window
	window.OnWindowEvent(events.IOS.WebViewDidFailNavigation, func(*application.WindowEvent) {
		log.Printf("navigation failed; back to the app's own page")
		window.SetURL("/")
	})
}

// Machines is the list the page draws, oldest first. An address that no longer
// parses is left out rather than failing the call: the rest of the machines are
// still reachable, and the setup panel is where a broken one is dealt with.
func (s *Settings) Machines() string {
	stored := s.stored()
	machines := make([]Machine, 0, len(stored))
	for _, address := range stored {
		url, err := boardURL(address)
		if err != nil {
			continue
		}
		machines = append(machines, Machine{Address: address, URL: url, Label: machineLabel(address)})
	}
	payload, err := json.Marshal(machines)
	if err != nil {
		return "[]"
	}
	return string(payload)
}

// Add remembers a machine and returns the list it joined. Adding one twice is
// not an error — it is a person who does not remember whether they had — so it
// is the same list back, and the tab they wanted is already on it.
func (s *Settings) Add(address string) (string, error) {
	url, err := boardURL(address)
	if err != nil {
		return "", err
	}
	stored := s.stored()
	for _, existing := range stored {
		if same, err := boardURL(existing); err == nil && same == url {
			return s.Machines(), nil
		}
	}
	if err := s.save(append(stored, strings.TrimSpace(address))); err != nil {
		return "", err
	}
	return s.Machines(), nil
}

// Remove drops a machine. It matches on the address it loads rather than on the
// characters typed, so a machine added as "board" is removed by "board" or by
// "https://board/" alike — and an entry that no longer parses is still removable
// by the string it was stored as, which is the only handle a broken one has.
func (s *Settings) Remove(address string) (string, error) {
	target, targetErr := boardURL(address)
	kept := make([]string, 0)
	for _, existing := range s.stored() {
		if existing == address {
			continue
		}
		if same, err := boardURL(existing); targetErr == nil && err == nil && same == target {
			continue
		}
		kept = append(kept, existing)
	}
	if err := s.save(kept); err != nil {
		return "", err
	}
	return s.Machines(), nil
}

// stored is the list as it is kept, with the one address earlier versions saved
// counted as a list of one. That migration happens on a read rather than on a
// launch because a read is the only place both keys are known to be needed —
// and it is idempotent: the first write drops the old key.
func (s *Settings) stored() []string {
	raw := s.store.get(machinesKey)
	if raw == "" {
		if single := strings.TrimSpace(s.store.get(addressKey)); single != "" {
			return []string{single}
		}
		return nil
	}
	var list []string
	if err := json.Unmarshal([]byte(raw), &list); err != nil {
		// A store that no longer holds a list holds nothing we can use, and
		// asking for the addresses again is better than an app that will not
		// start.
		return nil
	}
	return list
}

func (s *Settings) save(list []string) error {
	payload, err := json.Marshal(list)
	if err != nil {
		return err
	}
	s.store.set(machinesKey, string(payload))
	s.store.delete(addressKey)
	return nil
}

// secureStore is the platform's own key/value store. It is an interface because
// the one thing that differs between iOS and Android — the shape of a write —
// is not worth spreading through the code above, and because a test has no
// Keychain.
type secureStore interface {
	get(key string) string
	set(key, value string)
	delete(key string)
}
