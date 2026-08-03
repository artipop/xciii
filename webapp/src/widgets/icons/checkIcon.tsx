// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {JSX} from 'solid-js'

import CompassIcon from './compassIcon'

// TODO use this icon instead of check.tsx
export default function Check(): JSX.Element {
    return (
        <CompassIcon
            icon='check'
            className='CheckIconCompass'
        />
    )
}
