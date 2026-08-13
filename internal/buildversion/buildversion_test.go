package buildversion

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// copyTree copies every site's file into a throwaway root, so a test can write
// versions without editing the repository it is running in.
func copyTree(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for _, site := range Sites {
		data, err := os.ReadFile(filepath.Join("..", "..", site.Path))
		if err != nil {
			t.Fatalf("reading %s: %v", site.Path, err)
		}
		dst := filepath.Join(root, site.Path)
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			t.Fatalf("making %s: %v", filepath.Dir(dst), err)
		}
		if err := os.WriteFile(dst, data, 0o644); err != nil {
			t.Fatalf("writing %s: %v", dst, err)
		}
	}
	return root
}

// One number, every file. The whole reason this package exists is that the
// version is stated in seven places and a release where they disagree offers
// every user an update to the version they are already running.
func TestSettingTheVersionWritesEveryFile(t *testing.T) {
	root := copyTree(t)

	changed, err := Set(root, "2.3.4")
	if err != nil {
		t.Fatalf("Set: %v", err)
	}
	if len(changed) != len(Sites) {
		t.Errorf("changed %d files, expected all %d", len(changed), len(Sites))
	}

	found, err := Read(root)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	for path, versions := range found {
		for _, version := range versions {
			if version != "2.3.4" {
				t.Errorf("%s says %q after the bump", path, version)
			}
		}
	}
}

// The plist carries a hand-written CFBundleURLTypes block registering the
// xciii:// scheme the share extension launches the app through. Regenerating
// the build assets from the wails3 template drops it, which is why the version
// is rewritten in place instead — and why this is worth a test rather than a
// comment.
func TestBumpingTheVersionLeavesTheRestOfTheFileAlone(t *testing.T) {
	root := copyTree(t)
	plist := filepath.Join(root, "build/darwin/Info.plist")

	before, err := os.ReadFile(plist)
	if err != nil {
		t.Fatalf("reading: %v", err)
	}
	if !strings.Contains(string(before), "CFBundleURLTypes") {
		t.Fatal("the fixture no longer carries the URL scheme this test is about")
	}

	if _, err := Set(root, "2.3.4"); err != nil {
		t.Fatalf("Set: %v", err)
	}

	after, err := os.ReadFile(plist)
	if err != nil {
		t.Fatalf("reading: %v", err)
	}
	if !strings.Contains(string(after), "CFBundleURLTypes") {
		t.Error("bumping the version dropped the xciii:// URL scheme")
	}
	if strings.Count(string(after), "\n") != strings.Count(string(before), "\n") {
		t.Error("bumping the version rewrote more of the file than the version")
	}
}

// A tag is `v1.2.3` and a version is `1.2.3`; the two are never the same
// string, and pasting the tag here would put a leading v into Info.plist and
// into the manifest the updater compares against.
func TestATagIsNotAVersion(t *testing.T) {
	root := copyTree(t)

	if _, err := Set(root, "v2.3.4"); err == nil {
		t.Error("a leading v should be refused")
	}
	if _, err := Set(root, "2.3"); err == nil {
		t.Error("a two-part version should be refused")
	}

	found, err := Read(root)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	for path, versions := range found {
		for _, version := range versions {
			if strings.HasPrefix(version, "v") {
				t.Errorf("%s was written despite the refusal: %q", path, version)
			}
		}
	}
}
