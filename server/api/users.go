package api

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/artipop/xciii/server/model"
	"github.com/artipop/xciii/server/utils"
	"github.com/artipop/xciii/server/web"
)

func (a *API) registerUsersRoutes(r *web.Router) {
	// Users APIs
	r.HandleFunc("POST /users", a.sessionRequired(a.handleGetUsersList))
	r.HandleFunc("GET /users/me", a.sessionRequired(a.handleGetMe))
	r.HandleFunc("GET /users/me/memberships", a.sessionRequired(a.handleGetMyMemberships))
	r.HandleFunc("GET /users/{userID}", a.sessionRequired(a.handleGetUser))
	r.HandleFunc("PUT /users/{userID}/config", a.sessionRequired(a.handleUpdateUserConfig))
	r.HandleFunc("GET /users/me/config", a.sessionRequired(a.handleGetUserPreferences))
}

func (a *API) handleGetUsersList(w http.ResponseWriter, r *http.Request) {
	// swagger:operation POST /users getUsersList
	//
	// Returns a user[]
	//
	// ---
	// produces:
	// - application/json
	// parameters:
	// - name: userID
	//   in: path
	//   description: User ID
	//   required: true
	//   type: string
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//     schema:
	//       "$ref": "#/definitions/User"
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	requestBody, err := io.ReadAll(r.Body)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	var userIDs []string
	if err = json.Unmarshal(requestBody, &userIDs); err != nil {
		a.errorResponse(w, r, err)
		return
	}

	var users []*model.User
	var error error

	if len(userIDs) == 0 {
		a.errorResponse(w, r, model.NewErrBadRequest("User IDs are empty"))
		return
	}

	// The single-user id has no row in the users table, so it is synthesized
	// here. The rest of the requested ids are looked up as usual: a single-user
	// install can still hold real accounts (the desktop app provisions one per
	// coding agent), and they have to come back alongside it.
	realIDs := make([]string, 0, len(userIDs))
	singleUserRequested := false
	for _, id := range userIDs {
		if id == model.SingleUser {
			singleUserRequested = true
			continue
		}
		realIDs = append(realIDs, id)
	}
	if singleUserRequested {
		ws, _ := a.app.GetRootTeam()
		now := utils.GetMillis()
		user := &model.User{
			ID:       model.SingleUser,
			Username: model.SingleUserName,
			Email:    model.SingleUser,
			CreateAt: ws.UpdateAt,
			UpdateAt: now,
		}
		users = append(users, user)
	}
	if len(realIDs) > 0 {
		var found []*model.User
		found, error = a.app.GetUsersList(realIDs)
		if error != nil {
			// A card can outlive the account it names; reporting the users that
			// do exist beats failing the whole board.
			if !model.IsErrNotFound(error) {
				a.errorResponse(w, r, error)
				return
			}
			a.logger.Debug("getUsersList: some of the requested users no longer exist")
		}
		users = append(users, found...)
	}

	ctx := r.Context()
	session := ctx.Value(sessionContextKey).(*model.Session)
	isSystemAdmin := a.permissions.HasPermissionTo(session.UserID, model.PermissionManageSystem)

	sanitizedUsers := make([]*model.User, 0)
	for _, user := range users {
		canSeeUser, err2 := a.app.CanSeeUser(session.UserID, user.ID)
		if err2 != nil {
			a.errorResponse(w, r, err2)
			return
		}
		if !canSeeUser {
			continue
		}
		if user.ID == session.UserID {
			user.Sanitize(map[string]bool{})
		} else {
			a.app.SanitizeProfile(user, isSystemAdmin)
		}
		sanitizedUsers = append(sanitizedUsers, user)
	}

	usersList, err := json.Marshal(sanitizedUsers)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	jsonStringResponse(w, http.StatusOK, string(usersList))
}

