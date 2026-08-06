// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

//go:build !ios && !android

package main

// A desktop has no Keychain of this kind, and this app has no business running
// there — but it has to compile there, because that is where it is written,
// vetted and tested. Remembering nothing is the honest stub: the setup page
// asks for the address, and the next launch asks again.
type platformStore struct{}

func (platformStore) get(string) string { return "" }

func (platformStore) set(string, string) {}

func (platformStore) delete(string) {}
