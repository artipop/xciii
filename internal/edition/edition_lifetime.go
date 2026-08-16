//go:build lifetime

package edition

// Name is what this build is. See edition.go for why it is a build tag.
const Name = "lifetime"

// Title is the edition in words, for a log line and for support: two binaries
// under one app name are otherwise told apart only by what is in them.
const Title = "XCIII Lifetime"

// ManifestURL is the release feed this build asks. A second file beside
// stable.json, not a second bucket: the address of a feed is the one thing an
// installed copy cannot be told to change, so both editions are published
// under the same domain and differ by a name.
//
// One const per line, no block: the release workflow reads this with sed.
const ManifestURL = "https://updates.deffun.org/lifetime.json"

// Channel is the `channel` field of that manifest, and the value the release
// workflow signs one with. It is not "stable" on purpose: a base manifest
// served from this address by mistake would then be refused by the provider's
// own filter rather than offered as an update that replaces this build with
// one carrying fewer templates.
const Channel = "lifetime"
