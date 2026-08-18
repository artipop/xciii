package dbtest

import (
	"context"
	"fmt"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/mysql"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
)

// The images the matrix is run against. Pinned to a major rather than to a
// digest: what this suite is for is "the SQL we generate and write is legal on
// this vendor", which is a property of the dialect and not of a patch release,
// and a digest would need bumping by hand for ever.
//
// MySQL 8.0 rather than 8.4 or 9: it is the oldest version this schema claims
// to support, since the CHECK constraints the generator writes need 8.0.16.
// Testing the oldest is what says the claim is true.
const (
	mysqlImage    = "mysql:8.0"
	postgresImage = "postgres:16-alpine"
)

// start brings up one database and returns the port it is reachable on.
//
// The credentials are not ours to choose: sqlstore.PrepareNewTestDatabase
// hard-codes them, connecting as root to make a database per run and handing
// the tests a DSN for mmuser.
func start(ctx context.Context, kind Kind) (port string, terminate func(), err error) {
	switch kind {
	case MySQL:
		ctr, err := mysql.Run(ctx, mysqlImage,
			// The integration suite stands up a whole server per test, each
			// with a connection pool of its own, and MySQL's default ceiling of
			// 151 is reached partway through: the run then fails with
			// "Error 1040: Too many connections", which surfaces as tests
			// getting 401 from requests whose session lookup could not open a
			// connection. Raised rather than chased, because the pool per test
			// is the fork's harness design and not something this change is
			// about.
			testcontainers.WithCmd("--max-connections=1000"),
			testcontainers.WithEnv(map[string]string{
				// Spelled out rather than left to the module, which copies
				// MYSQL_PASSWORD into MYSQL_ROOT_PASSWORD for us: the fixture
				// connects as root to create the per-run database, so that is a
				// credential this package depends on and should say so.
				"MYSQL_ROOT_PASSWORD": rootPassword,
				"MYSQL_USER":          appUser,
				"MYSQL_PASSWORD":      appPassword,
				// A database for mmuser to land in. The tests never use it —
				// the fixture makes one of its own per run — but the image
				// wants MYSQL_DATABASE when MYSQL_USER is set.
				"MYSQL_DATABASE": "focalboard",
			}),
		)
		return mapped(ctx, ctr, "3306/tcp", err)

	case Postgres:
		ctr, err := postgres.Run(ctx, postgresImage,
			postgres.WithUsername(appUser),
			postgres.WithPassword(appPassword),
			// Named after the user on purpose: the fixture's first connection
			// carries an empty database name, and libpq then falls back to the
			// user's own. Without this that connection has nowhere to land.
			postgres.WithDatabase(appUser),
			postgres.BasicWaitStrategies(),
		)
		return mapped(ctx, ctr, "5432/tcp", err)
	}
	return "", func() {}, fmt.Errorf("no container for %s", kind)
}

// mapped turns a started container into the port the fixture needs, and makes
// sure a container that came up but could not be read is still stopped.
func mapped(ctx context.Context, ctr testcontainers.Container, exposed string, runErr error) (string, func(), error) {
	stop := func() {
		if ctr != nil {
			_ = testcontainers.TerminateContainer(ctr)
		}
	}
	if runErr != nil {
		stop()
		return "", func() {}, runErr
	}
	p, err := ctr.MappedPort(ctx, exposed)
	if err != nil {
		stop()
		return "", func() {}, fmt.Errorf("reading the mapped port: %w", err)
	}
	return p.Port(), stop, nil
}
