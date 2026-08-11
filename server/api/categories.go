package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/artipop/xciii/server/model"
	"github.com/artipop/xciii/server/services/audit"
	"github.com/artipop/xciii/server/web"
)

func (a *API) registerCategoriesRoutes(r *web.Router) {
	// Category APIs
	r.HandleFunc("POST /teams/{teamID}/categories", a.sessionRequired(a.handleCreateCategory))
	r.HandleFunc("PUT /teams/{teamID}/categories/reorder", a.sessionRequired(a.handleReorderCategories))
	r.HandleFunc("PUT /teams/{teamID}/categories/{categoryID}", a.sessionRequired(a.handleUpdateCategory))
	r.HandleFunc("DELETE /teams/{teamID}/categories/{categoryID}", a.sessionRequired(a.handleDeleteCategory))
	r.HandleFunc("GET /teams/{teamID}/categories", a.sessionRequired(a.handleGetUserCategoryBoards))
	r.HandleFunc("PUT /teams/{teamID}/categories/{categoryID}/boards/reorder", a.sessionRequired(a.handleReorderCategoryBoards))
	r.HandleFunc("POST /teams/{teamID}/categories/{categoryID}/boards/{boardID}", a.sessionRequired(a.handleUpdateCategoryBoard))
	r.HandleFunc("PUT /teams/{teamID}/categories/{categoryID}/boards/{boardID}/hide", a.sessionRequired(a.handleHideBoard))
	r.HandleFunc("PUT /teams/{teamID}/categories/{categoryID}/boards/{boardID}/unhide", a.sessionRequired(a.handleUnhideBoard))
}

func (a *API) handleCreateCategory(w http.ResponseWriter, r *http.Request) {
	// swagger:operation POST /teams/{teamID}/categories createCategory
	//
	// Create a category for boards
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
	// - name: Body
	//   in: body
	//   description: category to create
	//   required: true
	//   schema:
	//     "$ref": "#/definitions/Category"
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//     schema:
	//       "$ref": "#/definitions/Category"
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	requestBody, err := io.ReadAll(r.Body)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	var category model.Category

	err = json.Unmarshal(requestBody, &category)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	auditRec := a.makeAuditRecord(r, "createCategory", audit.Fail)
	defer a.audit.LogRecord(audit.LevelModify, auditRec)

	ctx := r.Context()
	session := ctx.Value(sessionContextKey).(*model.Session)

	// user can only create category for themselves
	if category.UserID != session.UserID {
		message := fmt.Sprintf("userID %s and category userID %s mismatch", session.UserID, category.UserID)
		a.errorResponse(w, r, model.NewErrBadRequest(message))
		return
	}

	teamID := r.PathValue("teamID")

	if category.TeamID != teamID {
		a.errorResponse(w, r, model.NewErrBadRequest("teamID mismatch"))
		return
	}

	if !a.permissions.HasPermissionToTeam(session.UserID, teamID, model.PermissionViewTeam) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to team"))
		return
	}

	createdCategory, err := a.app.CreateCategory(&category)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	data, err := json.Marshal(createdCategory)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	jsonBytesResponse(w, http.StatusOK, data)
	auditRec.AddMeta("categoryID", createdCategory.ID)
	auditRec.Success()
}

func (a *API) handleUpdateCategory(w http.ResponseWriter, r *http.Request) {
	// swagger:operation PUT /teams/{teamID}/categories/{categoryID} updateCategory
	//
	// Create a category for boards
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
	// - name: categoryID
	//   in: path
	//   description: Category ID
	//   required: true
	//   type: string
	// - name: Body
	//   in: body
	//   description: category to update
	//   required: true
	//   schema:
	//     "$ref": "#/definitions/Category"
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//     schema:
	//       "$ref": "#/definitions/Category"
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	categoryID := r.PathValue("categoryID")

	requestBody, err := io.ReadAll(r.Body)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	var category model.Category
	err = json.Unmarshal(requestBody, &category)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	auditRec := a.makeAuditRecord(r, "updateCategory", audit.Fail)
	defer a.audit.LogRecord(audit.LevelModify, auditRec)

	if categoryID != category.ID {
		a.errorResponse(w, r, model.NewErrBadRequest("categoryID mismatch in patch and body"))
		return
	}

	ctx := r.Context()
	session := ctx.Value(sessionContextKey).(*model.Session)

	// user can only update category for themselves
	if category.UserID != session.UserID {
		a.errorResponse(w, r, model.NewErrBadRequest("user ID mismatch in session and category"))
		return
	}

	teamID := r.PathValue("teamID")
	if category.TeamID != teamID {
		a.errorResponse(w, r, model.NewErrBadRequest("teamID mismatch"))
		return
	}

	if !a.permissions.HasPermissionToTeam(session.UserID, teamID, model.PermissionViewTeam) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to team"))
		return
	}

	updatedCategory, err := a.app.UpdateCategory(&category)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	data, err := json.Marshal(updatedCategory)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	jsonBytesResponse(w, http.StatusOK, data)
	auditRec.Success()
}

