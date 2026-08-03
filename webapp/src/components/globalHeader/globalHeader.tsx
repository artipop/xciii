// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
//
import type {JSX} from 'solid-js'
import {Provider as ReduxProvider} from 'react-redux'
import {IntlProvider} from '../../intl'
import {History} from 'history'

import HelpIcon from '../../widgets/icons/help'
import store from '../../store'
import {useAppSelector} from '../../store/hooks'
import {getLanguage} from '../../store/language'
import {getMessages} from '../../i18n'

import {Constants} from '../../constants'

import GlobalHeaderSettingsMenu from './globalHeaderSettingsMenu'

import './globalHeader.scss'

type HeaderItemProps = {
    history: History<unknown>
}

const HeaderItems = (props: HeaderItemProps) => {
    const language = useAppSelector<string>(getLanguage)
    const helpUrl = 'https://www.focalboard.com/fwlink/doc-boards.html?v=' + Constants.versionString

    return (
        <IntlProvider
            locale={language.split(/[_]/)[0]}
            messages={getMessages(language)}
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
                <GlobalHeaderSettingsMenu history={props.history}/>
            </div>
        </IntlProvider>
    )
}

type Props = {
    history: History<unknown>
}

const GlobalHeader = (props: Props): JSX.Element => {
    return (
        <ReduxProvider store={store}>
            <HeaderItems history={props.history}/>
        </ReduxProvider>
    )
}

export default GlobalHeader
