package sqlstore

import (
	"os"
	"testing"

	"github.com/artipop/xciii/internal/dbtest"
)

// The store's tests run against whichever database FOCALBOARD_STORE_TEST_DB_TYPE
// names, and this is what makes that mean something: with no variable set it is
// SQLite and nothing starts, which keeps the inner loop at a few seconds; with
// `mysql` or `postgres` a container comes up for the package and the fixture is
// pointed at it.
//
// Before this the variable was read and never set — no compose file, no CI job
// — so every run took the SQLite branch and passed, and the eighteen
// dialect-specific branches in this package were never executed on two of the
// three vendors they exist for.
func TestMain(m *testing.M) {
	os.Exit(dbtest.Main(m))
}
