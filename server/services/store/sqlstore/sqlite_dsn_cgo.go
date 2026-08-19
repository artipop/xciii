//go:build sqlite3

package sqlstore

import "strings"

// SQLiteDSN adds the connection settings SQLite takes in its DSN rather than in
// SQL, spelled the way the cgo driver (mattn/go-sqlite3) spells them.
//
// They are per *connection*, which is why they are here and not in a migration:
// `PRAGMA foreign_keys` executed once would hold for one connection and be
// silently off on the next. The pool is capped at one connection on SQLite
// (server.NewStore), so a pragma would in fact stick — but relying on that
// would make a pool setting load-bearing for referential integrity, which is a
// trap for whoever raises the cap.
//
// Which driver is compiled in is a build tag, and the two spell these
// differently — modernc takes `_pragma=foreign_keys(1)` where this one takes
// `_foreign_keys=on`. That is the whole reason this is a build-tagged function
// beside the import that chooses the driver.
//
// A setting the caller already asked for is left alone, and a DSN that already
// has a query is appended to rather than given a second `?`. Both were found by
// a test whose DSN already carried a busy timeout.
func SQLiteDSN(dsn string) string {
	return addParams(dsn, [][2]string{
		{"_foreign_keys", "on"},
		{"_busy_timeout", "5000"},
	})
}

// addParams appends the settings the DSN has not already got.
func addParams(dsn string, params [][2]string) string {
	sep := "?"
	if strings.Contains(dsn, "?") {
		sep = "&"
	}
	var b strings.Builder
	b.WriteString(dsn)
	for _, p := range params {
		if strings.Contains(dsn, p[0]) {
			continue
		}
		b.WriteString(sep)
		b.WriteString(p[0])
		b.WriteString("=")
		b.WriteString(p[1])
		sep = "&"
	}
	return b.String()
}
