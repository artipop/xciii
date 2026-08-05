// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {JSX} from 'solid-js'

import './dot.scss'

export default function DotIcon(): JSX.Element {
    return (
        <svg
            xmlns='http://www.w3.org/2000/svg'
            class='DotIcon Icon'
            viewBox='0 0 100 100'
        >
            <circle
                cx='50'
                cy='50'
                r='5'
            />
        </svg>
    )
}
