// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
//
import type {JSX} from 'solid-js'

import HelpIcon from '../../widgets/icons/help'
import {IntlProvider} from '../../intl'
import {AppStoreProvider} from '../../store'
import {useAppSelector} from '../../store/hooks'
import {getLanguage} from '../../store/language'
import {getMessages} from '../../i18n'

import {Constants} from '../../constants'

import GlobalHeaderSettingsMenu from './globalHeaderSettingsMenu'

import './globalHeader.scss'

const HeaderItems = () => {
    const language = useAppSelector<string>(getLanguage)
    const helpUrl = 'https://www.focalboard.com/fwlink/doc-boards.html?v=' + Constants.versionString

    return (
        <IntlProvider
            locale={language().split(/[_]/)[0]}
            messages={getMessages(language())}
        >
            <div class='GlobalHeaderComponent'>
                <span class='spacer'/>
                <a
                    href={helpUrl}
                    target='_blank'
                    rel='noreferrer'
                    class='GlobalHeaderComponent__button help-button'
                >
                    <HelpIcon/>
                </a>
                <GlobalHeaderSettingsMenu/>
            </div>
        </IntlProvider>
    )
}

// The header a product embedding mounts on its own: it brings its own store
// instance the way it used to bring the Redux singleton. The history the host
// used to pass is gone — navigation runs through the app's router.
const GlobalHeader = (): JSX.Element => {
    return (
        <AppStoreProvider>
            <HeaderItems/>
        </AppStoreProvider>
    )
}

export default GlobalHeader
