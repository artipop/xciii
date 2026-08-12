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

// machineLabel is what a tab is called. Machines on one tailnet differ in their
// first label and agree on everything after it — "board.tail1234.ts.net" beside
// "laptop.tail1234.ts.net" — and a tab on a phone has room for one word, so the
// first label is the name and the rest is noise.
func machineLabel(typed string) string {
	host := strings.TrimSpace(typed)
	host = strings.TrimPrefix(strings.TrimPrefix(host, "https://"), "http://")
	host = strings.TrimSuffix(host, "/")
	if at := strings.IndexByte(host, ':'); at != -1 {
		host = host[:at]
	}
	if at := strings.IndexByte(host, '.'); at != -1 && at > 0 {
		host = host[:at]
	}
	return host
}
