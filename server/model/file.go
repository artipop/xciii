package model

import (
	"mime"
	"path/filepath"
	"strings"

	"github.com/artipop/xciii/server/utils"
)

// FileInfo is an attachment on a card. It was mattermost's FileInfo, which
// carries forty fields about posts, channels, thumbnails and image dimensions —
// eight of which the `file_info` table has columns for and this application ever
// reads. MimeType is the ninth: it is derived from the name rather than stored,
// and it is what the download handler answers with.
//
// The JSON names are the ones the page already reads, which is why Id keeps its
// mattermost spelling rather than becoming ID.
type FileInfo struct {
	Id        string `json:"id"`
	CreateAt  int64  `json:"create_at"`
	DeleteAt  int64  `json:"delete_at"`
	Name      string `json:"name"`
	Extension string `json:"extension"`
	Size      int64  `json:"size"`
	Archived  bool   `json:"archived"`
	Path      string `json:"-"`

	// MimeType is not a column: NewFileInfo derives it from the extension, and a
	// row read back from the database derives it again (fileInfoMimeType), so the
	// two paths cannot disagree about a file's type.
	MimeType string `json:"mime_type"`
}

// NewFileInfo is what an upload becomes before it is stored.
func NewFileInfo(name string) *FileInfo {
	extension := strings.ToLower(filepath.Ext(name))
	return &FileInfo{
		CreateAt:  utils.GetMillis(),
		Name:      name,
		Extension: extension,
		MimeType:  mime.TypeByExtension(extension),
	}
}

// SetMimeType fills in the type from the extension, for a row that came out of
// the database rather than off an upload.
func (fi *FileInfo) SetMimeType() {
	if fi.MimeType == "" {
		fi.MimeType = mime.TypeByExtension(strings.ToLower(fi.Extension))
	}
}
