package notifymentions

import (
	"regexp"
	"strings"

	"github.com/artipop/xciii/server/model"

	mm_model "github.com/mattermost/mattermost/server/public/model"
)

var atMentionRegexp = regexp.MustCompile(`\B@[[:alnum:]][[:alnum:]\.\-_:]*`)

// extractMentions extracts any mentions in the specified block and returns
// a slice of usernames.
func extractMentions(block *model.Block) map[string]struct{} {
	mentions := make(map[string]struct{})
	if block == nil || !strings.Contains(block.Title, "@") {
		return mentions
	}

	str := block.Title

	for _, match := range atMentionRegexp.FindAllString(str, -1) {
		name := mm_model.NormalizeUsername(match[1:])
		if mm_model.IsValidUsernameAllowRemote(name) {
			mentions[name] = struct{}{}
		}
	}
	return mentions
}
