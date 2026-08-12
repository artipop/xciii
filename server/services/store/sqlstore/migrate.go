package sqlstore

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"strings"
	"time"

	"text/template"

	sq "github.com/Masterminds/squirrel"

	mysqldriver "github.com/go-sql-driver/mysql"
	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database"
	"github.com/golang-migrate/migrate/v4/database/mysql"
	"github.com/golang-migrate/migrate/v4/database/postgres"

	// The SQLite migration driver runs on the connection it is handed, so which
	// of the two golang-migrate ships is picked decides nothing about the SQL —
	// only which driver the package registers on the side. This one registers
	// the pure-Go modernc build; its sqlite3 sibling registers cgo mattn, and
	// would drag cgo SQLite into every build of this package whether or not the
	// `sqlite3` tag asked for one. Choosing the driver by build tag is what that
	// tag is for, and sqlite.go is where it is done.
	"github.com/golang-migrate/migrate/v4/database/sqlite"

	"github.com/artipop/xciii/server/mlog"

	_ "github.com/lib/pq" // postgres driver

	"github.com/artipop/xciii/server/model"
)

//go:embed migrations/*.sql
var Assets embed.FS

const (
	uniqueIDsMigrationRequiredVersion        = 14
	teamLessBoardsMigrationRequiredVersion   = 18
	categoriesUUIDIDMigrationRequiredVersion = 20
	deDuplicateCategoryBoards                = 35
)

// getMigrationConnection opens the connection the migrations run on. MySQL
// needs one of its own: several statements arrive in one round trip, which its
// driver refuses unless the DSN says so, and a long migration must not be cut
// short by the read timeout the app runs with.
func (s *SQLStore) getMigrationConnection() (*sql.DB, error) {
	connectionString := s.connectionString
	if s.dbType == model.MysqlDBType {
		cfg, err := mysqldriver.ParseDSN(connectionString)
		if err != nil {
			return nil, fmt.Errorf("cannot read the database connection string: %w", err)
		}
		cfg.MultiStatements = true
		cfg.ReadTimeout = 0
		connectionString = cfg.FormatDSN()
	}

	db, err := sql.Open(s.dbType, connectionString)
	if err != nil {
		return nil, err
	}

	// The app has just opened this database on its own connection, so a ping
	// that fails is a transient thing rather than a wrong address; it is still
	// retried, because the store is given a number of attempts to use.
	attempts := s.dbPingAttempts
	if attempts < 1 {
		attempts = 1
	}
	for i := 0; ; i++ {
		if err = db.Ping(); err == nil {
			break
		}
		if i >= attempts-1 {
			db.Close()
			return nil, fmt.Errorf("cannot reach the database for migrations: %w", err)
		}
		s.logger.Warn("Migration connection ping failed, retrying", mlog.Err(err))
		time.Sleep(time.Second)
	}

	return db, nil
}

