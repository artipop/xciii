// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import "testing"

// What somebody types on a phone is a machine name, and what a webview needs is
// an absolute https address ending at the page written for a phone. Getting
// this wrong is a blank screen with nothing to read, so it is the one thing
// here worth testing without a device.
func TestTheAddressTypedOnAPhoneBecomesTheBoardsOwnPage(t *testing.T) {
	for typed, want := range map[string]string{
		"board.tail1234.ts.net":         "https://board.tail1234.ts.net/m",
		"  board.tail1234.ts.net  ":     "https://board.tail1234.ts.net/m",
		"board.tail1234.ts.net/":        "https://board.tail1234.ts.net/m",
		"https://board.tail1234.ts.net": "https://board.tail1234.ts.net/m",

		// http is what a person remembers, not what they are choosing: the
		// tailnet door serves TLS, and a webview refuses plain HTTP anyway.
		"http://board.tail1234.ts.net": "https://board.tail1234.ts.net/m",

		// A port is part of the address when the front door is published on one.
		"board.tail1234.ts.net:8443": "https://board.tail1234.ts.net:8443/m",
	} {
		got, err := boardURL(typed)
		if err != nil {
			t.Errorf("%q: %v", typed, err)
			continue
		}
		if got != want {
			t.Errorf("%q became %q, want %q", typed, got, want)
		}
	}
}

// An address that cannot be loaded is worth saying so about while the field is
// still on screen, rather than after the window has gone white.
func TestAnAddressThatIsNotOneIsRefused(t *testing.T) {
	for _, typed := range []string{"", "   ", "board tail1234", "https://", "board/m", "board?x=1"} {
		if got, err := boardURL(typed); err == nil {
			t.Errorf("%q was accepted as %q", typed, got)
		}
	}
}

// The address is remembered so the app opens the board rather than the setup
// page, and a stored one that no longer parses must not strand the app on a
// page it cannot load.
func TestTheAppOpensTheBoardItWasToldAboutAndTheSetupPageOtherwise(t *testing.T) {
	settings := &Settings{store: &fakeStore{}}

	if url := settings.startURL(); url != "" {
		t.Errorf("with nothing saved the app opened %q, want its own setup page", url)
	}

	if _, err := settings.Connect("board.tail1234.ts.net"); err != nil {
		t.Fatalf("connecting: %v", err)
	}
	if url := settings.startURL(); url != "https://board.tail1234.ts.net/m" {
		t.Errorf("after connecting the app opens %q", url)
	}
	if saved := settings.Address(); saved != "board.tail1234.ts.net" {
		t.Errorf("the field would be filled with %q, want what was typed", saved)
	}

	if err := settings.Forget(); err != nil {
		t.Fatalf("forgetting: %v", err)
	}
	if url := settings.startURL(); url != "" {
		t.Errorf("after forgetting the app opened %q, want its own setup page", url)
	}
}

func TestAStoredAddressThatNoLongerParsesFallsBackToTheSetupPage(t *testing.T) {
	settings := &Settings{store: &fakeStore{values: map[string]string{addressKey: "not an address"}}}

	if url := settings.startURL(); url != "" {
		t.Errorf("opened %q, want its own setup page", url)
	}
}

type fakeStore struct{ values map[string]string }

func (f *fakeStore) get(key string) string { return f.values[key] }

func (f *fakeStore) set(key, value string) {
	if f.values == nil {
		f.values = map[string]string{}
	}
	f.values[key] = value
}

func (f *fakeStore) delete(key string) { delete(f.values, key) }
