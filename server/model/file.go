package model

import (
	"mime"
	"path/filepath"
	"strings"

	"github.com/artipop/xciii/server/utils"
	mm_model "github.com/mattermost/mattermost/server/public/model"
)

func NewFileInfo(name string) *mm_model.FileInfo {
	extension := strings.ToLower(filepath.Ext(name))
	now := utils.GetMillis()
	return &mm_model.FileInfo{
		CreatorId: "boards",
		CreateAt:  now,
		UpdateAt:  now,
		Name:      name,
		Extension: extension,
		MimeType:  mime.TypeByExtension(extension),
	}
}
