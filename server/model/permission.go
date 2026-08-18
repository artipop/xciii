package model

// Permission is a thing somebody may or may not do. It used to be
// Mattermost's own type, which meant every permission check in this product
// reached into the plugin host it was extracted from; the type is four strings
// and nothing consults the host about them.
//
// Only the Id is ever read — the permissions service compares ids and the API
// reports one in an error — so the other three fields exist because the
// upstream shape had them and something may yet want a label on a screen.
type Permission struct {
	Id          string
	Name        string
	Description string
	Scope       string
}

// The permissions this product actually checks.
//
// The first eight kept their upstream ids on purpose: they are what a board
// exported from a Mattermost install carries, and an id is what gets compared.
// The rest are the board's own and always were.
var (
	// About a team or the system. In this product there is one team, whose id
	// is '0', so these are effectively "is there anybody at all" — the
	// single-user permissions service answers yes.
	PermissionViewTeam     = &Permission{Id: "view_team"}
	PermissionManageTeam   = &Permission{Id: "manage_team"}
	PermissionManageSystem = &Permission{Id: "manage_system"}

	// About a channel, which this product has none of. They are still checked
	// on the paths shared with the plugin build.
	PermissionReadChannel          = &Permission{Id: "read_channel"}
	PermissionCreatePost           = &Permission{Id: "create_post"}
	PermissionViewMembers          = &Permission{Id: "view_members"}
	PermissionCreatePublicChannel  = &Permission{Id: "create_public_channel"}
	PermissionCreatePrivateChannel = &Permission{Id: "create_private_channel"}

	// Asked for by the statistics endpoint, which reports how much is on the
	// boards. Upstream's id, for the same reason as the eight above.

	// About a board, and these are the ones that decide anything here.
	PermissionManageBoardType       = &Permission{Id: "manage_board_type"}
	PermissionDeleteBoard           = &Permission{Id: "delete_board"}
	PermissionViewBoard             = &Permission{Id: "view_board"}
	PermissionManageBoardRoles      = &Permission{Id: "manage_board_roles"}
	PermissionShareBoard            = &Permission{Id: "share_board"}
	PermissionManageBoardCards      = &Permission{Id: "manage_board_cards"}
	PermissionManageBoardProperties = &Permission{Id: "manage_board_properties"}
	PermissionCommentBoardCards     = &Permission{Id: "comment_board_cards"}
	PermissionDeleteOthersComments  = &Permission{Id: "delete_others_comments"}
)
