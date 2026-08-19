package server

import (
	"database/sql"
	"fmt"
	"sync"
	"time"

	"github.com/pkg/errors"

	"github.com/artipop/xciii/server/api"
	"github.com/artipop/xciii/server/app"
	"github.com/artipop/xciii/server/auth"
	appModel "github.com/artipop/xciii/server/model"
	"github.com/artipop/xciii/server/services/config"
	"github.com/artipop/xciii/server/services/notify"
	"github.com/artipop/xciii/server/services/scheduler"
	"github.com/artipop/xciii/server/services/store"
	"github.com/artipop/xciii/server/services/store/sqlstore"
	"github.com/artipop/xciii/server/utils"
	"github.com/artipop/xciii/server/web"
	"github.com/artipop/xciii/server/ws"

	"github.com/artipop/xciii/server/mlog"
	"github.com/artipop/xciii/server/services/filestore"
)

const (
	cleanupSessionTaskFrequency = 10 * time.Minute

	minSessionExpiryTime = int64(60 * 60 * 24 * 31) // 31 days

	MattermostAuthMod = "mattermost"
)

type Server struct {
	config                 *config.Configuration
	wsAdapter              ws.Adapter
	webServer              *web.Server
	store                  store.Store
	filesBackend           filestore.FileBackend
	logger                 mlog.LoggerIFace
	cleanUpSessionsTask    *scheduler.ScheduledTask
	notificationService    *notify.Service
	servicesStartStopMutex sync.Mutex

	api *api.API
	app *app.App
}

func New(params Params) (*Server, error) {
	if err := params.CheckValid(); err != nil {
		return nil, err
	}

	authenticator := auth.New(params.Cfg, params.DBStore, params.PermissionsService)

	// if no ws adapter is provided, we spin up a websocket server
	wsAdapter := params.WSAdapter
	if wsAdapter == nil {
		wsAdapter = ws.NewServer(authenticator, params.SingleUserToken, params.Cfg.AuthMode == MattermostAuthMod, params.Logger, params.DBStore)
	}

	// Attachments go on the disk, under the directory the config names. The S3
	// settings the config still carries are upstream's and no longer reach
	// anything: see services/filestore for why the bucket went.
	filesBackend, fErr := filestore.New(filestore.Settings{
		DriverName: params.Cfg.FilesDriver,
		Directory:  params.Cfg.FilesPath,
	})
	if fErr != nil {
		params.Logger.Error("Unable to initialize the files storage", mlog.Err(fErr))

		return nil, errors.New("unable to initialize the files storage")
	}

	// Init notification services
	notificationService, errNotify := initNotificationService(params.NotifyBackends, params.Logger)
	if errNotify != nil {
		return nil, fmt.Errorf("cannot initialize notification service(s): %w", errNotify)
	}

	appServices := app.Services{
		Auth:             authenticator,
		Store:            params.DBStore,
		FilesBackend:     filesBackend,
		Notifications:    notificationService,
		Logger:           params.Logger,
		Permissions:      params.PermissionsService,
		SkipTemplateInit: utils.IsRunningUnitTests(),
	}
	app := app.New(params.Cfg, wsAdapter, appServices)

	focalboardAPI := api.NewAPI(app, params.SingleUserToken, params.Cfg.AuthMode, params.PermissionsService, params.Logger)

	// Local router for admin APIs

	// Init team
	if _, err := app.GetRootTeam(); err != nil {
		params.Logger.Error("Unable to get root team", mlog.Err(err))
		return nil, err
	}

	webServer := web.NewServer(params.Cfg.WebPath, params.Cfg.ServerRoot, params.Cfg.Port,
		params.Cfg.UseSSL, params.Cfg.LocalOnly, params.Logger)
	// if the adapter is a routed service, register it before the API
	if routedService, ok := wsAdapter.(web.RoutedService); ok {
		webServer.AddRoutes(routedService)
	}
	webServer.AddRoutes(focalboardAPI)

	server := Server{
		config:              params.Cfg,
		wsAdapter:           wsAdapter,
		webServer:           webServer,
		store:               params.DBStore,
		filesBackend:        filesBackend,
		notificationService: notificationService,
		logger:              params.Logger,
		api:                 focalboardAPI,
		app:                 app,
	}

	server.initHandlers()

	return &server, nil
}