func (a *API) handleGetMe(w http.ResponseWriter, r *http.Request) {
	// swagger:operation GET /users/me getMe
	//
	// Returns the currently logged-in user
	//
	// ---
	// produces:
	// - application/json
	// parameters:
	// - name: teamID
	//   in: path
	//   description: Team ID
	//   required: false
	//   type: string
	// - name: channelID
	//   in: path
	//   description: Channel ID
	//   required: false
	//   type: string
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//     schema:
	//       "$ref": "#/definitions/User"
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"
	query := r.URL.Query()
	teamID := query.Get("teamID")
	channelID := query.Get("channelID")

	userID := getUserID(r)

	var user *model.User
	var err error

	if userID == model.SingleUser {
		ws, _ := a.app.GetRootTeam()
		now := utils.GetMillis()
		user = &model.User{
			ID:       model.SingleUser,
			Username: model.SingleUserName,
			Email:    model.SingleUser,
			CreateAt: ws.UpdateAt,
			UpdateAt: now,
		}
	} else {
		user, err = a.app.GetUser(userID)
		if err != nil {
			// ToDo: wrap with an invalid token error
			a.errorResponse(w, r, err)
			return
		}
	}

	if teamID != "" && a.permissions.HasPermissionToTeam(userID, teamID, model.PermissionManageTeam) {
		user.Permissions = append(user.Permissions, model.PermissionManageTeam.Id)
	}
	if a.permissions.HasPermissionTo(userID, model.PermissionManageSystem) {
		user.Permissions = append(user.Permissions, model.PermissionManageSystem.Id)
	}
	if channelID != "" && a.permissions.HasPermissionToChannel(userID, channelID, model.PermissionCreatePost) {
		user.Permissions = append(user.Permissions, model.PermissionCreatePost.Id)
	}

	user.Sanitize(map[string]bool{})
	userData, err := json.Marshal(user)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}
	jsonBytesResponse(w, http.StatusOK, userData)

}

func (a *API) handleGetMyMemberships(w http.ResponseWriter, r *http.Request) {
	// swagger:operation GET /users/me/memberships getMyMemberships
	//
	// Returns the currently users board memberships
	//
	// ---
	// produces:
	// - application/json
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//     schema:
	//       type: array
	//       items:
	//         "$ref": "#/definitions/BoardMember"
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	userID := getUserID(r)

	members, err := a.app.GetMembersForUser(userID)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	membersData, err := json.Marshal(members)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	jsonBytesResponse(w, http.StatusOK, membersData)

}

func (a *API) handleGetUser(w http.ResponseWriter, r *http.Request) {
	// swagger:operation GET /users/{userID} getUser
	//
	// Returns a user
	//
	// ---
	// produces:
	// - application/json
	// parameters:
	// - name: userID
	//   in: path
	//   description: User ID
	//   required: true
	//   type: string
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//     schema:
	//       "$ref": "#/definitions/User"
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	userID := r.PathValue("userID")

	user, err := a.app.GetUser(userID)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	ctx := r.Context()
	session := ctx.Value(sessionContextKey).(*model.Session)

	canSeeUser, err := a.app.CanSeeUser(session.UserID, userID)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}
	if !canSeeUser {
		a.errorResponse(w, r, model.NewErrNotFound("user ID="+userID))
		return
	}

	if userID == session.UserID {
		user.Sanitize(map[string]bool{})
	} else {
		a.app.SanitizeProfile(user, a.permissions.HasPermissionTo(session.UserID, model.PermissionManageSystem))
	}

	userData, err := json.Marshal(user)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	jsonBytesResponse(w, http.StatusOK, userData)
}

func (a *API) handleUpdateUserConfig(w http.ResponseWriter, r *http.Request) {
	// swagger:operation PATCH /users/{userID}/config updateUserConfig
	//
	// Updates user config
	//
	// ---
	// produces:
	// - application/json
	// parameters:
	// - name: userID
	//   in: path
	//   description: User ID
	//   required: true
	//   type: string
	// - name: Body
	//   in: body
	//   description: User config patch to apply
	//   required: true
	//   schema:
	//     "$ref": "#/definitions/UserPreferencesPatch"
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	requestBody, err := io.ReadAll(r.Body)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	var patch *model.UserPreferencesPatch
	err = json.Unmarshal(requestBody, &patch)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	userID := r.PathValue("userID")

	ctx := r.Context()
	session := ctx.Value(sessionContextKey).(*model.Session)

	// a user can update only own config
	if userID != session.UserID {
		a.errorResponse(w, r, model.NewErrForbidden(""))
		return
	}

	updatedConfig, err := a.app.UpdateUserConfig(userID, *patch)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	data, err := json.Marshal(updatedConfig)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	jsonBytesResponse(w, http.StatusOK, data)
}

func (a *API) handleGetUserPreferences(w http.ResponseWriter, r *http.Request) {
	// swagger:operation GET /users/me/config getUserConfig
	//
	// Returns an array of user preferences
	//
	// ---
	// produces:
	// - application/json
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//     schema:
	//       "$ref": "#/definitions/Preferences"
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	userID := getUserID(r)

	preferences, err := a.app.GetUserPreferences(userID)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	data, err := json.Marshal(preferences)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	jsonBytesResponse(w, http.StatusOK, data)
}
