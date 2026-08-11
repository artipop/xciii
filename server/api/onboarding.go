package api

import (
	"encoding/json"
	"net/http"

	"github.com/artipop/xciii/server/model"
	"github.com/artipop/xciii/server/web"
)

func (a *API) registerOnboardingRoutes(r *web.Router) {
	// Onboarding tour endpoints APIs
	r.HandleFunc("POST /teams/{teamID}/onboard", a.sessionRequired(a.handleOnboard))
}

func (a *API) handleOnboard(w http.ResponseWriter, r *http.Request) {
	// swagger:operation POST /team/{teamID}/onboard onboard
	//
	// Onboards a user on Boards.
	//
	// ---
	// produces:
	// - application/json
	// parameters:
	// - name: teamID
	//   in: path
	//   description: Team ID
	//   required: true
	//   type: string
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//     schema:
	//       type: object
	//       properties:
	//         teamID:
	//           type: string
	//           description: Team ID
	//         boardID:
	//           type: string
	//           description: Board ID
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"
	teamID := r.PathValue("teamID")
	userID := getUserID(r)

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

	teamID, boardID, err := a.app.PrepareOnboardingTour(userID, teamID)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	response := map[string]string{
		"teamID":  teamID,
		"boardID": boardID,
	}
	data, err := json.Marshal(response)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	jsonBytesResponse(w, http.StatusOK, data)
}
