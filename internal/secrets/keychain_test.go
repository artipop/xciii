package secrets

import (
	"os"
	"testing"
)

// The keychain is the store this app is supposed to use, so what it has to
// prove is the round trip and the one answer callers branch on: "there is no
// such item" is not the same as "the store is broken".
//
// It writes to the real keychain of whoever runs the tests, under a service
// name of its own, and takes it back out again. Skipped where there is none.
func TestTheKeychainKeepsASecretAndGivesItBack(t *testing.T) {
	if os.Getenv("CI") != "" {
		t.Skip("нет доступа к связке ключей на CI")
	}
	store, ok := OpenKeychain("XCIII-test")
	if !ok {
		t.Skip("на этой машине нет связки ключей")
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
