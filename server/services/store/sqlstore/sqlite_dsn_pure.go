//go:build !sqlite3

package sqlstore

import "strings"

// SQLiteDSN for the pure-Go driver (modernc.org/sqlite), which spells the same
// settings differently: pragmas go through a repeated `_pragma=` and the busy
// timeout is one of them rather than a parameter of its own. See the cgo half
// for why this is a DSN and not a migration.
func SQLiteDSN(dsn string) string {
	return addParams(dsn, [][2]string{
		{"_pragma", "foreign_keys(1)"},
		{"_pragma", "busy_timeout(5000)"},
	})
}

// addParams appends the settings the DSN has not already got. Matched on the
// value rather than the key here, because every pragma shares one key.
func addParams(dsn string, params [][2]string) string {
	sep := "?"
	if strings.Contains(dsn, "?") {
		sep = "&"
	}
	var b strings.Builder
	b.WriteString(dsn)
	for _, p := range params {
		name := p[1]
		if i := strings.IndexByte(name, '('); i > 0 {
			name = name[:i]
		}
		if strings.Contains(dsn, name) {
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
