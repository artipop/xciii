// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {JSX} from 'solid-js'

import './topBar.scss'
import {FormattedMessage} from '../intl'

import HelpIcon from '../widgets/icons/help'
import {Constants} from '../constants'

const TopBar = (): JSX.Element => {
    return (
        <div
            class='TopBar'
        >
            <a
                class='link'
                href={Constants.issuesUrl}
                target='_blank'
                rel='noreferrer'
            >
                <FormattedMessage
                    id='TopBar.give-feedback'
                    defaultMessage='Give feedback'
                />
            </a>
            <a
                href={Constants.homeUrl}
                target='_blank'
                rel='noreferrer'
            >
                <HelpIcon/>
            </a>
        </div>
    )
}

export default TopBar
