package app

import (
	"github.com/artipop/xciii/server/model"
)

func (a *App) GetTeamUsers(teamID string, asGuestID string) ([]*model.User, error) {
	return a.store.GetUsersByTeam(teamID, asGuestID, a.config.ShowEmailAddress, a.config.ShowFullName)
}

func (a *App) SearchTeamUsers(teamID string, searchQuery string, asGuestID string, excludeBots bool) ([]*model.User, error) {
	users, err := a.store.SearchUsersByTeam(teamID, searchQuery, asGuestID, excludeBots, a.config.ShowEmailAddress, a.config.ShowFullName)
	if err != nil {
		return nil, err
	}

	for i, u := range users {
		if a.permissions.HasPermissionToTeam(u.ID, teamID, model.PermissionManageTeam) {
			users[i].Permissions = append(users[i].Permissions, model.PermissionManageTeam.Id)
		}
		if a.permissions.HasPermissionTo(u.ID, model.PermissionManageSystem) {
			users[i].Permissions = append(users[i].Permissions, model.PermissionManageSystem.Id)
		}
	}
	return users, nil
}

func (a *App) UpdateUserConfig(userID string, patch model.UserPreferencesPatch) ([]model.Preference, error) {
	updatedPreferences, err := a.store.PatchUserPreferences(userID, patch)
	if err != nil {
		return nil, err
	}

	return updatedPreferences, nil
}

func (a *App) GetUserPreferences(userID string) ([]model.Preference, error) {
	return a.store.GetUserPreferences(userID)
}

func (a *App) UserIsGuest(userID string) (bool, error) {
	// The single-user session is synthesized by the API and has no row in the
	// users table; it owns the whole install, so it is never a guest. Without
	// this, every call that guards on guest-ness fails in single-user mode.
	if userID == model.SingleUser {
		return false, nil
	}

	user, err := a.store.GetUserByID(userID)
	if err != nil {
		return false, err
	}
	return user.IsGuest, nil
}

func (a *App) CanSeeUser(seerUser string, seenUser string) (bool, error) {
	isGuest, err := a.UserIsGuest(seerUser)
	if err != nil {
		return false, err
	}
	if isGuest {
		hasSharedChannels, err := a.store.CanSeeUser(seerUser, seenUser)
		if err != nil {
			return false, err
		}
		return hasSharedChannels, nil
	}
	return true, nil
}

// What used to stand here: SearchUserChannels and GetChannel, which asked the
// Mattermost host which channels somebody could see. This product has no
// channels; the store answered "not implemented" and the search endpoint
// returned an empty list.

func (a *App) SanitizeProfile(user *model.User, isAdmin bool) {
	options := map[string]bool{}
	if isAdmin {
		options["fullname"] = true
		options["email"] = true
	} else {
		options["fullname"] = a.config.ShowFullName
		options["email"] = a.config.ShowEmailAddress
	}
	user.Sanitize(options)
}
