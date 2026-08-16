//go:build !lifetime

package edition

// Name is what this build is. See edition.go for why it is a build tag.
const Name = "base"

// Title is the edition in words, for a log line and for support: two binaries
// under one app name are otherwise told apart only by what is in them.
const Title = "XCIII"

// ManifestURL is the release feed this build asks, and it is the one address
// it can never change — every copy already installed asks here and nowhere
// else. The base edition keeps the address the app has always had, so an
// install that predates the split goes on updating as it did.
//
// One const per line, no block: the release workflow reads this with sed.
const ManifestURL = "https://updates.deffun.org/stable.json"

// Channel is the `channel` field of that manifest, and the value the release
// workflow signs one with. The endpoint provider filters on it, so a manifest
// signed for the other edition would not be offered even if it were served
// from this address by mistake.
const Channel = "stable"