func (s *SQLStore) Migrate() error {
	// A database that still records its migrations the way the previous engine
	// did is converted before anything reads it. The old table is kept under
	// another name until the migrations have finished, so a failure halfway
	// through leaves the record recoverable.
	legacyVersion, hadLegacyTable, err := s.EnsureSchemaMigrationFormat()
	if err != nil {
		return err
	}
	defer func() {
		if dErr := s.deleteOldSchemaMigrationTable(); dErr != nil {
			s.logger.Error("cannot delete the old schema migration table", mlog.Err(dErr))
		}
	}()

	// Migrations on MySQL need the multiStatements flag, which the store's own
	// connection does not carry, so they get a connection of their own. SQLite
	// has no such flag and migrates on the store's connection — and must, since
	// a second connection to the same file is a second writer.
	db := s.db
	if s.dbType != model.SqliteDBType {
		s.logger.Debug("Getting migrations connection")
		db, err = s.getMigrationConnection()
		if err != nil {
			return err
		}
		defer func() {
			s.logger.Debug("Closing migrations connection")
			db.Close()
		}()
	}

	driver, err := s.migrationDriver(db)
	if err != nil {
		return err
	}

	// The version the previous engine had reached, carried over now that the
	// table it is recorded in belongs to this one.
	if hadLegacyTable {
		s.logger.Info("Carrying the schema version over to the new migration table",
			mlog.Uint("version", legacyVersion))
		if err := driver.SetVersion(int(legacyVersion), false); err != nil {
			return err
		}
	}

	src, err := s.NewMigrationSource()
	if err != nil {
		return err
	}

	s.logger.Debug("Creating migration engine")
	engine, err := migrate.NewWithInstance("xciii", src, s.dbType, driver)
	if err != nil {
		return err
	}
	engine.Log = &migrationLogger{logger: s.logger}
	// Deliberately not engine.Close(): it closes the database driver, and this
	// driver's Close closes the whole *sql.DB — which on SQLite is the store's
	// own connection, the one the app is about to serve every board from. What
	// this function opened, it closes above.

	if err := s.recoverInterruptedMigration(engine); err != nil {
		return err
	}

	return s.runMigrationSequence(engine)
}

// migrationDriver is the database half of the engine: the same driver the rest
// of the app talks through, told which table the schema version lives in. The
// name is the one the board has always used, so an existing install keeps its
// history rather than starting over.
func (s *SQLStore) migrationDriver(db *sql.DB) (database.Driver, error) {
	table := s.tablePrefix + "schema_migrations"

	switch s.dbType {
	case model.SqliteDBType:
		return sqlite.WithInstance(db, &sqlite.Config{MigrationsTable: table})
	case model.PostgresDBType:
		return postgres.WithInstance(db, &postgres.Config{
			MigrationsTable: table,
			SchemaName:      s.schemaName,
		})
	case model.MysqlDBType:
		return mysql.WithInstance(db, &mysql.Config{MigrationsTable: table})
	default:
		return nil, ErrUnsupportedDatabaseType
	}
}

// recoverInterruptedMigration clears the "dirty" mark a killed migration leaves
// behind.
//
// This engine writes the version it is about to reach *before* running the
// migration and clears the mark afterwards, so a crash in between leaves a
// version nobody can migrate past without being asked. The previous engine
// recorded a migration only once it had succeeded, so a failed one was simply
// retried on the next start — and this app has no operator to ask: it is a board
// on somebody's desk, and the answer to "the database is marked dirty" cannot be
// a window that says so.
//
// Retrying is safe because the migration did not apply. Every dialect here runs
// one migration as one transaction — SQLite and Postgres wrap it, MySQL is the
// exception and cannot, since its DDL commits as it goes — so on MySQL the mark
// is left standing and reported, because there the schema really may be half
// migrated.
func (s *SQLStore) recoverInterruptedMigration(engine *migrate.Migrate) error {
	version, dirty, err := engine.Version()
	if errors.Is(err, migrate.ErrNilVersion) {
		return nil
	}
	if err != nil {
		return err
	}
	if !dirty {
		return nil
	}

	if s.dbType == model.MysqlDBType {
		return fmt.Errorf("migration %d was interrupted and MySQL cannot roll one back; "+
			"the schema has to be repaired by hand before the board can start", version)
	}

	s.logger.Warn("A previous migration was interrupted; it rolled back and will be run again",
		mlog.Uint("version", version))

	// Force takes a version and marks it clean. The interrupted migration is
	// the one to redo, so the version to stand on is the one before it.
	if err := engine.Force(int(version) - 1); err != nil {
		return fmt.Errorf("cannot clear the interrupted migration %d: %w", version, err)
	}

	return nil
}

