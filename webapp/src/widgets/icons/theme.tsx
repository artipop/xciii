// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {JSX} from 'solid-js'

// A circle with one half filled: the same contrast mark every desktop uses for
// "how this looks", and the only icon in the set that reads as both themes at
// once — a sun would say "light" while the app is dark.
export default function ThemeIcon(): JSX.Element {
    return (
        <svg
            width='24'
            height='24'
            viewBox='0 0 24 24'
            fill='none'
            xmlns='http://www.w3.org/2000/svg'
            class='ThemeIcon Icon'
        >
            <circle
                cx='12'
                cy='12'
                r='8.4'
                stroke='currentColor'
                stroke-width='1.7'
            />
            <path
                d='M12 3.6a8.4 8.4 0 0 1 0 16.8V3.6Z'
                fill='currentColor'
            />
        </svg>
    )
}
