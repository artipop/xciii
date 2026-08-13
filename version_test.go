package main

import (
	"testing"

	"github.com/artipop/xciii/internal/buildversion"
)

// The version a build calls itself has to be the version its packaging says,
// because the updater compares the first against a release built from the
// second: a binary that reports 1.0.0 while the release is tagged from a
// build/config.yml saying 1.1.0 offers every user an update to the version
// they are already running, for ever.
func TestEveryBuildAssetStatesTheRunningVersion(t *testing.T) {
	found, err := buildversion.Read(".")
	if err != nil {
		t.Fatalf("reading the build assets: %v", err)
	}
	for path, versions := range found {
		for _, version := range versions {
			if version != appVersion {
				t.Errorf("%s says %q, version.go says %q — run `wails3 task version:set VERSION=%s`",
					path, version, appVersion, appVersion)
			}
		}
	}
}