func (a *API) handleDeleteCategory(w http.ResponseWriter, r *http.Request) {
	// swagger:operation DELETE /teams/{teamID}/categories/{categoryID} deleteCategory
	//
	// Delete a category
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
	// - name: categoryID
	//   in: path
	//   description: Category ID
	//   required: true
	//   type: string
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
	session := ctx.Value(sessionContextKey).(*model.Session)

	userID := session.UserID
	teamID := r.PathValue("teamID")
	categoryID := r.PathValue("categoryID")

	auditRec := a.makeAuditRecord(r, "deleteCategory", audit.Fail)
	defer a.audit.LogRecord(audit.LevelModify, auditRec)

	if !a.permissions.HasPermissionToTeam(session.UserID, teamID, model.PermissionViewTeam) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to team"))
		return
	}

	deletedCategory, err := a.app.DeleteCategory(categoryID, userID, teamID)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	data, err := json.Marshal(deletedCategory)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	jsonBytesResponse(w, http.StatusOK, data)
	auditRec.Success()
}

func (a *API) handleGetUserCategoryBoards(w http.ResponseWriter, r *http.Request) {
	// swagger:operation GET /teams/{teamID}/categories getUserCategoryBoards
	//
	// Gets the user's board categories
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
	//       items:
	//         "$ref": "#/definitions/CategoryBoards"
	//       type: array
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	ctx := r.Context()
	session := ctx.Value(sessionContextKey).(*model.Session)
	userID := session.UserID

	teamID := r.PathValue("teamID")

	auditRec := a.makeAuditRecord(r, "getUserCategoryBoards", audit.Fail)
	defer a.audit.LogRecord(audit.LevelModify, auditRec)

	if !a.permissions.HasPermissionToTeam(session.UserID, teamID, model.PermissionViewTeam) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to team"))
		return
	}

	categoryBlocks, err := a.app.GetUserCategoryBoards(userID, teamID)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	data, err := json.Marshal(categoryBlocks)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	jsonBytesResponse(w, http.StatusOK, data)
	auditRec.Success()
}

func (a *API) handleUpdateCategoryBoard(w http.ResponseWriter, r *http.Request) {
	// swagger:operation POST /teams/{teamID}/categories/{categoryID}/boards/{boardID} updateCategoryBoard
	//
	// Set the category of a board
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
	// - name: categoryID
	//   in: path
	//   description: Category ID
	//   required: true
	//   type: string
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
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	auditRec := a.makeAuditRecord(r, "updateCategoryBoard", audit.Fail)
	defer a.audit.LogRecord(audit.LevelModify, auditRec)

	categoryID := r.PathValue("categoryID")
	boardID := r.PathValue("boardID")
	teamID := r.PathValue("teamID")

	ctx := r.Context()
	session := ctx.Value(sessionContextKey).(*model.Session)
	userID := session.UserID

	if !a.permissions.HasPermissionToTeam(session.UserID, teamID, model.PermissionViewTeam) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to team"))
		return
	}

	// TODO: Check the category and the team matches
	err := a.app.AddUpdateUserCategoryBoard(teamID, userID, categoryID, []string{boardID})
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	jsonBytesResponse(w, http.StatusOK, []byte("ok"))
	auditRec.Success()
}

func (a *API) handleReorderCategories(w http.ResponseWriter, r *http.Request) {
	// swagger:operation PUT /teams/{teamID}/categories/reorder handleReorderCategories
	//
	// Updated sidebar category order
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
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	teamID := r.PathValue("teamID")

	ctx := r.Context()
	session := ctx.Value(sessionContextKey).(*model.Session)
	userID := session.UserID

	if !a.permissions.HasPermissionToTeam(userID, teamID, model.PermissionViewTeam) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to category"))
		return
	}

	requestBody, err := io.ReadAll(r.Body)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	var newCategoryOrder []string

	err = json.Unmarshal(requestBody, &newCategoryOrder)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	auditRec := a.makeAuditRecord(r, "reorderCategories", audit.Fail)
	defer a.audit.LogRecord(audit.LevelModify, auditRec)

	auditRec.AddMeta("TeamID", teamID)
	auditRec.AddMeta("CategoryCount", len(newCategoryOrder))

	updatedCategoryOrder, err := a.app.ReorderCategories(userID, teamID, newCategoryOrder)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	data, err := json.Marshal(updatedCategoryOrder)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	jsonBytesResponse(w, http.StatusOK, data)
	auditRec.Success()
}

