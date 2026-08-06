package secrets

import (
	"os"
	"path/filepath"
	"testing"
)

func TestASecretSurvivesTheProcessThatWroteIt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.json")

	if err := NewFileStore(path).Set("почта", "t0k"); err != nil {
		t.Fatal(err)
	}
	// A second store over the same file: what the app does on the next launch.
	got, err := NewFileStore(path).Get("почта")
	if err != nil || got != "t0k" {
		t.Fatalf("got %q, %v", got, err)
	}
}

// The file holds credentials in plain text, so the mode is not decoration.
func TestTheFileIsNotReadableByAnybodyElse(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.json")
	if err := NewFileStore(path).Set("почта", "t0k"); err != nil {
		t.Fatal(err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Fatalf("права %o", mode)
	}
}

// "No credential yet" and "the store is broken" ask for different things — one
// asks a person to connect the source, the other is a bug — so they cannot be
// the same error.
func TestNothingStoredIsItsOwnAnswer(t *testing.T) {
	store := NewFileStore(filepath.Join(t.TempDir(), "secrets.json"))
	if _, err := store.Get("почта"); err != ErrNotFound {
		t.Fatalf("err = %v", err)
	}
	// Deleting what is not there is not a failure: it is the state asked for.
	if err := store.Delete("почта"); err != nil {
		t.Fatal(err)
	}
}

func TestASecretCanBeTakenBack(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.json")
	store := NewFileStore(path)
	if err := store.Set("почта", "t0k"); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete("почта"); err != nil {
		t.Fatal(err)
	}
	if _, err := NewFileStore(path).Get("почта"); err != ErrNotFound {
		t.Fatalf("secret survived deletion: %v", err)
	}
}

// A file that cannot be read is reported rather than replaced: overwriting it
// would destroy every other credential in it.
func TestAnUnreadableFileIsNotOverwritten(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.json")
	if err := os.WriteFile(path, []byte("{не json"), 0o600); err != nil {
		t.Fatal(err)
	}

	store := NewFileStore(path)
	if _, err := store.Get("почта"); err == nil || err == ErrNotFound {
		t.Fatalf("err = %v", err)
	}
	if err := store.Set("почта", "t0k"); err == nil {
		t.Fatal("a broken store accepted a write")
	}
	if b, _ := os.ReadFile(path); string(b) != "{не json" {
		t.Fatalf("the file was rewritten: %q", b)
	}
}

func TestACredentialFromTheEnvironmentIsFound(t *testing.T) {
	t.Setenv("XCIII_SOURCE_MAIL_TOKEN", "из окружения")
	store := Env{Prefix: "XCIII_SOURCE_"}

	got, err := store.Get("mail-token")
	if err != nil || got != "из окружения" {
		t.Fatalf("got %q, %v", got, err)
	}
	if _, err := store.Get("нет такого"); err != ErrNotFound {
		t.Fatalf("err = %v", err)
	}
	// Writing to the environment of a running process would lose the value at
	// exit, which is worse than refusing.
	if err := store.Set("mail-token", "x"); err == nil {
		t.Fatal("the environment accepted a write")
	}
}

// What somebody put in the environment wins: it is the more deliberate of the
// two, and it is how a credential is kept out of the app's files entirely.
func TestTheEnvironmentWinsOverWhatWasStored(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.json")
	file := NewFileStore(path)
	if err := file.Set("mail-token", "из файла"); err != nil {
		t.Fatal(err)
	}
	chain := Chain{Env{Prefix: "XCIII_SOURCE_"}, file}

	if got, _ := chain.Get("mail-token"); got != "из файла" {
		t.Fatalf("without the variable the stored one answers: %q", got)
	}
	t.Setenv("XCIII_SOURCE_MAIL_TOKEN", "из окружения")
	if got, _ := chain.Get("mail-token"); got != "из окружения" {
		t.Fatalf("got %q", got)
	}
}

// A write goes to the first store that will take it, which is never the
// environment.
func TestAChainWritesWhereItCan(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.json")
	chain := Chain{Env{Prefix: "XCIII_SOURCE_"}, NewFileStore(path)}

	if err := chain.Set("почта", "t0k"); err != nil {
		t.Fatal(err)
	}
	if got, err := NewFileStore(path).Get("почта"); err != nil || got != "t0k" {
		t.Fatalf("got %q, %v", got, err)
	}
}
