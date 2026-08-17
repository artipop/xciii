package app

import (
	"github.com/artipop/xciii/server/model"
)

func (a *App) HasPermissionToBoard(userID, boardID string, permission *model.Permission) bool {
	return a.permissions.HasPermissionToBoard(userID, boardID, permission)
}