func (a *API) handleReorderCategoryBoards(w http.ResponseWriter, r *http.Request) {
	// swagger:operation PUT /teams/{teamID}/categories/{categoryID}/boards/reorder handleReorderCategoryBoards
	//
	// Updates order of boards inside a sidebar category
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
	// - name: categoryID
	//   in: path
	//   description: Category ID
	//   required: true
	//   type: string
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	teamID := r.PathValue("teamID")
	categoryID := r.PathValue("categoryID")

	ctx := r.Context()
	session := ctx.Value(sessionContextKey).(*model.Session)
	userID := session.UserID

	if !a.permissions.HasPermissionToTeam(userID, teamID, model.PermissionViewTeam) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to category"))
		return
	}

	category, err := a.app.GetCategory(categoryID)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	if category.UserID != userID {
		a.errorResponse(w, r, model.NewErrPermission("access denied to category"))
		return
	}

	requestBody, err := io.ReadAll(r.Body)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	var newBoardsOrder []string
	err = json.Unmarshal(requestBody, &newBoardsOrder)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	auditRec := a.makeAuditRecord(r, "reorderCategoryBoards", audit.Fail)
	defer a.audit.LogRecord(audit.LevelModify, auditRec)

	updatedBoardsOrder, err := a.app.ReorderCategoryBoards(userID, teamID, categoryID, newBoardsOrder)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	data, err := json.Marshal(updatedBoardsOrder)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	jsonBytesResponse(w, http.StatusOK, data)
	auditRec.Success()
}

func (a *API) handleHideBoard(w http.ResponseWriter, r *http.Request) {
	// swagger:operation POST /teams/{teamID}/categories/{categoryID}/boards/{boardID}/hide hideBoard
	//
	// Hide the specified board for the user
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
	// - name: categoryID
	//   in: path
	//   description: Category ID to which the board to be hidden belongs to
	//   required: true
	//   type: string
	// - name: boardID
	//   in: path
	//   description: ID of board to be hidden
	//   required: true
	//   type: string
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//     schema:
	//       "$ref": "#/definitions/Category"
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	userID := getUserID(r)
	teamID := r.PathValue("teamID")
	boardID := r.PathValue("boardID")
	categoryID := r.PathValue("categoryID")

	if !a.permissions.HasPermissionToTeam(userID, teamID, model.PermissionViewTeam) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to category"))
		return
	}

	auditRec := a.makeAuditRecord(r, "hideBoard", audit.Fail)
	defer a.audit.LogRecord(audit.LevelModify, auditRec)
	auditRec.AddMeta("board_id", boardID)
	auditRec.AddMeta("team_id", teamID)
	auditRec.AddMeta("category_id", categoryID)

	if err := a.app.SetBoardVisibility(teamID, userID, categoryID, boardID, false); err != nil {
		a.errorResponse(w, r, err)
		return
	}

	jsonStringResponse(w, http.StatusOK, "{}")
	auditRec.Success()
}

func (a *API) handleUnhideBoard(w http.ResponseWriter, r *http.Request) {
	// swagger:operation POST /teams/{teamID}/categories/{categoryID}/boards/{boardID}/hide unhideBoard
	//
	// Unhides the specified board for the user
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
	// - name: categoryID
	//   in: path
	//   description: Category ID to which the board to be unhidden belongs to
	//   required: true
	//   type: string
	// - name: boardID
	//   in: path
	//   description: ID of board to be unhidden
	//   required: true
	//   type: string
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//     schema:
	//       "$ref": "#/definitions/Category"
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	userID := getUserID(r)
	teamID := r.PathValue("teamID")
	boardID := r.PathValue("boardID")
	categoryID := r.PathValue("categoryID")

	if !a.permissions.HasPermissionToTeam(userID, teamID, model.PermissionViewTeam) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to category"))
		return
	}

	auditRec := a.makeAuditRecord(r, "unhideBoard", audit.Fail)
	defer a.audit.LogRecord(audit.LevelModify, auditRec)
	auditRec.AddMeta("boardID", boardID)

	if err := a.app.SetBoardVisibility(teamID, userID, categoryID, boardID, true); err != nil {
		a.errorResponse(w, r, err)
		return
	}

	jsonStringResponse(w, http.StatusOK, "{}")
	auditRec.Success()
}