// runMigrationSequence executes all the migrations in order, both
// plain SQL and data migrations.
func (s *SQLStore) runMigrationSequence(engine *migrate.Migrate) error {
	if mErr := s.ensureMigrationsAppliedUpToVersion(engine, uniqueIDsMigrationRequiredVersion); mErr != nil {
		return mErr
	}

	if mErr := s.RunUniqueIDsMigration(); mErr != nil {
		return fmt.Errorf("error running unique IDs migration: %w", mErr)
	}

	if mErr := s.ensureMigrationsAppliedUpToVersion(engine, teamLessBoardsMigrationRequiredVersion); mErr != nil {
		return mErr
	}

	if mErr := s.ensureMigrationsAppliedUpToVersion(engine, categoriesUUIDIDMigrationRequiredVersion); mErr != nil {
		return mErr
	}

	if mErr := s.RunCategoryUUIDIDMigration(); mErr != nil {
		return fmt.Errorf("error running categoryID migration: %w", mErr)
	}

	// Read before the migration below, not after: what the de-duplication is
	// told is the version the database stood on when it started.
	currentMigrationVersion, err := s.currentMigrationVersion(engine)
	if err != nil {
		return err
	}

	if mErr := s.ensureMigrationsAppliedUpToVersion(engine, deDuplicateCategoryBoards); mErr != nil {
		return mErr
	}

	if mErr := s.RunDeDuplicateCategoryBoardsMigration(currentMigrationVersion); mErr != nil {
		return mErr
	}

	s.logger.Debug("== Applying all remaining migrations ====================",
		mlog.Int("current_version", currentMigrationVersion),
	)

	if err := engine.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return err
	}

	// always run the collations & charset fix-ups
	if mErr := s.RunFixCollationsAndCharsetsMigration(); mErr != nil {
		return fmt.Errorf("error running fix collations and charsets migration: %w", mErr)
	}
	return nil
}

// currentMigrationVersion is the schema version the database stands on, with a
// database that has never been migrated reported as 0.
func (s *SQLStore) currentMigrationVersion(engine *migrate.Migrate) (int, error) {
	version, _, err := engine.Version()
	if errors.Is(err, migrate.ErrNilVersion) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return int(version), nil
}

func (s *SQLStore) ensureMigrationsAppliedUpToVersion(engine *migrate.Migrate, version int) error {
	currentVersion, err := s.currentMigrationVersion(engine)
	if err != nil {
		return err
	}

	s.logger.Debug("== Ensuring migrations applied up to version ====================",
		mlog.Int("version", version),
		mlog.Int("current_version", currentVersion))

	// if the target version is below or equal to the current one, do
	// not migrate either because is not needed (both are equal) or
	// because it would downgrade the database (is below)
	if version <= currentVersion {
		s.logger.Debug("-- There is no need of applying any migration --------------------")
		return nil
	}

	if err := engine.Migrate(uint(version)); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return err
	}

	return nil
}

// migrationLogger puts the engine's own account of what it applied where every
// other line from the server goes.
type migrationLogger struct {
	logger mlog.LoggerIFace
}

// Printf logs at info, because these lines are only written when a migration
// actually runs — once per upgrade — and an upgrade that goes wrong is read
// about afterwards, in a log nobody thought to turn up first.
func (l *migrationLogger) Printf(format string, v ...interface{}) {
	l.logger.Info(strings.TrimRight(fmt.Sprintf(format, v...), "\n"))
}

// Verbose asks the engine to name each migration as it reads and runs it, which
// is the line that matters when a migration is the reason a board will not open.
func (l *migrationLogger) Verbose() bool { return true }

func (s *SQLStore) GetTemplateHelperFuncs() template.FuncMap {
	funcs := template.FuncMap{
		"addColumnIfNeeded":     s.genAddColumnIfNeeded,
		"dropColumnIfNeeded":    s.genDropColumnIfNeeded,
		"createIndexIfNeeded":   s.genCreateIndexIfNeeded,
		"renameTableIfNeeded":   s.genRenameTableIfNeeded,
		"renameColumnIfNeeded":  s.genRenameColumnIfNeeded,
		"doesTableExist":        s.doesTableExist,
		"doesColumnExist":       s.doesColumnExist,
		"addConstraintIfNeeded": s.genAddConstraintIfNeeded,
	}
	return funcs
}

