package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/artipop/xciii/server/model"
	"github.com/artipop/xciii/server/web"

	"github.com/artipop/xciii/server/mlog"
)

const (
	defaultPage    = "0"
	defaultPerPage = "100"
)

func (a *API) registerCardsRoutes(r *web.Router) {
	// Cards APIs
	r.HandleFunc("POST /boards/{boardID}/cards", a.sessionRequired(a.handleCreateCard))
	r.HandleFunc("GET /boards/{boardID}/cards", a.sessionRequired(a.handleGetCards))
	r.HandleFunc("PATCH /cards/{cardID}", a.sessionRequired(a.handlePatchCard))
	r.HandleFunc("GET /cards/{cardID}", a.sessionRequired(a.handleGetCard))
	r.HandleFunc("POST /cards/{cardID}/move", a.sessionRequired(a.handleMoveCard))
}

func (a *API) handleCreateCard(w http.ResponseWriter, r *http.Request) {
	// swagger:operation POST /boards/{boardID}/cards createCard
	//
	// Creates a new card for the specified board.
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
	//   description: the card to create
	//   required: true
	//   schema:
	//     "$ref": "#/definitions/Card"
	// - name: disable_notify
	//   in: query
	//   description: Disables notifications (for bulk data inserting)
	//   required: false
	//   type: bool
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//     schema:
	//       $ref: '#/definitions/Card'
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	userID := getUserID(r)
	boardID := r.PathValue("boardID")

	val := r.URL.Query().Get("disable_notify")
	disableNotify := val == True

	requestBody, err := io.ReadAll(r.Body)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	var newCard *model.Card
	if err = json.Unmarshal(requestBody, &newCard); err != nil {
		a.errorResponse(w, r, model.NewErrBadRequest(err.Error()))
		return
	}

	if !a.permissions.HasPermissionToBoard(userID, boardID, model.PermissionManageBoardCards) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to create card"))
		return
	}

	if newCard.BoardID != "" && newCard.BoardID != boardID {
		a.errorResponse(w, r, model.ErrBoardIDMismatch)
		return
	}

	newCard.PopulateWithBoardID(boardID)
	if err = newCard.CheckValid(); err != nil {
		a.errorResponse(w, r, model.NewErrBadRequest(err.Error()))
		return
	}

	// create card
	card, err := a.app.CreateCard(newCard, boardID, userID, disableNotify)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	a.logger.Debug("CreateCard",
		mlog.String("boardID", boardID),
		mlog.String("cardID", card.ID),
		mlog.String("userID", userID),
	)

	data, err := json.Marshal(card)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	// response
	jsonBytesResponse(w, http.StatusOK, data)

}

func (a *API) handleGetCards(w http.ResponseWriter, r *http.Request) {
	// swagger:operation GET /boards/{boardID}/cards getCards
	//
	// Fetches cards for the specified board.
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
	// - name: page
	//   in: query
	//   description: The page to select (default=0)
	//   required: false
	//   type: integer
	// - name: per_page
	//   in: query
	//   description: Number of cards to return per page(default=100)
	//   required: false
	//   type: integer
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//     schema:
	//       type: array
	//       items:
	//         "$ref": "#/definitions/Card"
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"
	userID := getUserID(r)
	boardID := r.PathValue("boardID")

	query := r.URL.Query()
	strPage := query.Get("page")
	strPerPage := query.Get("per_page")

	if !a.permissions.HasPermissionToBoard(userID, boardID, model.PermissionViewBoard) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to fetch cards"))
		return
	}

	if strPage == "" {
		strPage = defaultPage
	}
	if strPerPage == "" {
		strPerPage = defaultPerPage
	}

	page, err := strconv.Atoi(strPage)
	if err != nil {
		message := fmt.Sprintf("invalid `page` parameter: %s", err)
		a.errorResponse(w, r, model.NewErrBadRequest(message))
	}

	perPage, err := strconv.Atoi(strPerPage)
	if err != nil {
		message := fmt.Sprintf("invalid `per_page` parameter: %s", err)
		a.errorResponse(w, r, model.NewErrBadRequest(message))
	}

	cards, err := a.app.GetCardsForBoard(boardID, page, perPage)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	a.logger.Debug("GetCards",
		mlog.String("boardID", boardID),
		mlog.String("userID", userID),
		mlog.Int("page", page),
		mlog.Int("per_page", perPage),
		mlog.Int("count", len(cards)),
	)

	data, err := json.Marshal(cards)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	// response
	jsonBytesResponse(w, http.StatusOK, data)

}

