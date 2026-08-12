package server

import (
	"fmt"

	"github.com/artipop/xciii/server/model"
	"github.com/artipop/xciii/server/services/config"
	"github.com/artipop/xciii/server/services/notify"
	"github.com/artipop/xciii/server/services/permissions"
	"github.com/artipop/xciii/server/services/store"
	"github.com/artipop/xciii/server/ws"

	"github.com/artipop/xciii/server/mlog"
)

type Params struct {
	Cfg                *config.Configuration
	SingleUserToken    string
	DBStore            store.Store
	Logger             mlog.LoggerIFace
	ServerID           string
	WSAdapter          ws.Adapter
	NotifyBackends     []notify.Backend
	PermissionsService permissions.PermissionsService
	ServicesAPI        model.ServicesAPI
}

func (p Params) CheckValid() error {
	if p.Cfg == nil {
		return ErrServerParam{name: "Cfg", issue: "cannot be nil"}
	}

	if p.DBStore == nil {
		return ErrServerParam{name: "DbStore", issue: "cannot be nil"}
	}

	if p.Logger == nil {
		return ErrServerParam{name: "Logger", issue: "cannot be nil"}
	}

	if p.PermissionsService == nil {
		return ErrServerParam{name: "Permissions", issue: "cannot be nil"}
	}
	return nil
}

type ErrServerParam struct {
	name  string
	issue string
}

func (e ErrServerParam) Error() string {
	return fmt.Sprintf("invalid server params: %s %s", e.name, e.issue)
}
