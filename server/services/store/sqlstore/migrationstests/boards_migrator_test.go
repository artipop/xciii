package migrationstests

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	migratedb "github.com/golang-migrate/migrate/v4/database"
	migratemysql "github.com/golang-migrate/migrate/v4/database/mysql"
	migratepostgres "github.com/golang-migrate/migrate/v4/database/postgres"
	migratesqlite "github.com/golang-migrate/migrate/v4/database/sqlite"

	"github.com/artipop/xciii/server/mlog"
	mysqldriver "github.com/go-sql-driver/mysql"

	"github.com/artipop/xciii/server/model"
	"github.com/artipop/xciii/server/services/store/sqlstore"
)

var tablePrefix = "focalboard_"

// BoardsMigrator stands the board's schema up one migration at a time, so a test
// can look at the database between two of them. It builds its own engine rather
// than calling Migrate, because Migrate runs the whole sequence and what these
// tests are about is the state in the middle of it — but the migrations it runs
// are the app's own, rendered by the store that will read them.
type BoardsMigrator struct {
	connString string
	driverName string
	db         *sql.DB
	store      *sqlstore.SQLStore
	engine     *migrate.Migrate
}

func NewBoardsMigrator() *BoardsMigrator {
	return &BoardsMigrator{}
}

func (bm *BoardsMigrator) getDriver() (migratedb.Driver, error) {
	table := tablePrefix + "schema_migrations"

	switch bm.driverName {
	case model.PostgresDBType:
		return migratepostgres.WithInstance(bm.db, &migratepostgres.Config{MigrationsTable: table})
	case model.MysqlDBType:
		return migratemysql.WithInstance(bm.db, &migratemysql.Config{MigrationsTable: table})
	case model.SqliteDBType:
		return migratesqlite.WithInstance(bm.db, &migratesqlite.Config{MigrationsTable: table})
	default:
		return nil, fmt.Errorf("unsupported database type %s", bm.driverName)
	}
}

func (bm *BoardsMigrator) getMigrationEngine() (*migrate.Migrate, error) {
	driver, err := bm.getDriver()
	if err != nil {
		return nil, err
	}

	src, err := bm.store.NewMigrationSource()
	if err != nil {
		return nil, err
	}

	return migrate.NewWithInstance("xciii", src, bm.driverName, driver)
}

func (bm *BoardsMigrator) Setup() error {
	var err error
	bm.driverName, bm.connString, err = sqlstore.PrepareNewTestDatabase()
	if err != nil {
		return err
	}

	if bm.driverName == model.MysqlDBType {
		cfg, pErr := mysqldriver.ParseDSN(bm.connString)
		if pErr != nil {
			return pErr
		}
		cfg.MultiStatements = true
		cfg.ReadTimeout = 0
		bm.connString = cfg.FormatDSN()
	}

	var dbErr error
	bm.db, dbErr = sql.Open(bm.driverName, bm.connString)
	if dbErr != nil {
		return dbErr
	}

	if err := bm.db.Ping(); err != nil {
		return err
	}

	logger, _ := mlog.NewLogger()

	storeParams := sqlstore.Params{
		DBType:           bm.driverName,
		DBPingAttempts:   5,
		ConnectionString: bm.connString,
		TablePrefix:      tablePrefix,
		Logger:           logger,
		DB:               bm.db,
		SkipMigrations:   true,
	}
	bm.store, err = sqlstore.New(storeParams)
	if err != nil {
		return err
	}

	engine, err := bm.getMigrationEngine()
	if err != nil {
		return err
	}
	bm.engine = engine

	return nil
}

func (bm *BoardsMigrator) MigrateToStep(step int) error {
	if err := bm.engine.Migrate(uint(step)); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return err
	}

	return nil
}

func (bm *BoardsMigrator) Interceptors() map[int]func() error {
	return map[int]func() error{
		35: func() error {
			return bm.store.RunDeDuplicateCategoryBoardsMigration(35)
		},
	}
}

func (bm *BoardsMigrator) TearDown() error {
	// Closing the engine would close the database driver, and that driver holds
	// the connection below — which the test still owns.
	return bm.db.Close()
}

func (bm *BoardsMigrator) DriverName() string {
	return bm.driverName
}

func (bm *BoardsMigrator) DB() *sql.DB {
	return bm.db
}
