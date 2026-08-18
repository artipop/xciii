package api

import (
	"encoding/json"
	"net/http"

	"github.com/artipop/xciii/server/model"
	"github.com/artipop/xciii/server/web"

	"github.com/artipop/xciii/server/mlog"
)

func (a *API) registerSearchRoutes(r *web.Router) {
	r.HandleFunc("GET /teams/{teamID}/boards/search", a.sessionRequired(a.handleSearchBoards))
	r.HandleFunc("GET /teams/{teamID}/boards/search/linkable", a.sessionRequired(a.handleSearchLinkableBoards))
	r.HandleFunc("GET /boards/search", a.sessionRequired(a.handleSearchAllBoards))
}

// What used to stand here: handleSearchMyChannels, which listed the Mattermost
// channels somebody could see. This product has no channels, the store answered
// "not implemented", and the page never asked.

func (a *API) handleSearchBoards(w http.ResponseWriter, r *http.Request) {
	// swagger:operation GET /teams/{teamID}/boards/search searchBoards
	//
	// Returns the boards that match with a search term in the team
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
	// - name: q
	//   in: query
	//   description: The search term. Must have at least one character
	//   required: true
	//   type: string
	// - name: field
	//   in: query
	//   description: The field to search on for search term. Can be `title`, `property_name`. Defaults to `title`
	//   required: false
	//   type: string
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//     schema:
	//       type: array
	//       items:
	//         "$ref": "#/definitions/Board"
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	var err error
	teamID := r.PathValue("teamID")
	term := r.URL.Query().Get("q")
	searchFieldText := r.URL.Query().Get("field")
	searchField := model.BoardSearchFieldTitle
	if searchFieldText != "" {
		searchField, err = model.BoardSearchFieldFromString(searchFieldText)
		if err != nil {
			a.errorResponse(w, r, model.NewErrBadRequest(err.Error()))
			return
		}
	}
	userID := getUserID(r)

	if !a.permissions.HasPermissionToTeam(userID, teamID, model.PermissionViewTeam) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to team"))
		return
	}

	if len(term) == 0 {
		jsonStringResponse(w, http.StatusOK, "[]")
		return
	}

	isGuest, err := a.userIsGuest(userID)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	// retrieve boards list
	boards, err := a.app.SearchBoardsForUser(term, searchField, userID, !isGuest)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	a.logger.Debug("SearchBoards",
		mlog.String("teamID", teamID),
		mlog.Int("boardsCount", len(boards)),
	)

	data, err := json.Marshal(boards)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	// response
	jsonBytesResponse(w, http.StatusOK, data)

}

func (a *API) handleSearchLinkableBoards(w http.ResponseWriter, r *http.Request) {
	// swagger:operation GET /teams/{teamID}/boards/search/linkable searchLinkableBoards
	//
	// Returns the boards that match with a search term in the team and the
	// user has permission to manage members
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
	// - name: q
	//   in: query
	//   description: The search term. Must have at least one character
	//   required: true
	//   type: string
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//     schema:
	//       type: array
	//       items:
	//         "$ref": "#/definitions/Board"
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	if !a.MattermostAuth {
		a.errorResponse(w, r, model.NewErrNotImplemented("not permitted in standalone mode"))
		return
	}

	teamID := r.PathValue("teamID")
	term := r.URL.Query().Get("q")
	userID := getUserID(r)

	if !a.permissions.HasPermissionToTeam(userID, teamID, model.PermissionViewTeam) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to team"))
		return
	}

	if len(term) == 0 {
		jsonStringResponse(w, http.StatusOK, "[]")
		return
	}

	// retrieve boards list
	boards, err := a.app.SearchBoardsForUserInTeam(teamID, term, userID)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	linkableBoards := []*model.Board{}
	for _, board := range boards {
		if a.permissions.HasPermissionToBoard(userID, board.ID, model.PermissionManageBoardRoles) {
			linkableBoards = append(linkableBoards, board)
		}
	}

	a.logger.Debug("SearchLinkableBoards",
		mlog.String("teamID", teamID),
		mlog.Int("boardsCount", len(linkableBoards)),
	)

	data, err := json.Marshal(linkableBoards)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	// response
	jsonBytesResponse(w, http.StatusOK, data)

}

func (a *API) handleSearchAllBoards(w http.ResponseWriter, r *http.Request) {
	// swagger:operation GET /boards/search searchAllBoards
	//
	// Returns the boards that match with a search term
	//
	// ---
	// produces:
	// - application/json
	// parameters:
	// - name: q
	//   in: query
	//   description: The search term. Must have at least one character
	//   required: true
	//   type: string
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//     schema:
	//       type: array
	//       items:
	//         "$ref": "#/definitions/Board"
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	term := r.URL.Query().Get("q")
	userID := getUserID(r)

	if len(term) == 0 {
		jsonStringResponse(w, http.StatusOK, "[]")
		return
	}

	isGuest, err := a.userIsGuest(userID)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	// retrieve boards list
	boards, err := a.app.SearchBoardsForUser(term, model.BoardSearchFieldTitle, userID, !isGuest)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	a.logger.Debug("SearchAllBoards",
		mlog.Int("boardsCount", len(boards)),
	)

	data, err := json.Marshal(boards)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	// response
	jsonBytesResponse(w, http.StatusOK, data)

}
