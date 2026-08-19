package api

import (
	"net/http"

	"github.com/artipop/xciii/server/model"
	"github.com/artipop/xciii/server/web"
)

func (a *API) registerContentBlocksRoutes(r *web.Router) {
	// Blocks APIs
	r.HandleFunc("POST /content-blocks/{blockID}/moveto/{where}/{dstBlockID}", a.sessionRequired(a.handleMoveBlockTo))
}

func (a *API) handleMoveBlockTo(w http.ResponseWriter, r *http.Request) {
	// swagger:operation POST /content-blocks/{blockID}/move/{where}/{dstBlockID} moveBlockTo
	//
	// Move a block after another block in the parent card
	//
	// ---
	// produces:
	// - application/json
	// parameters:
	// - name: blockID
	//   in: path
	//   description: Block ID
	//   required: true
	//   type: string
	// - name: where
	//   in: path
	//   description: Relative location respect destination block (after or before)
	//   required: true
	//   type: string
	// - name: dstBlockID
	//   in: path
	//   description: Destination Block ID
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
	//         "$ref": "#/definitions/Block"
	//   '404':
	//     description: board or block not found
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	blockID := r.PathValue("blockID")
	dstBlockID := r.PathValue("dstBlockID")
	where := r.PathValue("where")
	userID := getUserID(r)

	block, err := a.app.GetBlockByID(blockID)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	dstBlock, err := a.app.GetBlockByID(dstBlockID)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	if where != "after" && where != "before" {
		a.errorResponse(w, r, model.NewErrBadRequest("invalid where parameter, use before or after"))
		return
	}

	if userID == "" {
		a.errorResponse(w, r, model.NewErrUnauthorized("access denied to board"))
		return
	}

	if !a.permissions.HasPermissionToBoard(userID, block.BoardID, model.PermissionManageBoardCards) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to modify board cards"))
		return
	}

	err = a.app.MoveContentBlock(block, dstBlock, where, userID)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	// response
	jsonStringResponse(w, http.StatusOK, "{}")

}
