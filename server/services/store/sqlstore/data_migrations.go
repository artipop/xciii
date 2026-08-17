package sqlstore

import (
	"fmt"
	"os"

	sq "github.com/Masterminds/squirrel"
	"github.com/wiggin77/merror"

	"github.com/artipop/xciii/server/model"

	"github.com/artipop/xciii/server/mlog"
)

const (
	// we group the inserts on batches of 1000 because PostgreSQL
	// supports a limit of around 64K values (not rows) on an insert
	// query, so we want to stay safely below.
	CategoryInsertBatch = 1000

	TemplatesToTeamsMigrationKey              = "TemplatesToTeamsMigrationComplete"
	UniqueIDsMigrationKey                     = "UniqueIDsMigrationComplete"
	CategoryUUIDIDMigrationKey                = "CategoryUuidIdMigrationComplete"
	TeamLessBoardsMigrationKey                = "TeamLessBoardsMigrationComplete"
	DeletedMembershipBoardsMigrationKey       = "DeletedMembershipBoardsMigrationComplete"
	DeDuplicateCategoryBoardTableMigrationKey = "DeDuplicateCategoryBoardTableComplete"
)

// What used to live here: three data migrations, run between particular rungs of
// the eighty-one-step ladder because each fixed up rows the next step's
// constraints would have refused — RunUniqueIDsMigration at 14,
// RunCategoryUUIDIDMigration at 20, RunDeDuplicateCategoryBoardsMigration at 35.
// The ladder is one step now (docs/store-plan.md, step 0): a database made today
// has none of the rows they repaired, and one that already ran them is already
// repaired. So they are gone, and their tests with them.
//
// The one below stays, because it is not about a rung. It is about an install
// whose tables predate the charset being spelled out in the CREATE, and it does
// something only on MySQL.

func (s *SQLStore) RunFixCollationsAndCharsetsMigration() error {
	// This is for MySQL only
	if s.dbType != model.MysqlDBType {
		return nil
	}

	// get collation and charSet setting that Channels is using.
	// when personal server or unit testing, no channels tables exist so just set to a default.
	var collation string
	var charSet string
	var err error
	if os.Getenv("FOCALBOARD_UNIT_TESTING") == "1" {
		collation = "utf8mb4_general_ci"
		charSet = "utf8mb4"
	} else {
		collation, charSet, err = s.getCollationAndCharset("Channels")
		if err != nil {
			return err
		}
	}

	// get all FocalBoard tables
	tableNames, err := s.getFocalBoardTableNames()
	if err != nil {
		return err
	}

	merr := merror.New()

	// alter each table if there is a collation or charset mismatch
	for _, name := range tableNames {
		tableCollation, tableCharSet, err := s.getCollationAndCharset(name)
		if err != nil {
			return err
		}

		if collation == tableCollation && charSet == tableCharSet {
			// nothing to do
			continue
		}

		s.logger.Warn(
			"found collation/charset mismatch, fixing table",
			mlog.String("tableName", name),
			mlog.String("tableCollation", tableCollation),
			mlog.String("tableCharSet", tableCharSet),
			mlog.String("collation", collation),
			mlog.String("charSet", charSet),
		)

		sql := fmt.Sprintf("ALTER TABLE %s CONVERT TO CHARACTER SET '%s' COLLATE '%s'", name, charSet, collation)
		result, err := s.db.Exec(sql)
		if err != nil {
			merr.Append(err)
			continue
		}
		num, err := result.RowsAffected()
		if err != nil {
			merr.Append(err)
		}
		if num > 0 {
			s.logger.Debug("table collation and/or charSet fixed",
				mlog.String("table_name", name),
			)
		}
	}
	return merr.ErrorOrNil()
}

func (s *SQLStore) getFocalBoardTableNames() ([]string, error) {
	if s.dbType != model.MysqlDBType {
		return nil, newErrInvalidDBType("getFocalBoardTableNames requires MySQL")
	}

	query := s.getQueryBuilder(s.db).
		Select("table_name").
		From("information_schema.tables").
		Where(sq.Like{"table_name": s.tablePrefix + "%"}).
		Where("table_schema=(SELECT DATABASE())")

	rows, err := query.Query()
	if err != nil {
		return nil, fmt.Errorf("error fetching FocalBoard table names: %w", err)
	}
	defer rows.Close()

	names := make([]string, 0)

	for rows.Next() {
		var tableName string

		err := rows.Scan(&tableName)
		if err != nil {
			return nil, fmt.Errorf("cannot scan result while fetching table names: %w", err)
		}

		names = append(names, tableName)
	}

	return names, nil
}

func (s *SQLStore) getCollationAndCharset(tableName string) (string, string, error) {
	if s.dbType != model.MysqlDBType {
		return "", "", newErrInvalidDBType("getCollationAndCharset requires MySQL")
	}

	query := s.getQueryBuilder(s.db).
		Select("table_collation").
		From("information_schema.tables").
		Where(sq.Eq{"table_name": tableName}).
		Where("table_schema=(SELECT DATABASE())")

	row := query.QueryRow()

	var collation string
	err := row.Scan(&collation)
	if err != nil {
		return "", "", fmt.Errorf("error fetching collation for table %s: %w", tableName, err)
	}

	// obtains the charset from the first column that has it set
	query = s.getQueryBuilder(s.db).
		Select("CHARACTER_SET_NAME").
		From("information_schema.columns").
		Where(sq.Eq{
			"table_name": tableName,
		}).
		Where("table_schema=(SELECT DATABASE())").
		Where(sq.NotEq{"CHARACTER_SET_NAME": "NULL"}).
		Limit(1)

	row = query.QueryRow()

	var charSet string
	err = row.Scan(&charSet)
	if err != nil {
		return "", "", fmt.Errorf("error fetching charSet: %w", err)
	}

	return collation, charSet, nil
}
