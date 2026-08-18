package sqlstore

import (
	"database/sql"
	"fmt"

	"github.com/artipop/xciii/server/mlog"
)

type Params struct {
	DBType           string
	ConnectionString string
	DBPingAttempts   int
	Logger           mlog.LoggerIFace
	DB               *sql.DB
	IsSingleUser     bool
	SkipMigrations   bool
}

type ErrStoreParam struct {
	name  string
	issue string
}

func (e ErrStoreParam) Error() string {
	return fmt.Sprintf("invalid store params: %s %s", e.name, e.issue)
}
