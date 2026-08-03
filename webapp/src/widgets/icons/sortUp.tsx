// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {JSX} from 'solid-js'

import './sortUp.scss'

export default function SortUpIcon(): JSX.Element {
    return (
        <svg
            xmlns='http://www.w3.org/2000/svg'
            class='SortUpIcon Icon'
            viewBox='0 0 100 100'
        >
            <polyline points='50,20 50,80'/>
            <polyline points='30,40 50,20 70,40'/>
        </svg>
    )
}