func (s *SQLStore) genAddColumnIfNeeded(tableName, columnName, datatype, constraint string) (string, error) {
	tableName = addPrefixIfNeeded(tableName, s.tablePrefix)
	normTableName := s.normalizeTablename(tableName)

	switch s.dbType {
	case model.SqliteDBType:
		// Sqlite does not support any conditionals that can contain DDL commands. No idempotent migrations for Sqlite :-(
		return fmt.Sprintf("\nALTER TABLE %s ADD COLUMN %s %s %s;\n", normTableName, columnName, datatype, constraint), nil
	case model.MysqlDBType:
		vars := map[string]string{
			"schema":          s.schemaName,
			"table_name":      tableName,
			"norm_table_name": normTableName,
			"column_name":     columnName,
			"data_type":       datatype,
			"constraint":      constraint,
		}
		return replaceVars(`
			SET @stmt = (SELECT IF(
				(
				  SELECT COUNT(column_name) FROM INFORMATION_SCHEMA.COLUMNS
				  WHERE table_name = '[[table_name]]'
				  AND table_schema = '[[schema]]'
				  AND column_name = '[[column_name]]'
				) > 0,
				'SELECT 1;',
				'ALTER TABLE [[norm_table_name]] ADD COLUMN [[column_name]] [[data_type]] [[constraint]];'
			));
			PREPARE addColumnIfNeeded FROM @stmt;
			EXECUTE addColumnIfNeeded;
			DEALLOCATE PREPARE addColumnIfNeeded;
		`, vars), nil
	case model.PostgresDBType:
		return fmt.Sprintf("\nALTER TABLE %s ADD COLUMN IF NOT EXISTS %s %s %s;\n", normTableName, columnName, datatype, constraint), nil
	default:
		return "", ErrUnsupportedDatabaseType
	}
}

func (s *SQLStore) genDropColumnIfNeeded(tableName, columnName string) (string, error) {
	tableName = addPrefixIfNeeded(tableName, s.tablePrefix)
	normTableName := s.normalizeTablename(tableName)

	switch s.dbType {
	case model.SqliteDBType:
		return fmt.Sprintf("\n-- Sqlite3 cannot drop columns for versions less than 3.35.0; drop column '%s' in table '%s' skipped\n", columnName, tableName), nil
	case model.MysqlDBType:
		vars := map[string]string{
			"schema":          s.schemaName,
			"table_name":      tableName,
			"norm_table_name": normTableName,
			"column_name":     columnName,
		}
		return replaceVars(`
			SET @stmt = (SELECT IF(
				(
				  SELECT COUNT(column_name) FROM INFORMATION_SCHEMA.COLUMNS
				  WHERE table_name = '[[table_name]]'
				  AND table_schema = '[[schema]]'
				  AND column_name = '[[column_name]]'
				) > 0,
				'ALTER TABLE [[norm_table_name]] DROP COLUMN [[column_name]];',
				'SELECT 1;'
			));
			PREPARE dropColumnIfNeeded FROM @stmt;
			EXECUTE dropColumnIfNeeded;
			DEALLOCATE PREPARE dropColumnIfNeeded;
		`, vars), nil
	case model.PostgresDBType:
		return fmt.Sprintf("\nALTER TABLE %s DROP COLUMN IF EXISTS %s;\n", normTableName, columnName), nil
	default:
		return "", ErrUnsupportedDatabaseType
	}
}

