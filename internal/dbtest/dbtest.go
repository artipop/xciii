// Package dbtest starts the database a test suite asked for.
//
// It exists because "this code works on SQLite, MySQL and Postgres" was an
// assertion rather than a fact: the fork's own fixture
// (sqlstore.PrepareNewTestDatabase) has always been able to use a MySQL or a
// Postgres given to it on a port, but nothing ever gave it one — no compose
// file, no CI job — so every run went down the SQLite branch and passed. A
// green run that proved nothing is the worst kind, and it is what hid a MySQL
// upsert that updates a different set of columns from the other two
// (category_boards, docs/sql-plan.md).
//
// The contract is unchanged, only who satisfies it: the fixture still reads
// FOCALBOARD_STORE_TEST_DB_TYPE and FOCALBOARD_STORE_TEST_DOCKER_PORT. This
// package fills in the second when the first asks for a vendor and nobody has
// brought a database of their own.
package dbtest

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

// Environment variables the fork's fixture reads. Named here rather than
// spelled at each use, because the whole point of this package is to satisfy
// exactly these two.
const (
	EnvDBType = "FOCALBOARD_STORE_TEST_DB_TYPE"
	EnvPort   = "FOCALBOARD_STORE_TEST_DOCKER_PORT"
)

// The credentials the fork's fixture hard-codes (PrepareNewTestDatabase). A
// container has to be started with exactly these or the fixture cannot connect:
// on MySQL it opens as root to create a database per run and to grant on it,
// then hands the tests a DSN for mmuser; on Postgres mmuser does both, being the
// superuser there.
const (
	rootPassword = "mostest"
	appUser      = "mmuser"
	appPassword  = "mostest"
)

// startTimeout bounds the wait for a database to come up, and it has to cover
// pulling the image as well as starting it: the first run on a machine — and
// every run in CI without a warm layer cache — downloads a few hundred
// megabytes before the container exists at all. Measured: three minutes was not
// enough for a cold `postgres:16-alpine`, and the failure reads as
// "context deadline exceeded" with nothing about a download in it.
//
// Long, therefore, on purpose. What it still catches is a database that came up
// and never became ready, which is the hang worth having a bound for.
const startTimeout = 10 * time.Minute

// Kind is the vendor a suite asked for.
type Kind string

const (
	SQLite   Kind = "sqlite3"
	MySQL    Kind = "mysql"
	Postgres Kind = "postgres"
)

// Requested is the vendor named in the environment, defaulting to SQLite —
// which is what the desktop application runs on, and therefore what the fast
// inner loop should keep testing.
func Requested() Kind {
	switch strings.TrimSpace(os.Getenv(EnvDBType)) {
	case "mysql", "mariadb":
		return MySQL
	case "postgres":
		return Postgres
	default:
		return SQLite
	}
}

// Main is what a package's TestMain calls. It starts a database if the suite
// asked for one, runs the tests, stops the container and returns the exit code
// — as a value rather than by calling os.Exit, so the caller's own deferred
// cleanup still runs.
//
// Nothing happens for SQLite, which is a file the fixture makes itself, and
// nothing happens when FOCALBOARD_STORE_TEST_DOCKER_PORT is already set, which
// is somebody running against a database of their own.
func Main(m *testing.M) int {
	stop, err := Start(context.Background())
	if err != nil {
		fmt.Fprintf(os.Stderr, "dbtest: cannot start %s: %v\n", Requested(), err)
		return 1
	}
	defer stop()
	return m.Run()
}

// Start brings up the requested database and points the fixture at it. The
// returned function stops the container and is safe to call when none was
// started.
func Start(ctx context.Context) (stop func(), err error) {
	noop := func() {}
	kind := Requested()
	if kind == SQLite {
		return noop, nil
	}
	if strings.TrimSpace(os.Getenv(EnvPort)) != "" {
		// Somebody brought their own database. This is the path that existed
		// before this package and it stays: a developer with a MySQL already
		// running should not have one started for them.
		return noop, nil
	}

	ctx, cancel := context.WithTimeout(ctx, startTimeout)
	defer cancel()

	port, terminate, err := start(ctx, kind)
	if err != nil {
		return noop, err
	}
	if err := os.Setenv(EnvPort, port); err != nil {
		terminate()
		return noop, err
	}
	return func() {
		os.Unsetenv(EnvPort)
		terminate()
	}, nil
}
