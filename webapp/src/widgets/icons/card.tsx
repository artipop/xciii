// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {JSX} from 'solid-js'

import './card.scss'

export default function CardIcon(): JSX.Element {
    return (
        <svg
            xmlns='http://www.w3.org/2000/svg'
            class='CardIcon Icon'
            viewBox='0 0 100 100'
        >
            <rect
                x='20'
                y='30'
                width='60'
                height='40'
                rx='3'
                ry='3'
            />
        </svg>
    )
}
