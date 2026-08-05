// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {JSX} from 'solid-js'

import './appLogo.scss'

// The product mark: three columns of a board, tallest first. Drawn here rather
// than imported as a file so it inherits the sidebar's text colour through
// `fill`, the way every other icon in this directory does.
export default function AppLogoIcon(): JSX.Element {
    return (
        <svg
            class='AppLogoIcon Icon'
            version='1.1'
            x='0px'
            y='0px'
            viewBox='0 0 24 24'
        >
            <rect
                x='2.5'
                y='4'
                width='5'
                height='16'
                rx='1.5'
            />
            <rect
                x='9.5'
                y='4'
                width='5'
                height='11'
                rx='1.5'
            />
            <rect
                x='16.5'
                y='4'
                width='5'
                height='6'
                rx='1.5'
            />
        </svg>
    )
}
