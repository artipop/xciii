package localpermissions

import (
	"testing"

	"github.com/artipop/xciii/server/model"
	permissionsMocks "github.com/artipop/xciii/server/services/permissions/mocks"

	"github.com/artipop/xciii/server/mlog"

	"github.com/golang/mock/gomock"
	"github.com/stretchr/testify/assert"
)

type TestHelper struct {
	t           *testing.T
	ctrl        *gomock.Controller
	store       *permissionsMocks.MockStore
	permissions *Service
}

func SetupTestHelper(t *testing.T) *TestHelper {
	ctrl := gomock.NewController(t)
	mockStore := permissionsMocks.NewMockStore(ctrl)
	return &TestHelper{
		t:           t,
		ctrl:        ctrl,
		store:       mockStore,
		permissions: New(mockStore, mlog.CreateConsoleTestLogger(t)),
	}
}

func (th *TestHelper) checkBoardPermissions(roleName string, member *model.BoardMember, hasPermissionTo, hasNotPermissionTo []*model.Permission) {
	for _, p := range hasPermissionTo {
		th.t.Run(roleName+" "+p.Id, func(t *testing.T) {
			th.store.EXPECT().
				GetMemberForBoard(member.BoardID, member.UserID).
				Return(member, nil).
				Times(1)

			hasPermission := th.permissions.HasPermissionToBoard(member.UserID, member.BoardID, p)
			assert.True(t, hasPermission)
		})
	}

	for _, p := range hasNotPermissionTo {
		th.t.Run(roleName+" "+p.Id, func(t *testing.T) {
			th.store.EXPECT().
				GetMemberForBoard(member.BoardID, member.UserID).
				Return(member, nil).
				Times(1)

			hasPermission := th.permissions.HasPermissionToBoard(member.UserID, member.BoardID, p)
			assert.False(t, hasPermission)
		})
	}
}