func (s *SQLStore) genCreateIndexIfNeeded(tableName, columns string) (string, error) {
	indexName := getIndexName(tableName, columns)
	tableName = addPrefixIfNeeded(tableName, s.tablePrefix)
	normTableName := s.normalizeTablename(tableName)

	switch s.dbType {
	case model.SqliteDBType:
		// No support for idempotent index creation in Sqlite.
		return fmt.Sprintf("\nCREATE INDEX %s ON %s (%s);\n", indexName, normTableName, columns), nil
	case model.MysqlDBType:
		vars := map[string]string{
			"schema":          s.schemaName,
			"table_name":      tableName,
			"norm_table_name": normTableName,
			"index_name":      indexName,
			"columns":         columns,
		}
		return replaceVars(`
			SET @stmt = (SELECT IF(
				(
				  SELECT COUNT(index_name) FROM INFORMATION_SCHEMA.STATISTICS
				  WHERE table_name = '[[table_name]]'
				  AND table_schema = '[[schema]]'
				  AND index_name = '[[index_name]]'
				) > 0,
				'SELECT 1;',
				'CREATE INDEX [[index_name]] ON [[norm_table_name]] ([[columns]]);'
			));
			PREPARE createIndexIfNeeded FROM @stmt;
			EXECUTE createIndexIfNeeded;
			DEALLOCATE PREPARE createIndexIfNeeded;
		`, vars), nil
	case model.PostgresDBType:
		return fmt.Sprintf("\nCREATE INDEX IF NOT EXISTS %s ON %s (%s);\n", indexName, normTableName, columns), nil
	default:
		return "", ErrUnsupportedDatabaseType
	}
}

func (s *SQLStore) genRenameTableIfNeeded(oldTableName, newTableName string) (string, error) {
	oldTableName = addPrefixIfNeeded(oldTableName, s.tablePrefix)
	newTableName = addPrefixIfNeeded(newTableName, s.tablePrefix)

	normOldTableName := s.normalizeTablename(oldTableName)

	vars := map[string]string{
		"schema":              s.schemaName,
		"table_name":          newTableName,
		"norm_old_table_name": normOldTableName,
		"new_table_name":      newTableName,
	}

	switch s.dbType {
	case model.SqliteDBType:
		// No support for idempotent table renaming in Sqlite.
		return fmt.Sprintf("\nALTER TABLE %s RENAME TO %s;\n", normOldTableName, newTableName), nil
	case model.MysqlDBType:
		return replaceVars(`
			SET @stmt = (SELECT IF(
				(
				SELECT COUNT(table_name) FROM INFORMATION_SCHEMA.TABLES
				WHERE table_name = '[[table_name]]'
				AND table_schema = '[[schema]]'
				) > 0,
				'SELECT 1;',
				'RENAME TABLE [[norm_old_table_name]] TO [[new_table_name]];'
			));
			PREPARE renameTableIfNeeded FROM @stmt;
			EXECUTE renameTableIfNeeded;
			DEALLOCATE PREPARE renameTableIfNeeded;
		`, vars), nil
	case model.PostgresDBType:
		return replaceVars(`
			do $$
			begin
				if (SELECT COUNT(table_name) FROM INFORMATION_SCHEMA.TABLES
							WHERE table_name = '[[new_table_name]]'
							AND table_schema = '[[schema]]'
				) = 0 then
					ALTER TABLE [[norm_old_table_name]] RENAME TO [[new_table_name]];
				end if;
			end$$;
		`, vars), nil
	default:
		return "", ErrUnsupportedDatabaseType
	}
}

