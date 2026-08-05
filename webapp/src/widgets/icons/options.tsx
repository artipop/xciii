// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {JSX} from 'solid-js'

import CompassIcon from './compassIcon'

import './options.scss'

export default function OptionsIcon(): JSX.Element {
    return (
        <CompassIcon
            icon='dots-horizontal'
            class='OptionsIcon'
        />
    )
}
