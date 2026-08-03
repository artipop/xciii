// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {FormattedMessage} from '../intl'

import './guestBadge.scss'

type Props = {
    show?: boolean
}

const GuestBadge = (props: Props) => {
    if (!props.show) {
        return null
    }
    return (
        <div class='GuestBadge'>
            <div class='GuestBadge__box'>
                <FormattedMessage
                    id='badge.guest'
                    defaultMessage='Guest'
                />
            </div>
        </div>
    )
}

export default GuestBadge