func (a *API) handlePatchCard(w http.ResponseWriter, r *http.Request) {
	// swagger:operation PATCH /cards/{cardID}/cards patchCard
	//
	// Patches the specified card.
	//
	// ---
	// produces:
	// - application/json
	// parameters:
	// - name: cardID
	//   in: path
	//   description: Card ID
	//   required: true
	//   type: string
	// - name: Body
	//   in: body
	//   description: the card patch
	//   required: true
	//   schema:
	//     "$ref": "#/definitions/CardPatch"
	// - name: disable_notify
	//   in: query
	//   description: Disables notifications (for bulk data patching)
	//   required: false
	//   type: bool
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//     schema:
	//       $ref: '#/definitions/Card'
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	userID := getUserID(r)
	cardID := r.PathValue("cardID")

	val := r.URL.Query().Get("disable_notify")
	disableNotify := val == True

	requestBody, err := io.ReadAll(r.Body)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	card, err := a.app.GetCardByID(cardID)
	if err != nil {
		message := fmt.Sprintf("could not fetch card %s: %s", cardID, err)
		a.errorResponse(w, r, model.NewErrBadRequest(message))
		return
	}

	if !a.permissions.HasPermissionToBoard(userID, card.BoardID, model.PermissionManageBoardCards) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to patch card"))
		return
	}

	var patch *model.CardPatch
	if err = json.Unmarshal(requestBody, &patch); err != nil {
		a.errorResponse(w, r, model.NewErrBadRequest(err.Error()))
		return
	}

	// patch card
	cardPatched, err := a.app.PatchCard(patch, card.ID, userID, disableNotify)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	a.logger.Debug("PatchCard",
		mlog.String("boardID", cardPatched.BoardID),
		mlog.String("cardID", cardPatched.ID),
		mlog.String("userID", userID),
	)

	data, err := json.Marshal(cardPatched)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	// response
	jsonBytesResponse(w, http.StatusOK, data)

}

// moveCardRequest names the board a card is being carried to. A body rather
// than a query parameter, so the request reads the same as every other write
// here.
type moveCardRequest struct {
	ToBoardID string `json:"toBoardId"`
}

func (a *API) handleMoveCard(w http.ResponseWriter, r *http.Request) {
	// swagger:operation POST /cards/{cardID}/move moveCard
	//
	// Moves the specified card to another board, keeping its id.
	//
	// ---
	// produces:
	// - application/json
	// parameters:
	// - name: cardID
	//   in: path
	//   description: Card ID
	//   required: true
	//   type: string
	// - name: Body
	//   in: body
	//   description: the board to move the card to
	//   required: true
	//   schema:
	//     type: object
	//     properties:
	//       toBoardId:
	//         type: string
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//     schema:
	//       $ref: '#/definitions/Card'
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	userID := getUserID(r)
	cardID := r.PathValue("cardID")

	requestBody, err := io.ReadAll(r.Body)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	var req moveCardRequest
	if err = json.Unmarshal(requestBody, &req); err != nil {
		a.errorResponse(w, r, model.NewErrBadRequest(err.Error()))
		return
	}
	if req.ToBoardID == "" {
		a.errorResponse(w, r, model.NewErrBadRequest("toBoardId is required"))
		return
	}

	card, err := a.app.GetCardByID(cardID)
	if err != nil {
		message := fmt.Sprintf("could not fetch card %s: %s", cardID, err)
		a.errorResponse(w, r, model.NewErrBadRequest(message))
		return
	}

	// Both boards are asked, because a move takes the card off one and puts it
	// on the other: rights over the destination alone would be a way to help
	// yourself to somebody else's card.
	if !a.permissions.HasPermissionToBoard(userID, card.BoardID, model.PermissionManageBoardCards) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to move card"))
		return
	}
	if !a.permissions.HasPermissionToBoard(userID, req.ToBoardID, model.PermissionManageBoardCards) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to the board the card is moved to"))
		return
	}

	moved, err := a.app.MoveCardToBoard(card.ID, req.ToBoardID, userID)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	a.logger.Debug("MoveCard",
		mlog.String("cardID", moved.ID),
		mlog.String("boardID", moved.BoardID),
		mlog.String("userID", userID),
	)

	data, err := json.Marshal(moved)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	jsonBytesResponse(w, http.StatusOK, data)

}

func (a *API) handleGetCard(w http.ResponseWriter, r *http.Request) {
	// swagger:operation GET /cards/{cardID} getCard
	//
	// Fetches the specified card.
	//
	// ---
	// produces:
	// - application/json
	// parameters:
	// - name: cardID
	//   in: path
	//   description: Card ID
	//   required: true
	//   type: string
	// security:
	// - BearerAuth: []
	// responses:
	//   '200':
	//     description: success
	//     schema:
	//       $ref: '#/definitions/Card'
	//   default:
	//     description: internal error
	//     schema:
	//       "$ref": "#/definitions/ErrorResponse"

	userID := getUserID(r)
	cardID := r.PathValue("cardID")

	card, err := a.app.GetCardByID(cardID)
	if err != nil {
		message := fmt.Sprintf("could not fetch card %s: %s", cardID, err)
		a.errorResponse(w, r, model.NewErrBadRequest(message))
		return
	}

	if !a.permissions.HasPermissionToBoard(userID, card.BoardID, model.PermissionManageBoardCards) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to fetch card"))
		return
	}

	a.logger.Debug("GetCard",
		mlog.String("boardID", card.BoardID),
		mlog.String("cardID", card.ID),
		mlog.String("userID", userID),
	)

	data, err := json.Marshal(card)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	// response
	jsonBytesResponse(w, http.StatusOK, data)

}
