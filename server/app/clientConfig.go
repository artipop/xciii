package app

import (
	"github.com/artipop/xciii/server/model"
)

func (a *App) GetClientConfig() *model.ClientConfig {
	return &model.ClientConfig{
		EnablePublicSharedBoards: a.config.EnablePublicSharedBoards,
		TeammateNameDisplay:      a.config.TeammateNameDisplay,
		FeatureFlags:             a.config.FeatureFlags,
		MaxFileSize:              a.config.MaxFileSize,
		TeamMode:                 a.config.TeamMode,
	}
}
