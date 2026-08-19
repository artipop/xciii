package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/artipop/xciii/server/model"
	"github.com/artipop/xciii/server/web"

	"github.com/artipop/xciii/server/mlog"
)

var ErrTurningOnSharing = errors.New("turning on sharing for board failed, see log for details")

func (a *API) registerSharingRoutes(r *web.Router) {
	// Sharing APIs
	r.HandleFunc("POST /boards/{boardID}/sharing", a.sessionRequired(a.handlePostSharing))
	r.HandleFunc("GET /boards/{boardID}/sharing", a.sessionRequired(a.handleGetSharing))
}

func (a *API) handleGetSharing(w http.ResponseWriter, r *http.Request) {
	// swagger:operation GET /boards/{boardID}/sharing getSharing
	//
	// Returns sharing information for a board
	//
	// ---
	// produces:
	// - application/json
	// parameters:
	// - name: boardID
	//   in: path
	//   description: Board ID
	//   required: true
	//   type: string
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//     schema:
	//       "$ref": "#/definitions/Sharing"
	//   '404':
	//     description: board not found
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	boardID := r.PathValue("boardID")

	userID := getUserID(r)
	if !a.permissions.HasPermissionToBoard(userID, boardID, model.PermissionShareBoard) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to sharing the board"))
		return
	}

	sharing, err := a.app.GetSharing(boardID)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	sharingData, err := json.Marshal(sharing)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	jsonBytesResponse(w, http.StatusOK, sharingData)

	a.logger.Debug("GET sharing",
		mlog.String("boardID", boardID),
		mlog.String("shareID", sharing.ID),
		mlog.Bool("enabled", sharing.Enabled),
	)
}

func (a *API) handlePostSharing(w http.ResponseWriter, r *http.Request) {
	// swagger:operation POST /boards/{boardID}/sharing postSharing
	//
	// Sets sharing information for a board
	//
	// ---
	// produces:
	// - application/json
	// parameters:
	// - name: boardID
	//   in: path
	//   description: Board ID
	//   required: true
	//   type: string
	// - name: Body
	//   in: body
	//   description: sharing information for a root block
	//   required: true
	//   schema:
	//     "$ref": "#/definitions/Sharing"
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	boardID := r.PathValue("boardID")

	userID := getUserID(r)
	if !a.permissions.HasPermissionToBoard(userID, boardID, model.PermissionShareBoard) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to sharing the board"))
		return
	}

	requestBody, err := io.ReadAll(r.Body)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	var sharing model.Sharing
	err = json.Unmarshal(requestBody, &sharing)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	// Stamp boardID from the URL
	sharing.ID = boardID

	// Stamp ModifiedBy
	modifiedBy := userID
	if userID == model.SingleUser {
		modifiedBy = ""
	}
	sharing.ModifiedBy = modifiedBy

	if userID == model.SingleUser {
		userID = ""
	}

	if !a.app.GetClientConfig().EnablePublicSharedBoards {
		a.logger.Warn(
			"Attempt to turn on sharing for board via API failed, sharing off in configuration.",
			mlog.String("boardID", sharing.ID),
			mlog.String("userID", userID))
		a.errorResponse(w, r, ErrTurningOnSharing)
		return
	}

	sharing.ModifiedBy = userID

	err = a.app.UpsertSharing(sharing)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	jsonStringResponse(w, http.StatusOK, "{}")

	a.logger.Debug("POST sharing", mlog.String("sharingID", sharing.ID))
}
