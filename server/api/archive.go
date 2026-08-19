package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/artipop/xciii/server/model"
	"github.com/artipop/xciii/server/web"

	"github.com/artipop/xciii/server/mlog"
)

const (
	archiveExtension = ".boardarchive"
)

func (a *API) registerAchivesRoutes(r *web.Router) {
	// Archive APIs
	r.HandleFunc("GET /boards/{boardID}/archive/export", a.sessionRequired(a.handleArchiveExportBoard))
	r.HandleFunc("POST /teams/{teamID}/archive/import", a.sessionRequired(a.handleArchiveImport))
	r.HandleFunc("GET /teams/{teamID}/archive/export", a.sessionRequired(a.handleArchiveExportTeam))
}

func (a *API) handleArchiveExportBoard(w http.ResponseWriter, r *http.Request) {
	// swagger:operation GET /boards/{boardID}/archive/export archiveExportBoard
	//
	// Exports an archive of all blocks for one boards.
	//
	// ---
	// produces:
	// - application/json
	// parameters:
	// - name: boardID
	//   in: path
	//   description: Id of board to export
	//   required: true
	//   type: string
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//     content:
	//       application-octet-stream:
	//         type: string
	//         format: binary
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	boardID := r.PathValue("boardID")
	userID := getUserID(r)

	// Somebody who cannot see the board cannot export it. Upstream let a system
	// administrator through here if the licence carried the compliance feature;
	// this product has no licence, so that arm was unreachable and is gone with
	// the rest of the licensed surface.
	if !a.permissions.HasPermissionToBoard(userID, boardID, model.PermissionViewBoard) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to board"))
		return
	}

	board, err := a.app.GetBoard(boardID)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	opts := model.ExportArchiveOptions{
		TeamID:   board.TeamID,
		BoardIDs: []string{board.ID},
	}

	filename := fmt.Sprintf("archive-%s%s", time.Now().Format("2006-01-02"), archiveExtension)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment; filename="+filename)
	w.Header().Set("Content-Transfer-Encoding", "binary")

	if err := a.app.ExportArchive(w, opts); err != nil {
		a.errorResponse(w, r, err)
	}

}

func (a *API) handleArchiveImport(w http.ResponseWriter, r *http.Request) {
	// swagger:operation POST /teams/{teamID}/archive/import archiveImport
	//
	// Import an archive of boards.
	//
	// ---
	// produces:
	// - application/json
	// consumes:
	// - multipart/form-data
	// parameters:
	// - name: teamID
	//   in: path
	//   description: Team ID
	//   required: true
	//   type: string
	// - name: file
	//   in: formData
	//   description: archive file to import
	//   required: true
	//   type: file
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	ctx := r.Context()
	session, _ := ctx.Value(sessionContextKey).(*model.Session)
	userID := session.UserID

	teamID := r.PathValue("teamID")

	if !a.permissions.HasPermissionToTeam(userID, teamID, model.PermissionViewTeam) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to create board"))
		return
	}

	isGuest, err := a.userIsGuest(userID)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}
	if isGuest {
		a.errorResponse(w, r, model.NewErrPermission("access denied to create board"))
		return
	}

	file, _, err := r.FormFile(UploadFormFileKey)
	if err != nil {
		fmt.Fprintf(w, "%v", err)
		return
	}
	defer file.Close()

	opt := model.ImportArchiveOptions{
		TeamID:     teamID,
		ModifiedBy: userID,
	}

	if err := a.app.ImportArchive(file, opt); err != nil {
		a.logger.Debug("Error importing archive",
			mlog.String("team_id", teamID),
			mlog.Err(err),
		)
		a.errorResponse(w, r, err)
		return
	}

	jsonStringResponse(w, http.StatusOK, "{}")
}

func (a *API) handleArchiveExportTeam(w http.ResponseWriter, r *http.Request) {
	// swagger:operation GET /teams/{teamID}/archive/export archiveExportTeam
	//
	// Exports an archive of all blocks for all the boards in a team.
	//
	// ---
	// produces:
	// - application/json
	// parameters:
	// - name: teamID
	//   in: path
	//   description: Id of team
	//   required: true
	//   type: string
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//     content:
	//       application-octet-stream:
	//         type: string
	//         format: binary
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"
	if a.MattermostAuth {
		a.errorResponse(w, r, model.NewErrNotImplemented("not permitted in plugin mode"))
		return
	}

	teamID := r.PathValue("teamID")

	ctx := r.Context()
	session, _ := ctx.Value(sessionContextKey).(*model.Session)
	userID := session.UserID

	isGuest, err := a.userIsGuest(userID)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	boards, err := a.app.GetBoardsForUserAndTeam(userID, teamID, !isGuest)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}
	ids := []string{}
	for _, board := range boards {
		ids = append(ids, board.ID)
	}

	opts := model.ExportArchiveOptions{
		TeamID:   teamID,
		BoardIDs: ids,
	}

	filename := fmt.Sprintf("archive-%s%s", time.Now().Format("2006-01-02"), archiveExtension)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment; filename="+filename)
	w.Header().Set("Content-Transfer-Encoding", "binary")

	if err := a.app.ExportArchive(w, opts); err != nil {
		a.errorResponse(w, r, err)
	}

}
