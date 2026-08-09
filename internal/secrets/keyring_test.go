package secrets

import (
	"os"
	"testing"
)

// The platform's store is the one this app is supposed to use, so what it has
// to prove is the round trip and the one answer callers branch on: "there is no
// such item" is not the same as "the store is broken". The library underneath
// is somebody else's; that it is wired up right, and that our two error values
// mean what the rest of the app reads them as, is ours.
//
// It writes to the real keychain of whoever runs the tests, under a service
// name of its own, and takes it back out again. Skipped where there is none.
func TestTheKeychainKeepsASecretAndGivesItBack(t *testing.T) {
	if os.Getenv("CI") != "" {
		t.Skip("нет доступа к связке ключей на CI")
	}
	store, ok := OpenKeychain("XCIII-test")
	if !ok {
		t.Skip("на этой машине нет хранилища секретов")
	}
	const key = "source/тест"
	t.Cleanup(func() { _ = store.Delete(key) })

	if _, err := store.Get(key); err != ErrNotFound {
		t.Fatalf("до записи должно быть «не найдено», получено %v", err)
	}
	if err := store.Set(key, "секрет-1"); err != nil {
		t.Fatal(err)
	}
	got, err := store.Get(key)
	if err != nil || got != "секрет-1" {
		t.Fatalf("got %q, err %v", got, err)
	}

	// A token is reissued far more often than it is created, so a second write
	// has to replace rather than refuse.
	if err := store.Set(key, "секрет-2"); err != nil {
		t.Fatal(err)
	}
	if got, _ := store.Get(key); got != "секрет-2" {
		t.Fatalf("после перезаписи: %q", got)
	}

	if err := store.Delete(key); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(key); err != ErrNotFound {
		t.Fatalf("после удаления: %v", err)
	}
}

// A machine with no store at all — a headless Linux, a platform the library
// does not cover — has to say so at the door, so the caller can fall back to
// the file store instead of failing on the first secret it needs.
func TestAMachineWithNoStoreSaysSoAtTheDoor(t *testing.T) {
	if _, ok := OpenKeychain(" "); ok {
		t.Fatal("a store has to be named to be opened")
	}
}
