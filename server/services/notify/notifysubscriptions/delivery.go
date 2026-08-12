package notifysubscriptions

import (
	"github.com/artipop/xciii/server/model"

	mm_model "github.com/mattermost/mattermost/server/public/model"
)

// SubscriptionDelivery provides an interface for delivering subscription notifications to other systems, such as
// channels server via plugin API.
type SubscriptionDelivery interface {
	SubscriptionDeliverSlackAttachments(teamID string, subscriberID string, subscriberType model.SubscriberType,
		attachments []*mm_model.SlackAttachment) error
}
