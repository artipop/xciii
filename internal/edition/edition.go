// Package edition is what this build is: which templates it ships and which
// release feed it updates from.
//
// **It is decided at compile time and never at runtime.** A licence file, an
// environment variable or a flag would make the difference a thing this
// process reads, and then every place that reads it is a place that can be
// made to read the other answer — while the whole of what an edition buys is
// files that are simply not in the binary. A build tag leaves the extra
// templates out of the `go:embed`, so a base build has nothing to unlock.
//
// It is also why the feed is here rather than in updates.go: the two editions
// are separate builds and cannot share one manifest, since a manifest names
// one artifact per platform and an installed copy would otherwise be handed
// the other edition's app under its own version number.
//
// The edition-specific values live one `const` per line in edition_base.go and
// edition_lifetime.go rather than in a `const (…)` block, because the release
// workflow reads them out of the source with sed — the same trick it uses for
// the version — and gofmt aligns the `=` inside a block.
//
// Adding a third edition is three things: a file here under its own tag, its
// templates under internal/boardadapter/templates/<edition>/, and a line in
// the release workflow's edition matrix. docs/editions.md is the long form.
package edition

// Base is the edition every build is unless a tag says otherwise: the app as
// it is sold once, with the templates that make it explain itself.
const Base = "base"

// Lifetime is the paid-once edition. Today the whole difference is the extra
// board templates it embeds; docs/editions.md keeps the list of what else may
// join them.
const Lifetime = "lifetime"

// Is reports whether this build is the named edition. It exists so call sites
// read as a question about the build rather than as a string comparison —
// there is no runtime switch here, and the compiler resolves both sides.
func Is(name string) bool { return Name == name }
