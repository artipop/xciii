// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {JSX} from 'solid-js'

import './calendar.scss'

export default function CalendarIcon(): JSX.Element {
    return (
        <svg
            width='24'
            height='24'
            viewBox='0 0 24 24'
            fill='currentColor'
            xmlns='http://www.w3.org/2000/svg'
            class='CalendarIcon Icon'
        >
            <g opacity='0.8'>
                <path
                    fill-rule='evenodd'
                    clip-rule='evenodd'
                    d='M4 4H20V7L4 7V4ZM4 9L4 20H20V9L4 9ZM2 4C2 2.89543 2.89543 2 4 2H20C21.1046 2 22 2.89543 22 4V20C22 21.1046 21.1046 22 20 22H4C2.89543 22 2 21.1046 2 20V4ZM6 11H8V13H6V11ZM8 17V15H6V17H8ZM13 11V13H11V11H13ZM13 17V15H11V17H13ZM18 11V13H16V11H18ZM18 17V15H16V17H18Z'
                    fill='currentColor'
                />
            </g>
        </svg>
    )
}