func (s *SQLStore) genRenameColumnIfNeeded(tableName, oldColumnName, newColumnName, dataType string) (string, error) {
	tableName = addPrefixIfNeeded(tableName, s.tablePrefix)
	normTableName := s.normalizeTablename(tableName)

	vars := map[string]string{
		"schema":          s.schemaName,
		"table_name":      tableName,
		"norm_table_name": normTableName,
		"old_column_name": oldColumnName,
		"new_column_name": newColumnName,
		"data_type":       dataType,
	}

	switch s.dbType {
	case model.SqliteDBType:
		// No support for idempotent column renaming in Sqlite.
		return fmt.Sprintf("\nALTER TABLE %s RENAME COLUMN %s TO %s;\n", normTableName, oldColumnName, newColumnName), nil
	case model.MysqlDBType:
		return replaceVars(`
			SET @stmt = (SELECT IF(
				(
				SELECT COUNT(column_name) FROM INFORMATION_SCHEMA.COLUMNS
				WHERE table_name = '[[table_name]]'
				AND table_schema = '[[schema]]'
				AND column_name = '[[new_column_name]]'
				) > 0,
				'SELECT 1;',
				'ALTER TABLE [[norm_table_name]] CHANGE [[old_column_name]] [[new_column_name]] [[data_type]];'
			));
			PREPARE renameColumnIfNeeded FROM @stmt;
			EXECUTE renameColumnIfNeeded;
			DEALLOCATE PREPARE renameColumnIfNeeded;
		`, vars), nil
	case model.PostgresDBType:
		return replaceVars(`
			do $$
			begin
				if (SELECT COUNT(table_name) FROM INFORMATION_SCHEMA.COLUMNS
							WHERE table_name = '[[table_name]]'
							AND table_schema = '[[schema]]'
							AND column_name = '[[new_column_name]]'
				) = 0 then
					ALTER TABLE [[norm_table_name]] RENAME COLUMN [[old_column_name]] TO [[new_column_name]];
				end if;
			end$$;
		`, vars), nil
	default:
		return "", ErrUnsupportedDatabaseType
	}
}

func (s *SQLStore) doesTableExist(tableName string) (bool, error) {
	tableName = addPrefixIfNeeded(tableName, s.tablePrefix)
	var query sq.SelectBuilder

	switch s.dbType {
	case model.MysqlDBType, model.PostgresDBType:
		query = s.getQueryBuilder(s.db).
			Select("table_name").
			From("INFORMATION_SCHEMA.TABLES").
			Where(sq.Eq{
				"table_name":   tableName,
				"table_schema": s.schemaName,
			})
	case model.SqliteDBType:
		query = s.getQueryBuilder(s.db).
			Select("name").
			From("sqlite_master").
			Where(sq.Eq{
				"name": tableName,
				"type": "table",
			})
	default:
		return false, ErrUnsupportedDatabaseType
	}

	rows, err := query.Query()
	if err != nil {
		s.logger.Error(`doesTableExist ERROR`, mlog.Err(err))
		return false, err
	}
	defer s.CloseRows(rows)

	exists := rows.Next()
	sql, _, _ := query.ToSql()

	s.logger.Trace("doesTableExist",
		mlog.String("table", tableName),
		mlog.Bool("exists", exists),
		mlog.String("sql", sql),
	)
	return exists, nil
}

func (s *SQLStore) doesColumnExist(tableName, columnName string) (bool, error) {
	tableName = addPrefixIfNeeded(tableName, s.tablePrefix)
	var query sq.SelectBuilder

	switch s.dbType {
	case model.MysqlDBType, model.PostgresDBType:
		query = s.getQueryBuilder(s.db).
			Select("table_name").
			From("INFORMATION_SCHEMA.COLUMNS").
			Where(sq.Eq{
				"table_name":   tableName,
				"table_schema": s.schemaName,
				"column_name":  columnName,
			})
	case model.SqliteDBType:
		query = s.getQueryBuilder(s.db).
			Select("name").
			From(fmt.Sprintf("pragma_table_info('%s')", tableName)).
			Where(sq.Eq{
				"name": columnName,
			})
	default:
		return false, ErrUnsupportedDatabaseType
	}

	rows, err := query.Query()
	if err != nil {
		s.logger.Error(`doesColumnExist ERROR`, mlog.Err(err))
		return false, err
	}
	defer s.CloseRows(rows)

	exists := rows.Next()
	sql, _, _ := query.ToSql()

	s.logger.Trace("doesColumnExist",
		mlog.String("table", tableName),
		mlog.String("column", columnName),
		mlog.Bool("exists", exists),
		mlog.String("sql", sql),
	)
	return exists, nil
}

