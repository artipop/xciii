package sqlstore

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"strings"
	"time"

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

	if err := s.refuseOldLadder(engine); err != nil {
		return err
	}

	return s.runMigrationSequence(engine)
}

// migrationDriver is the database half of the engine: the same driver the rest
// of the app talks through, told which table the schema version lives in. The
// name is the one the board has always used, so an existing install keeps its
// history rather than starting over.
func (s *SQLStore) migrationDriver(db *sql.DB) (database.Driver, error) {
	table := "schema_migrations"

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
	// the one to redo, so the version to stand on is the one before it — and
	// since the ladder was collapsed there usually is no "before": the schema is
	// one step, so the version to stand on is no version at all, which is what
	// Force(-1) means. Asking for version 0 was fine while the first rung was
	// 1 of 81 and is an error now that it is 1 of 1.
	previous := int(version) - 1
	if previous < 1 {
		previous = -1
	}
	if err := engine.Force(previous); err != nil {
		return fmt.Errorf("cannot clear the interrupted migration %d: %w", version, err)
	}

	return nil
}

// refuseOldLadder stops a database built by the migrations this schema replaced.
//
// The engine cannot open one anyway — it looks for the migration matching the
// version recorded and that file is gone — but the error it gives says "no
// migration found for version 41: file does not exist", which tells nobody
// anything. This says what happened and what to do about it.
//
// Adopting such a database instead would work, and was written and thrown away:
// the collapsed migration builds the same schema (tools/schemagen checks it), so
// re-stamping the version would be enough. It was deleted because there is no
// release — the only databases in existence are the ones on the desks of people
// working on this — and a version-mapping constant carried for ever to serve a
// case that never happens is exactly the archaeology this change removed
// eighty-one files of.
func (s *SQLStore) refuseOldLadder(engine *migrate.Migrate) error {
	version, _, err := engine.Version()
	if errors.Is(err, migrate.ErrNilVersion) {
		return nil // no schema yet: the migration below makes it.
	}
	if err != nil {
		return err
	}
	if version <= 1 {
		return nil
	}
	return fmt.Errorf("this database was built by the previous migrations (it records version %d, "+
		"and the schema is now made in one step). There is no upgrade path on purpose, because there "+
		"has been no release: delete the database file and start it again", version)
}

// runMigrationSequence applies the schema.
//
// There used to be a good deal more here: the ladder was eighty-one files, and
// three data migrations had to be interleaved at particular rungs — unique ids
// at 14, category ids at 20, de-duplicated category boards at 35 — because each
// fixed up rows the next step's constraints would refuse. All of it led to one
// schema, which is now made in one step, so none of it means anything to a
// database being created today.
//
// An existing database is left alone by the same mechanism that always left it
// alone: it records a version above this one, the source has nothing after this
// one, and the engine reports no change. That works only because the collapsed
// migration is the same schema the ladder built — which is checked, not assumed
// (tools/schemagen).
func (s *SQLStore) runMigrationSequence(engine *migrate.Migrate) error {
	if err := engine.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return err
	}

	// Still always run, and still only doing anything on MySQL: an install made
	// before the charset was spelled out in the CREATE has tables in the
	// server's default collation, and comparing a Russian title against one of
	// those is a comparison nobody can predict.
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
