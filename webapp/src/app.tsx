// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Component, createEffect, onMount} from 'solid-js'

import TelemetryClient from './telemetry/telemetryClient'

import {getMessages} from './i18n'
import {IntlProvider} from './intl'
import {SortableProvider} from './hooks/sortable'
import {FlashMessages} from './components/flashMessages'
import NewVersionBanner from './components/newVersionBanner'
import {getMe} from './store/users'
import {getLanguage} from './store/language'
import {useAppSelector, useAppStore} from './store/hooks'
import AppRouter from './router'

import {IUser} from './user'

const App: Component = () => {
    const {actions} = useAppStore()
    const language = useAppSelector<string>(getLanguage)
    const me = useAppSelector<IUser|null>(getMe)

    onMount(() => {
        actions.language.fetchLanguage()
        actions.users.fetchMe()
        actions.clientConfig.fetchClientConfig()
    })

    createEffect(() => {
        const user = me()
        if (user) {
            TelemetryClient.setUser(user)
        }
    })

    return (
        <IntlProvider
            locale={language().split(/[_]/)[0]}
            messages={getMessages(language())}
        >
            <SortableProvider>
                <FlashMessages milliseconds={2000}/>
                <div id='frame'>
                    <div id='main'>
                        <NewVersionBanner/>
                        <AppRouter/>
                    </div>
                </div>
            </SortableProvider>
        </IntlProvider>
    )
}

export default App
