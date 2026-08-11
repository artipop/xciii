package sqlstore

import (
	"database/sql"
	"fmt"
	"os"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/focalboard/server/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
)

const migrationTestPrefix = "test_"

// openMigratedStore opens a store on a database of its own and runs the
// migrations, then hands back the connection and a way to open the same
// database again — which is what an upgrade is.
func openMigratedStore(t *testing.T) (*sql.DB, func(t *testing.T) *SQLStore, func()) {
	t.Helper()

	dbType, connectionString, err := PrepareNewTestDatabase()
	require.NoError(t, err)

	logger, _ := mlog.NewLogger()

	open := func(t *testing.T) *SQLStore {
		t.Helper()
		db, err := sql.Open(dbType, connectionString)
		require.NoError(t, err)
		require.NoError(t, db.Ping())

		store, err := New(Params{
			DBType:           dbType,
			ConnectionString: connectionString,
			DBPingAttempts:   5,
			TablePrefix:      migrationTestPrefix,
			Logger:           logger,
			DB:               db,
		})
		require.NoError(t, err)
		return store
	}

	store := open(t)
	db := store.db

	cleanup := func() {
		_ = store.Shutdown()
		_ = logger.Shutdown()
		if dbType == model.SqliteDBType {
			_ = os.Remove(connectionString)
		}
	}

	return db, open, cleanup
}

func schemaVersion(t *testing.T, db *sql.DB) (version int, dirty bool) {
	t.Helper()
	row := db.QueryRow(fmt.Sprintf("SELECT version, dirty FROM %sschema_migrations", migrationTestPrefix))
	require.NoError(t, row.Scan(&version, &dirty))
	return version, dirty
}

// The migration engine changed, and with it the table it keeps its progress in.
// A board that has been on somebody's desk for years is the case that matters:
// its schema is already up to date, and what must not happen is the new engine
// deciding it has never migrated anything and starting at the first migration.
//
// Both names the previous engine could have used are covered, because which one
// an install has depends on its dialect: it was configured to keep the record in
// <prefix>schema_migrations, and got its own default, db_migrations, wherever
// SQLite made it drop that configuration — which is every install of this app.
func TestAnInstallThatRecordedItsMigrationsTheOldWayKeepsItsPlace(t *testing.T) {
	for _, legacyTable := range []string{"db_migrations", migrationTestPrefix + "schema_migrations"} {
		t.Run("recorded in "+legacyTable, func(t *testing.T) {
			db, open, cleanup := openMigratedStore(t)
			defer cleanup()

			version, _ := schemaVersion(t, db)
			require.NotZero(t, version, "the store should have migrated on the first open")

			// Put the database back the way the previous engine kept it: a row
			// per applied migration, carrying the migration's name, and no
			// dirty flag.
			_, err := db.Exec(fmt.Sprintf("DROP TABLE %sschema_migrations", migrationTestPrefix))
			require.NoError(t, err)
			_, err = db.Exec(fmt.Sprintf(
				"CREATE TABLE %s (version bigint NOT NULL, name varchar(64) NOT NULL, PRIMARY KEY (version))",
				legacyTable))
			require.NoError(t, err)
			for v := 1; v <= version; v++ {
				_, err = db.Exec(fmt.Sprintf("INSERT INTO %s (version, name) VALUES (%d, 'migration')",
					legacyTable, v))
				require.NoError(t, err)
			}

			store := open(t)
			defer func() { _ = store.Shutdown() }()

			newVersion, dirty := schemaVersion(t, db)
			require.Equal(t, version, newVersion, "the version the old table recorded was not carried over")
			require.False(t, dirty)

			// The old table is not left lying beside the new one — under its own
			// name, where it differs, nor under the one it is retired to.
			var scanned int
			if legacyTable != migrationTestPrefix+"schema_migrations" {
				err = db.QueryRow(fmt.Sprintf("SELECT version FROM %s", legacyTable)).Scan(&scanned)
				require.Error(t, err, "the previous engine's table should be gone")
			}
			err = db.QueryRow(fmt.Sprintf("SELECT version FROM %sschema_migrations_old_temp",
				migrationTestPrefix)).Scan(&scanned)
			require.Error(t, err, "the retired schema table should have been dropped")
		})
	}
}

// Opening a board twice must not migrate it twice — the plainest thing the
// version table is for, and the thing a format change is most likely to break.
func TestOpeningAnAlreadyMigratedDatabaseChangesNothing(t *testing.T) {
	db, open, cleanup := openMigratedStore(t)
	defer cleanup()

	version, dirty := schemaVersion(t, db)
	require.False(t, dirty)

	store := open(t)
	defer func() { _ = store.Shutdown() }()

	againVersion, againDirty := schemaVersion(t, db)
	require.Equal(t, version, againVersion)
	require.False(t, againDirty)
}

// A migration killed halfway leaves the version marked dirty, and the engine
// refuses to touch a database in that state. Nobody is standing beside this one
// to unpick it: it is a board on a desk, so the mark is cleared and the
// migration run again — which is safe because the migration was rolled back with
// the transaction it ran in.
func TestAnInterruptedMigrationIsRunAgainRatherThanRefused(t *testing.T) {
	db, open, cleanup := openMigratedStore(t)
	defer cleanup()

	version, _ := schemaVersion(t, db)

	if isMySQL := os.Getenv("FOCALBOARD_STORE_TEST_DB_TYPE") == model.MysqlDBType; isMySQL {
		t.Skip("MySQL cannot roll a migration back, so an interrupted one is reported rather than retried")
	}

	_, err := db.Exec(fmt.Sprintf("UPDATE %sschema_migrations SET dirty = true", migrationTestPrefix))
	require.NoError(t, err)

	store := open(t)
	defer func() { _ = store.Shutdown() }()

	recoveredVersion, dirty := schemaVersion(t, db)
	require.False(t, dirty, "the interrupted migration should have been cleared")
	require.Equal(t, version, recoveredVersion, "the board should be back at the version it had reached")
}
