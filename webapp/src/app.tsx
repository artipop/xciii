import {Component, createEffect, onMount} from 'solid-js'

import TelemetryClient from './telemetry/telemetryClient'

import {getMessages} from './i18n'
import {IntlProvider} from './intl'
import {SortableProvider} from './hooks/sortable'
import {FlashMessages} from './components/flashMessages'
import MoveCardToBoard from './components/moveCardToBoard'
import AttentionNotifications from './components/acp/attentionNotifications'
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

                {/* Outside the router: an agent waiting for an answer is worth
                    saying wherever in the app the person happens to be. */}
                <AttentionNotifications/>

                {/* Outside the router as well: the card menu that asks for it
                    unmounts as soon as it is clicked, so the dialog cannot
                    live inside the menu. */}
                <MoveCardToBoard/>
                <div id='frame'>
                    <div id='main'>
                        <AppRouter/>
                    </div>
                </div>
            </SortableProvider>
        </IntlProvider>
    )
}

export default App