// NewStore opens the database and hands back both the board's store and the
// handle under it. The handle is returned rather than kept private because the
// application's own tables live in this same database now:
// one file, one connection, one transaction — and on SQLite the pool below is
// capped at one connection, so a second handle would be a second writer.
func NewStore(config *config.Configuration, isSingleUser bool, logger mlog.LoggerIFace) (store.Store, *sql.DB, error) {
	dsn := config.DBConfigString
	if config.DBType == appModel.SqliteDBType {
		// Foreign keys are a connection setting on SQLite, off by default, and
		// the whole point of our tables having moved into this database:
		// without this a deleted card goes on
		// leaving its conversations, its place on a route and its stall behind
		// for ever, exactly as it did when they were separate files.
		//
		// A DSN rather than a PRAGMA because it has to hold for every
		// connection, and how it is spelled depends on which driver the build
		// tag chose — see sqlstore.SQLiteParams.
		dsn = sqlstore.SQLiteDSN(dsn)
	}
	sqlDB, err := sql.Open(config.DBType, dsn)
	if err != nil {
		logger.Error("connectDatabase failed", mlog.Err(err))
		return nil, nil, err
	}

	err = sqlDB.Ping()
	if err != nil {
		logger.Error(`Database Ping failed`, mlog.Err(err))
		return nil, nil, err
	}

	storeParams := sqlstore.Params{
		DBType:           config.DBType,
		DBPingAttempts:   config.DBPingAttempts,
		ConnectionString: config.DBConfigString,
		Logger:           logger,
		DB:               sqlDB,
		IsSingleUser:     isSingleUser,
	}

	var db store.Store
	db, err = sqlstore.New(storeParams)
	if err != nil {
		return nil, nil, err
	}

	// SQLite locks the whole table for a write, and a second connection writing
	// at the same moment does not wait -- it fails outright with "database table
	// is locked". That is SQLITE_LOCKED, which _busy_timeout does not retry; it
	// only retries SQLITE_BUSY. One connection is the usual remedy and costs
	// nothing for a store that is one file on one machine.
	//
	// Dragging a card is exactly the case that provokes it: the card's property
	// and the view's card order are written at the same moment, one of the two
	// came back 500, and the browser, which says nothing about a failed write,
	// went on showing a board the server had never agreed to -- which looks,
	// from the outside, exactly like drag and drop having stopped working.
	//
	// After the migrations, not before: the migration engine holds a connection
	// while opening another, and capping the pool at one deadlocks it on start.
	if config.DBType == appModel.SqliteDBType {
		sqlDB.SetMaxOpenConns(1)
	}

	return db, sqlDB, nil
}

func (s *Server) Start() error {
	s.logger.Info("Server.Start")

	s.webServer.Start()

	s.servicesStartStopMutex.Lock()
	defer s.servicesStartStopMutex.Unlock()

	if s.config.AuthMode != MattermostAuthMod {
		s.cleanUpSessionsTask = scheduler.CreateRecurringTask("cleanUpSessions", func() {
			secondsAgo := minSessionExpiryTime
			if secondsAgo < s.config.SessionExpireTime {
				secondsAgo = s.config.SessionExpireTime
			}

			if err := s.store.CleanUpSessions(secondsAgo); err != nil {
				s.logger.Error("Unable to clean up the sessions", mlog.Err(err))
			}
		}, cleanupSessionTaskFrequency)
	}

	return nil
}

func (s *Server) Shutdown() error {
	if err := s.webServer.Shutdown(); err != nil {
		return err
	}

	s.servicesStartStopMutex.Lock()
	defer s.servicesStartStopMutex.Unlock()

	if s.cleanUpSessionsTask != nil {
		s.cleanUpSessionsTask.Cancel()
	}

	if err := s.notificationService.Shutdown(); err != nil {
		s.logger.Warn("Error occurred when shutting down notification service", mlog.Err(err))
	}

	s.app.Shutdown()

	defer s.logger.Info("Server.Shutdown")

	return s.store.Shutdown()
}

func (s *Server) Config() *config.Configuration {
	return s.config
}

func (s *Server) Logger() mlog.LoggerIFace {
	return s.logger
}

func (s *Server) App() *app.App {
	return s.app
}

func (s *Server) Store() store.Store {
	return s.store
}

func (s *Server) UpdateAppConfig() {
	s.app.SetConfig(s.config)
}

func (s *Server) GetRootRouter() *web.Router {
	return s.webServer.Router()
}

func initNotificationService(backends []notify.Backend, logger mlog.LoggerIFace) (*notify.Service, error) {
	service, err := notify.New(logger, backends...)
	return service, err
}
