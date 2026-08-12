package main

import (
	"strings"
	"testing"
)

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

// A tab is one word, because every machine on a tailnet shares everything
// after the first label.
func TestAMachineIsCalledByTheFirstPartOfItsName(t *testing.T) {
	for typed, want := range map[string]string{
		"board.tail1234.ts.net":          "board",
		"https://laptop.tail1234.ts.net": "laptop",
		"board.tail1234.ts.net:8443":     "board",
		"board":                          "board",
	} {
		if got := machineLabel(typed); got != want {
			t.Errorf("%q is called %q, want %q", typed, got, want)
		}
	}
}

// A person has more than one desktop, and each publishes its own board. The app
// keeps them as a list, in the order they were added, and each one carries the
// address to load and the word on its tab.
func TestTheAppRemembersEveryMachineItWasGiven(t *testing.T) {
	settings := &Settings{store: &fakeStore{}}

	if got := settings.Machines(); got != "[]" {
		t.Errorf("with nothing saved the app knows %s, want no machines", got)
	}

	if _, err := settings.Add("board.tail1234.ts.net"); err != nil {
		t.Fatalf("adding: %v", err)
	}
	if _, err := settings.Add("laptop.tail1234.ts.net"); err != nil {
		t.Fatalf("adding: %v", err)
	}

	want := `[{"address":"board.tail1234.ts.net","url":"https://board.tail1234.ts.net/m","label":"board"},` +
		`{"address":"laptop.tail1234.ts.net","url":"https://laptop.tail1234.ts.net/m","label":"laptop"}]`
	if got := settings.Machines(); got != want {
		t.Errorf("the app shows %s, want %s", got, want)
	}

	if _, err := settings.Remove("board.tail1234.ts.net"); err != nil {
		t.Fatalf("removing: %v", err)
	}
	if got := settings.Machines(); !strings.Contains(got, "laptop") || strings.Contains(got, "board") {
		t.Errorf("after forgetting one machine the app shows %s", got)
	}
}

// Adding the same machine again is somebody who does not remember whether they
// had, not an error — and typing it differently is the same machine.
func TestAMachineIsAddedOnce(t *testing.T) {
	settings := &Settings{store: &fakeStore{}}

	for _, typed := range []string{"board.tail1234.ts.net", "https://board.tail1234.ts.net", "  board.tail1234.ts.net/  "} {
		if _, err := settings.Add(typed); err != nil {
			t.Fatalf("adding %q: %v", typed, err)
		}
	}

	if got := settings.Machines(); strings.Count(got, "board.tail1234.ts.net") != 2 {
		t.Errorf("the app shows %s, want the machine once (its address and its url)", got)
	}
}

// An address that cannot be loaded is refused while the field is still on
// screen, rather than becoming a tab that opens a white page.
func TestAMachineThatIsNotOneIsNotAdded(t *testing.T) {
	settings := &Settings{store: &fakeStore{}}

	if _, err := settings.Add("board tail1234"); err == nil {
		t.Error("an address that is not one was added")
	}
	if got := settings.Machines(); got != "[]" {
		t.Errorf("the app shows %s, want no machines", got)
	}
}

// The one address earlier versions kept is somebody's only machine, and an
// update must not lose it.
func TestTheOneAddressAnOlderVersionSavedBecomesTheFirstMachine(t *testing.T) {
	store := &fakeStore{values: map[string]string{addressKey: "board.tail1234.ts.net"}}
	settings := &Settings{store: store}

	if got := settings.Machines(); !strings.Contains(got, "https://board.tail1234.ts.net/m") {
		t.Fatalf("the app shows %s, want the machine it used to open", got)
	}

	if _, err := settings.Add("laptop.tail1234.ts.net"); err != nil {
		t.Fatalf("adding: %v", err)
	}
	if got := settings.Machines(); !strings.Contains(got, "board") || !strings.Contains(got, "laptop") {
		t.Errorf("the app shows %s, want both machines", got)
	}
	if store.values[addressKey] != "" {
		t.Error("the old address survived the first write, and will migrate again")
	}
}

// A stored address that no longer parses must not take the rest of the machines
// down with it.
func TestAStoredAddressThatNoLongerParsesIsLeftOut(t *testing.T) {
	store := &fakeStore{values: map[string]string{machinesKey: `["not an address","board.tail1234.ts.net"]`}}
	settings := &Settings{store: store}

	got := settings.Machines()
	if strings.Contains(got, "not an address") || !strings.Contains(got, "board") {
		t.Errorf("the app shows %s, want the machine that still parses", got)
	}

	if _, err := settings.Remove("not an address"); err != nil {
		t.Fatalf("removing: %v", err)
	}
	if store.values[machinesKey] != `["board.tail1234.ts.net"]` {
		t.Errorf("after forgetting the broken one the store holds %s", store.values[machinesKey])
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
