//go:build darwin

package secrets

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// The macOS Keychain, through the `security` tool rather than through the
// Security framework.
//
// It is the same store the framework would reach, and it costs no cgo: this
// app already pays for cgo twice (SQLite and Wails) and a third reason to need
// a C toolchain for a feature that is three shell calls is a bad trade. The
// price is a process per read, which is nothing next to what a secret is read
// for — starting a plugin, refreshing a token — and never in a loop.
//
// Both the write and the read go through the same binary, so the item's access
// control lists `security` and the read does not raise a dialog. An item a
// person added by hand in Keychain Access will raise one the first time, which
// is the correct behaviour rather than something to work around.

// Keychain stores secrets as generic passwords under one service name.
type Keychain struct {
	// Service is the "where" of the item — the name a person sees in Keychain
	// Access. The key becomes the account, so one app's secrets are one group
	// they can look at, and delete, together.
	Service string
}

var _ Store = Keychain{}

// keychainTimeout bounds one call. The tool answers immediately or is waiting
// for a person to say yes to a dialog, and a source's poll must not hang on
// that.
const keychainTimeout = 15 * time.Second

func (k Keychain) Get(key string) (string, error) {
	out, err := k.run("find-generic-password", "-s", k.Service, "-a", key, "-w")
	if err != nil {
		if isMissing(out, err) {
			return "", ErrNotFound
		}
		return "", err
	}
	// -w prints the password and a newline, and a password may not contain one.
	return decode(strings.TrimRight(out, "\n")), nil
}

func (k Keychain) Set(key, value string) error {
	// -U updates an item that is already there instead of refusing; without it
	// the second write of the same source's token fails.
	_, err := k.run("add-generic-password", "-U", "-s", k.Service, "-a", key,
		"-l", k.Service+": "+key, "-w", encode(value))
	return err
}

// encodedPrefix marks a value this app wrote.
//
// `security -w` prints anything that is not plain ASCII as a hex string, with
// nothing to say that it did — so a token and the hex of a Russian word come
// back looking the same, and guessing which is which is the kind of thing that
// works until somebody's token is thirty-two hex characters. Writing an ASCII
// form of our own removes the question: what we wrote is marked and decoded,
// and anything else is handed back exactly as the keychain gave it.
const encodedPrefix = "b64:"

func encode(value string) string {
	if isASCII(value) {
		// Left readable on purpose: a person looking at their own keychain
		// should see the token, not a wrapper of ours.
		return value
	}
	return encodedPrefix + base64.StdEncoding.EncodeToString([]byte(value))
}

func decode(value string) string {
	if !strings.HasPrefix(value, encodedPrefix) {
		return value
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(value, encodedPrefix))
	if err != nil {
		return value
	}
	return string(raw)
}

func isASCII(value string) bool {
	for i := 0; i < len(value); i++ {
		if value[i] > 127 {
			return false
		}
	}
	return true
}

func (k Keychain) Delete(key string) error {
	out, err := k.run("delete-generic-password", "-s", k.Service, "-a", key)
	if err != nil {
		if isMissing(out, err) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

func (k Keychain) run(args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), keychainTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "security", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		said := strings.TrimSpace(stderr.String())
		if said == "" {
			said = err.Error()
		}
		return said, fmt.Errorf("keychain %s: %s", args[0], said)
	}
	return stdout.String(), nil
}

// isMissing tells "there is no such item" from "the keychain would not answer".
// They are different situations: the first asks a person to connect the source,
// the second is a machine that needs looking at.
func isMissing(out string, err error) bool {
	if err == nil {
		return false
	}
	text := out + " " + err.Error()
	return strings.Contains(text, "could not be found") ||
		strings.Contains(text, "SecKeychainSearchCopyNext") ||
		strings.Contains(text, "-25300")
}

// OpenKeychain returns the platform's own store, or nothing on a machine where
// it cannot be used. The caller falls back to the file store, which is what a
// headless Linux would have had anyway.
func OpenKeychain(service string) (Store, bool) {
	if _, err := exec.LookPath("security"); err != nil {
		return nil, false
	}
	return Keychain{Service: service}, true
}
