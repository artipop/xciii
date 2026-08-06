// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"errors"
	"net/url"
	"strings"
)

// The address of the board, as a person types it and as the webview needs it.
//
// What is typed on a phone is a machine name — "board", or
// "board.tail1234.ts.net" — and what the webview must be given is an absolute
// https URL ending at the page written for a phone. Everything between the two
// is here, and it is a pure function so it can be tested without a phone.

// mobileRoute is the page a phone opens: the board's own mobile view. The rest
// of the board is reachable from a phone too, but not as the thing that opens
// when the app starts.
const mobileRoute = "/m"

// boardURL turns what somebody typed into the address to load.
//
// https, not http, and not negotiable: the front door on a tailnet listens with
// a real certificate (tsnetdoor.go), and a webview refuses plain HTTP by
// default on both platforms. An address typed with http:// is a person
// describing what they remember, not choosing a transport.
func boardURL(typed string) (string, error) {
	host := strings.TrimSpace(typed)
	if host == "" {
		return "", errors.New("адрес не указан")
	}
	host = strings.TrimPrefix(strings.TrimPrefix(host, "https://"), "http://")
	host = strings.TrimSuffix(host, "/")
	if host == "" || strings.ContainsAny(host, " \t/?#") {
		return "", errors.New("это не похоже на адрес доски")
	}

	parsed, err := url.Parse("https://" + host + mobileRoute)
	if err != nil || parsed.Hostname() == "" {
		return "", errors.New("это не похоже на адрес доски")
	}
	return parsed.String(), nil
}
