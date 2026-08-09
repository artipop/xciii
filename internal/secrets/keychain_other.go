//go:build !darwin

package secrets

// OpenKeychain has nothing to open on this platform yet. Windows' Credential
// Manager and the Secret Service on Linux are the same shape of thing and are
// what would go here; until then the caller falls back to the file store,
// which is what those machines would have had anyway.
func OpenKeychain(string) (Store, bool) { return nil, false }
