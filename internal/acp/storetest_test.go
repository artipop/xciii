package acp

import (
	"testing"

	"github.com/artipop/xciii/internal/appschema"
)

// newTestStore gives a test a store on a scratch database of its own, closed
// when the test ends — the handle belongs to the board in the application, and
// here there is no board to close it.
//
// The schema comes from the application's own migration, rendered by
// internal/appschema, rather than from a copy of the DDL kept beside the tests:
// a copy is a schema that drifts, and drift is the class of bug the move into
// one database was for.
func newTestStore(t testing.TB, path string) (*Store, error) {
	t.Helper()
	db, err := appschema.Open(path)
	if err != nil {
		return nil, err
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewStore(db, ""), nil
}
