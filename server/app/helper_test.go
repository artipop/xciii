package app

import (
	"testing"

	"github.com/golang/mock/gomock"

	"github.com/artipop/xciii/server/auth"
	"github.com/artipop/xciii/server/services/config"
	permissionsMocks "github.com/artipop/xciii/server/services/permissions/mocks"
	"github.com/artipop/xciii/server/services/store/mockstore"
	"github.com/artipop/xciii/server/ws"

	"github.com/artipop/xciii/server/mlog"
	"github.com/artipop/xciii/server/services/filestore/mocks"
)

type TestHelper struct {
	App          *App
	Store        *mockstore.MockStore
	FilesBackend *mocks.FileBackend
	logger       mlog.LoggerIFace
	// The permissions service itself is mocked rather than built over a mocked
	// plugin API: the service that consulted one went with the plugin mode, and
	// what these tests were ever saying is "the answer to this permission is
	// yes" — which is a sentence about the service.
	API *permissionsMocks.MockPermissionsService
}

func SetupTestHelper(t *testing.T) (*TestHelper, func()) {
	ctrl := gomock.NewController(t)
	cfg := config.Configuration{}
	store := mockstore.NewMockStore(ctrl)
	filesBackend := &mocks.FileBackend{}
	auth := auth.New(&cfg, store, nil)
	logger, _ := mlog.NewLogger()
	sessionToken := "TESTTOKEN"
	wsserver := ws.NewServer(auth, sessionToken, false, logger, store)

	permissions := permissionsMocks.NewMockPermissionsService(ctrl)

	appServices := Services{
		Auth:             auth,
		Store:            store,
		FilesBackend:     filesBackend,
		Logger:           logger,
		SkipTemplateInit: true,
		Permissions:      permissions,
	}
	app2 := New(&cfg, wsserver, appServices)

	tearDown := func() {
		app2.Shutdown()
		if logger != nil {
			_ = logger.Shutdown()
		}
	}

	return &TestHelper{
		App:          app2,
		Store:        store,
		FilesBackend: filesBackend,
		logger:       logger,
		API:          permissions,
	}, tearDown
}
