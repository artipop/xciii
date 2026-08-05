// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {JSX} from 'solid-js'

import CompassIcon from './compassIcon'

import './link.scss'

export default function LinkIcon(): JSX.Element {
    return (
        <CompassIcon
            icon='link-variant'
            class='LinkIcon'
        />
    )
}
