package edition

import (
	"net/url"
	"os"
	"regexp"
	"testing"
)

// Only one of the two files below is compiled into any given test binary, so
// nothing about the other can be asserted by reading a constant. They are read
// as source instead — the same way internal/buildversion checks the version is
// stated the same everywhere, and for the same reason: the thing that goes
// wrong here is two files that were meant to differ and do not.

// sedPattern is the shape the release workflow reads these files with. If a
// declaration stops matching it, CI publishes the base edition's manifest name
// for both — which is one edition overwriting the other's feed.
func sedPattern(name string) *regexp.Regexp {
	return regexp.MustCompile(`(?m)^const ` + name + ` = "(.*)"$`)
}

func read(t *testing.T, path, name string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading %s: %v", path, err)
	}
	m := sedPattern(name).FindSubmatch(data)
	if m == nil {
		t.Fatalf("%s does not declare %s on one line as `const %s = \"…\"`, which is how the release workflow reads it", path, name, name)
	}
	return string(m[1])
}

// Two editions are two builds, and a build that asked the other one's feed
// would offer its users an app with different files in it under this version
// number.
func TestEachEditionHasItsOwnFeed(t *testing.T) {
	base := read(t, "edition_base.go", "ManifestURL")
	lifetime := read(t, "edition_lifetime.go", "ManifestURL")
	if base == lifetime {
		t.Fatalf("both editions ask %s", base)
	}

	// The address is the one thing an installed copy cannot be told to change,
	// so both live under the domain the app has always asked: where the files
	// are kept can be revisited every release, this cannot.
	baseURL, err := url.Parse(base)
	if err != nil {
		t.Fatalf("base feed %q: %v", base, err)
	}
	lifetimeURL, err := url.Parse(lifetime)
	if err != nil {
		t.Fatalf("lifetime feed %q: %v", lifetime, err)
	}
	if baseURL.Host != lifetimeURL.Host {
		t.Errorf("the editions are published under different hosts: %s and %s", baseURL.Host, lifetimeURL.Host)
	}
	if baseURL.Scheme != "https" || lifetimeURL.Scheme != "https" {
		t.Errorf("a release feed is fetched over https or the signature is the only thing standing: %s, %s", base, lifetime)
	}
}

// The provider filters on the channel, so a manifest that ended up at the
// wrong address is refused rather than installed. Two editions sharing a
// channel name would turn that backstop off.
func TestEachEditionHasItsOwnChannel(t *testing.T) {
	base := read(t, "edition_base.go", "Channel")
	lifetime := read(t, "edition_lifetime.go", "Channel")
	if base == lifetime {
		t.Fatalf("both editions sign their manifest as %q", base)
	}
}

// The name is what the templates and the docs call the edition, and what the
// release workflow passes as a build tag. A file whose Name disagrees with the
// constant it is meant to be builds fine and ships the wrong word everywhere.
func TestEachEditionIsNamedAfterItself(t *testing.T) {
	if got := read(t, "edition_base.go", "Name"); got != Base {
		t.Errorf("edition_base.go is called %q, not %q", got, Base)
	}
	if got := read(t, "edition_lifetime.go", "Name"); got != Lifetime {
		t.Errorf("edition_lifetime.go is called %q, not %q", got, Lifetime)
	}
}

// Whichever edition this test binary was built as, it is one of the two.
func TestThisBuildIsAnEdition(t *testing.T) {
	if !Is(Base) && !Is(Lifetime) {
		t.Fatalf("built as %q, which is neither %q nor %q", Name, Base, Lifetime)
	}
}
