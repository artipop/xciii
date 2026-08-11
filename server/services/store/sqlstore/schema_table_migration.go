package sqlstore

import (
	"fmt"
	"strings"

	sq "github.com/Masterminds/squirrel"
	"github.com/artipop/xciii/server/model"

	"github.com/mattermost/mattermost/server/public/shared/mlog"
)

// retiredSchemaTable is where the previous engine's record is kept while the
// migrations run, so an install that fails halfway through this can still be
// looked at. deleteOldSchemaMigrationTable drops it once they have finished.
const retiredSchemaTableSuffix = "schema_migrations_old_temp"

// legacyMigrationTables are the names the previous engine could have left its
// record of applied migrations under, most likely first.
//
// There are two because that engine was configured for one and given the other.
// It was told to keep its record in <prefix>schema_migrations — but the SQLite
// path threw every engine option away to be rid of the locking it did not
// support, and the table name went with them, so a board on somebody's desk
// records its migrations in that engine's own default, `db_migrations`,
// unprefixed. Both are looked for whatever the dialect, since the cost is one
// query against a table that is not there.
func (s *SQLStore) legacyMigrationTables() []string {
	return []string{"db_migrations", s.tablePrefix + "schema_migrations"}
}

// EnsureSchemaMigrationFormat converts the record of applied migrations from the
// shape the previous engine kept it in, and reports the version an existing
// install had reached so the caller can hand it to the new one.
//
// The two shapes differ in what they record. The previous engine wrote a row per
// applied migration — a version and the migration's name — while this one keeps
// a single row: the version reached, and whether the migration that reached it
// finished. Only the highest version carries over, and nothing is lost by that:
// the migrations are numbered without gaps, so "reached 27" and "applied 1
// through 27" are the same statement.
//
// A database with no such table has never been migrated by that engine — a fresh
// install, or one already converted — and is left alone.
func (s *SQLStore) EnsureSchemaMigrationFormat() (version uint32, converted bool, err error) {
	table, err := s.legacyMigrationTable()
	if err != nil {
		return 0, false, err
	}

	if table == "" {
		s.logger.Info("Schema migration table is correct format")
		return 0, false, nil
	}

	version, err = s.getLegacySchemaVersion(table)
	if err != nil {
		return 0, false, err
	}

	s.logger.Info("Retiring the previous engine's migration table",
		mlog.String("table", table), mlog.Uint("version", version))

	if err := s.retireLegacySchemaTable(table); err != nil {
		return 0, false, err
	}

	return version, true, nil
}

// legacyMigrationTable returns the table still holding the previous engine's
// record, or the empty string if there is none. A `name` column is what tells
// the two shapes apart: the engine now in use records a version and a dirty
// flag, and never a name.
func (s *SQLStore) legacyMigrationTable() (string, error) {
	for _, table := range s.legacyMigrationTables() {
		columns, err := s.tableColumns(table)
		if err != nil {
			return "", err
		}

		for _, column := range columns {
			if strings.ToLower(column) == "name" {
				return table, nil
			}
		}
	}

	return "", nil
}

// tableColumns names the columns of a table, and returns nothing at all for a
// table that does not exist.
func (s *SQLStore) tableColumns(tableName string) ([]string, error) {
	// SQLite needs a bit of a special handling
	if s.dbType == model.SqliteDBType {
		return s.tableColumnsSQLite(tableName)
	}

	query := s.getQueryBuilder(s.db).
		Select("COLUMN_NAME").
		From("information_schema.COLUMNS").
		Where(sq.Eq{
			"TABLE_NAME": tableName,
		})

	switch s.dbType {
	case model.MysqlDBType:
		query = query.Where(sq.Eq{"TABLE_SCHEMA": s.schemaName})
	case model.PostgresDBType:
		query = query.Where("table_schema = current_schema()")
	}

	rows, err := query.Query()
	if err != nil {
		s.logger.Error("failed to fetch columns in migration table", mlog.String("table", tableName), mlog.Err(err))
		return nil, err
	}

	defer s.CloseRows(rows)

	columns := []string{}
	for rows.Next() {
		var columnName string

		if err := rows.Scan(&columnName); err != nil {
			s.logger.Error("error scanning rows from migration table definition", mlog.Err(err))
			return nil, err
		}

		columns = append(columns, columnName)
	}

	return columns, nil
}

func (s *SQLStore) tableColumnsSQLite(tableName string) ([]string, error) {
	// the way to check presence of a column is different
	// for SQLite. Hence, the separate function
	query := fmt.Sprintf("PRAGMA table_info(\"%s\");", tableName)
	rows, err := s.db.Query(query)
	if err != nil {
		s.logger.Error("SQLite - failed to check for columns in migration table",
			mlog.String("table", tableName), mlog.Err(err))
		return nil, err
	}

	defer s.CloseRows(rows)

	const (
		idxCid = iota
		idxName
		idxType
		idxNotnull
		idxDfltValue
		idxPk
	)

	columns := []string{}
	for rows.Next() {
		// PRAGMA returns 6 columns
		row := make([]*string, 6)

		err := rows.Scan(
			&row[idxCid],
			&row[idxName],
			&row[idxType],
			&row[idxNotnull],
			&row[idxDfltValue],
			&row[idxPk],
		)
		if err != nil {
			s.logger.Error("error scanning rows from SQLite migration table definition", mlog.Err(err))
			return nil, err
		}

		if row[idxName] != nil {
			columns = append(columns, *row[idxName])
		}
	}

	return columns, nil
}

// getLegacySchemaVersion is the highest version the old table records. It kept a
// row per applied migration, so the version reached is the largest of them.
func (s *SQLStore) getLegacySchemaVersion(tableName string) (uint32, error) {
	query := s.getQueryBuilder(s.db).
		Select("MAX(version)").
		From(tableName)

	row := query.QueryRow()

	// An empty table means no migration was ever recorded, which is a database
	// standing on version zero.
	var version *uint32
	if err := row.Scan(&version); err != nil {
		s.logger.Error("error fetching legacy schema version", mlog.Err(err))
		return 0, err
	}
	if version == nil {
		return 0, nil
	}

	return *version, nil
}

// retireLegacySchemaTable takes the name out of the old table's hands so the
// migration engine can create its own, and keeps the contents under another name
// until the migrations have finished.
func (s *SQLStore) retireLegacySchemaTable(tableName string) error {
	retired := s.tablePrefix + retiredSchemaTableSuffix

	var query string
	if s.dbType == model.MysqlDBType {
		query = fmt.Sprintf("RENAME TABLE `%s` TO `%s`", tableName, retired)
	} else {
		query = fmt.Sprintf("ALTER TABLE %s RENAME TO %s", tableName, retired)
	}

	if _, err := s.db.Exec(query); err != nil {
		s.logger.Error("failed to rename the previous engine's migration table", mlog.Err(err))
		return err
	}

	return nil
}

func (s *SQLStore) deleteOldSchemaMigrationTable() error {
	query := "DROP TABLE IF EXISTS " + s.tablePrefix + retiredSchemaTableSuffix
	if _, err := s.db.Exec(query); err != nil {
		s.logger.Error("failed to delete old temp schema migrations table", mlog.Err(err))
		return err
	}

	return nil
}
