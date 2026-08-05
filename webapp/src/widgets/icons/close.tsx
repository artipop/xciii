// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {JSX} from 'solid-js'

import CompassIcon from './compassIcon'

export default function CloseIcon(): JSX.Element {
    return (
        <CompassIcon
            icon='close'
            class='CloseIcon'
        />
    )
}
