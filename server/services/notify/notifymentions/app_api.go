package notifymentions

import "github.com/artipop/xciii/server/model"

type AppAPI interface {
	GetMemberForBoard(boardID, userID string) (*model.BoardMember, error)
	AddMemberToBoard(member *model.BoardMember) (*model.BoardMember, error)
}
