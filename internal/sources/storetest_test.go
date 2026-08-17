package sources

import (
	"testing"

	"github.com/artipop/xciii/internal/appschema"
)

// newTestStore gives a test a store on a scratch database of its own, closed
// when the test ends. See the same helper in internal/acp for why the schema
// comes from the application's own migration rather than from a copy.
func newTestStore(t testing.TB, path string) (*Store, error) {
	t.Helper()
	db, err := appschema.Open(path)
	if err != nil {
		return nil, err
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewStore(db, ""), nil
}
