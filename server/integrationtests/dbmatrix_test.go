package integrationtests

import (
	"os"
	"testing"

	"github.com/artipop/xciii/internal/dbtest"
)

// The API tests go through the same store, so they run on the same matrix and
// for the same reason. See sqlstore/dbmatrix_test.go.
func TestMain(m *testing.M) {
	os.Exit(dbtest.Main(m))
}
