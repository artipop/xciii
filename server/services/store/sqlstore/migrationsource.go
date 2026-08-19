package sqlstore

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"text/template"

	"github.com/golang-migrate/migrate/v4/source"

	"github.com/artipop/xciii/server/mlog"

	"github.com/artipop/xciii/server/model"
)

// migrationSource is where the migrations come from, and they do not come off
// the embedded filesystem as they are: every one is a text/template over the
// dialect, so what runs is the rendering
// and never the file. golang-migrate reads its migrations through this
// interface, so rendering is what sits behind it.
//
// Everything is rendered up front, before the first migration runs. That is not
// an optimisation, it is the behaviour the migrations were written against: the
// previous engine read its whole asset list when it was constructed, so a
// template asking the live schema a question — doesColumnExist, doesTableExist —
// has always been answered for the schema as it stands at startup rather than as
// the migration in front of it leaves things. Rendering lazily would change what
// three of these migrations do.
type migrationSource struct {
	migrations *source.Migrations
	// Rendered SQL by file name, which is what source.Migration.Raw holds.
	bodies map[string][]byte
}

func (s *SQLStore) NewMigrationSource() (source.Driver, error) {
	entries, err := Assets.ReadDir("migrations")
	if err != nil {
		return nil, err
	}

	params := map[string]interface{}{
		"postgres":   s.dbType == model.PostgresDBType,
		"sqlite":     s.dbType == model.SqliteDBType,
		"mysql":      s.dbType == model.MysqlDBType,
		"singleUser": s.isSingleUser,
	}

	src := &migrationSource{
		migrations: source.NewMigrations(),
		bodies:     map[string][]byte{},
	}
	for _, entry := range entries {
		migration, pErr := source.DefaultParse(entry.Name())
		if pErr != nil {
			// The migrations directory carries a README beside the SQL.
			continue
		}

		body, rErr := s.renderMigration(entry.Name(), params)
		if rErr != nil {
			return nil, rErr
		}

		if !src.migrations.Append(migration) {
			return nil, fmt.Errorf("duplicate migration %s", entry.Name())
		}
		src.bodies[migration.Raw] = body
	}

	return src, nil
}

// renderMigration executes one migration's template. The helper functions can
// query the database, which is why the result is logged at trace: the file is
// not what ran.
func (s *SQLStore) renderMigration(name string, params map[string]interface{}) ([]byte, error) {
	asset, err := Assets.ReadFile("migrations/" + name)
	if err != nil {
		return nil, err
	}

	tmpl, err := template.New("sql").Parse(string(asset))
	if err != nil {
		return nil, err
	}

	buffer := &bytes.Buffer{}
	if err := tmpl.Execute(buffer, params); err != nil {
		return nil, err
	}

	s.logger.Trace("migration template",
		mlog.String("name", name),
		mlog.String("sql", buffer.String()),
	)

	return buffer.Bytes(), nil
}

// Open is part of source.Driver. This source is built with the store's own
// database and template helpers, so there is nothing a URL could name.
func (m *migrationSource) Open(string) (source.Driver, error) {
	return nil, fmt.Errorf("the board's migration source cannot be opened by URL")
}

// Close is part of source.Driver. The migrations are already in memory.
func (m *migrationSource) Close() error { return nil }

func (m *migrationSource) First() (uint, error) {
	version, ok := m.migrations.First()
	if !ok {
		return 0, os.ErrNotExist
	}
	return version, nil
}

func (m *migrationSource) Prev(version uint) (uint, error) {
	prev, ok := m.migrations.Prev(version)
	if !ok {
		return 0, os.ErrNotExist
	}
	return prev, nil
}

func (m *migrationSource) Next(version uint) (uint, error) {
	next, ok := m.migrations.Next(version)
	if !ok {
		return 0, os.ErrNotExist
	}
	return next, nil
}

func (m *migrationSource) ReadUp(version uint) (io.ReadCloser, string, error) {
	migration, ok := m.migrations.Up(version)
	if !ok {
		return nil, "", os.ErrNotExist
	}
	return m.read(migration)
}

func (m *migrationSource) ReadDown(version uint) (io.ReadCloser, string, error) {
	migration, ok := m.migrations.Down(version)
	if !ok {
		return nil, "", os.ErrNotExist
	}
	return m.read(migration)
}

func (m *migrationSource) read(migration *source.Migration) (io.ReadCloser, string, error) {
	body, ok := m.bodies[migration.Raw]
	if !ok {
		return nil, "", os.ErrNotExist
	}
	return io.NopCloser(bytes.NewReader(body)), migration.Identifier, nil
}
