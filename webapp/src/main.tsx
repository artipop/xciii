// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render} from 'solid-js/web'
import {init as initEmojiMart} from 'emoji-mart'
import emojiMartData from '@emoji-mart/data'

import App from './app'
import {initThemes} from './theme'
import {importNativeAppSettings} from './nativeApp'

import {IUser} from './user'
import {getMe} from './store/users'
import {useAppSelector} from './store/hooks'
import {AppStoreProvider, createAppStore} from './store'
import mutator from './mutator'

import '@mattermost/compass-icons/css/compass-icons.css'

import './styles/variables.scss'
import './styles/main.scss'
import './styles/labels.scss'
import './styles/_markdown.scss'

import WithWebSockets from './components/withWebSockets'

// emoji-mart 5 persists skin/frequently-used itself, under the same `emoji-mart.*`
// localStorage keys UserSettings used to route for it, so it needs no handlers --
// only its data set, which v5 no longer bundles.
initEmojiMart({data: emojiMartData})
importNativeAppSettings()

initThemes()

const MainApp = () => {
    const me = useAppSelector<IUser|null>(getMe)

    return (
        <WithWebSockets userId={me()?.id}>
            <App/>
        </WithWebSockets>
    )
}

// The store is created here, not in a module singleton, and everything that
// writes to it from outside the component tree — the Mutator — gets its
// actions handed over before the first render.
const store = createAppStore()
mutator.setActions(store.actions)

render(() => (
    <AppStoreProvider store={store}>
        <MainApp/>
    </AppStoreProvider>
), document.getElementById('xciii-app')!)
