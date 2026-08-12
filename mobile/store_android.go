//go:build android

package main

import (
	"encoding/json"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// EncryptedSharedPreferences, reached through the same bridge as everything
// else. A write takes {"key","value"} rather than two arguments, which is the
// one difference from iOS and the reason these two files are not one.
type platformStore struct{}

func (platformStore) get(key string) string { return application.Mobile.SecureGet(key) }

func (platformStore) set(key, value string) {
	payload, err := json.Marshal(map[string]string{"key": key, "value": value})
	if err != nil {
		return
	}
	application.Android.SecureSet(string(payload))
}

func (platformStore) delete(key string) { application.Mobile.SecureDelete(key) }