func (s *SQLStore) genAddConstraintIfNeeded(tableName, constraintName, constraintType, constraintDefinition string) (string, error) {
	tableName = addPrefixIfNeeded(tableName, s.tablePrefix)
	normTableName := s.normalizeTablename(tableName)

	var query string

	vars := map[string]string{
		"schema":                s.schemaName,
		"constraint_name":       constraintName,
		"constraint_type":       constraintType,
		"table_name":            tableName,
		"constraint_definition": constraintDefinition,
		"norm_table_name":       normTableName,
	}

	switch s.dbType {
	case model.SqliteDBType:
		// SQLite doesn't have a generic way to add constraint. For example, you can only create indexes on existing tables.
		// For other constraints, you need to re-build the table. So skipping here.
		// Include SQLite specific migration in original migration file.
		query = fmt.Sprintf("\n-- Sqlite3 cannot drop constraints; drop constraint '%s' in table '%s' skipped\n", constraintName, tableName)
	case model.MysqlDBType:
		query = replaceVars(`
			SET @stmt = (SELECT IF(
				(
				SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
				WHERE constraint_schema = '[[schema]]'
				AND constraint_name = '[[constraint_name]]'
				AND constraint_type = '[[constraint_type]]'
				AND table_name = '[[table_name]]'
				) > 0,
				'SELECT 1;',
				'ALTER TABLE [[norm_table_name]] ADD CONSTRAINT [[constraint_name]] [[constraint_definition]];'
			));
			PREPARE addConstraintIfNeeded FROM @stmt;
			EXECUTE addConstraintIfNeeded;
			DEALLOCATE PREPARE addConstraintIfNeeded;
		`, vars)
	case model.PostgresDBType:
		query = replaceVars(`
		DO
		$$
		BEGIN
		IF NOT EXISTS (
			SELECT * FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
				WHERE constraint_schema = '[[schema]]'
				AND constraint_name = '[[constraint_name]]'
				AND constraint_type = '[[constraint_type]]'
				AND table_name = '[[table_name]]'
		) THEN
			ALTER TABLE [[norm_table_name]] ADD CONSTRAINT [[constraint_name]] [[constraint_definition]];
		END IF;
		END;
		$$
		LANGUAGE plpgsql;
		`, vars)
	}

	return query, nil
}

func addPrefixIfNeeded(s, prefix string) string {
	if !strings.HasPrefix(s, prefix) {
		return prefix + s
	}
	return s
}

func (s *SQLStore) normalizeTablename(tableName string) string {
	if s.schemaName != "" && !strings.HasPrefix(tableName, s.schemaName+".") {
		schemaName := s.schemaName
		if s.dbType == model.MysqlDBType {
			schemaName = "`" + schemaName + "`"
		}
		tableName = schemaName + "." + tableName
	}
	return tableName
}

func getIndexName(tableName string, columns string) string {
	var sb strings.Builder

	_, _ = sb.WriteString("idx_")
	_, _ = sb.WriteString(tableName)

	// allow developers to separate column names with spaces and/or commas
	columns = strings.ReplaceAll(columns, ",", " ")
	cols := strings.Split(columns, " ")

	for _, s := range cols {
		sub := strings.TrimSpace(s)
		if sub == "" {
			continue
		}

		_, _ = sb.WriteString("_")
		_, _ = sb.WriteString(s)
	}
	return sb.String()
}

// replaceVars replaces instances of variable placeholders with the
// values provided via a map.  Variable placeholders are of the form
// `[[var_name]]`.
func replaceVars(s string, vars map[string]string) string {
	for key, val := range vars {
		placeholder := "[[" + key + "]]"
		val = strings.ReplaceAll(val, "'", "\\'")
		s = strings.ReplaceAll(s, placeholder, val)
	}
	return s
}
