//go:build ios

package main

import "github.com/wailsapp/wails/v3/pkg/application"

// The Keychain. Reads and deletes are the same call on both platforms
// (application.Mobile), but a write is not — iOS takes a key and a value,
// Android takes JSON — which is why this file exists at all.
type platformStore struct{}

func (platformStore) get(key string) string { return application.Mobile.SecureGet(key) }

func (platformStore) set(key, value string) { application.IOS.SecureSet(key, value) }

func (platformStore) delete(key string) { application.Mobile.SecureDelete(key) }
