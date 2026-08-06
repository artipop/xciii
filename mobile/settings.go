// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// What the app remembers between launches, which is one thing: where the board
// is. There is no config file on a phone, so it goes in the store the platform
// gives us — the Keychain on iOS, EncryptedSharedPreferences on Android — and
// that store is the right one for it anyway: the address names a machine on a
// private network, and is a fact about the person's tailnet.

// addressKey is what the address is stored under. It is read on every launch,
// so the name is part of the app's compatibility surface.
const addressKey = "xciii.board.address"

// Settings is the service the setup page calls. Its methods are the whole
// surface: what is saved, save this, forget it.
type Settings struct {
	store  secureStore
	window *application.WebviewWindow
}

func newSettings() *Settings { return &Settings{store: platformStore{}} }

// attach hands the service the window it navigates. main creates the window
// with the address already known, so this only matters afterwards — when
// somebody connects, or disconnects.
//
// It also arranges the way back. Once the window is on the board, the setup
// page is unreachable — it is a different origin, and a phone has no address
// bar — so an address typed wrong would strand the app on a blank screen for
// good. A navigation that fails returns to the setup page, which is also the
// right answer when the desktop is simply asleep: the field comes back filled
// in, and connecting again is one tap.
func (s *Settings) attach(window *application.WebviewWindow) {
	s.window = window
	window.OnWindowEvent(events.IOS.WebViewDidFailNavigation, func(*application.WindowEvent) {
		log.Printf("the board could not be opened; back to the setup page")
		window.SetURL("/")
	})
}

// startURL is what the window opens with: the board if we know where it is, and
// the setup page if we do not. An empty string leaves the window on the app's
// own assets, which is where the setup page lives.
func (s *Settings) startURL() string {
	saved := s.store.get(addressKey)
	if saved == "" {
		return ""
	}
	url, err := boardURL(saved)
	if err != nil {
		// A stored address that no longer parses is not worth failing over:
		// the setup page asks for it again.
		return ""
	}
	return url
}

// Address is what the setup page fills its field with, so a person correcting a
// typo does not retype the whole name.
func (s *Settings) Address() string { return s.store.get(addressKey) }

// Connect saves the address and takes the window to the board. The address is
// stored as typed rather than as a URL: it is what the field shows next time,
// and the URL is derived from it every launch anyway.
func (s *Settings) Connect(address string) (string, error) {
	url, err := boardURL(address)
	if err != nil {
		return "", err
	}
	s.store.set(addressKey, address)
	if s.window != nil {
		s.window.SetURL(url)
	}
	return url, nil
}

// Forget drops the address and returns to the setup page — the way back from a
// board that has moved, or one that was typed wrong and saved.
func (s *Settings) Forget() error {
	s.store.delete(addressKey)
	if s.window != nil {
		s.window.SetURL("/")
	}
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
