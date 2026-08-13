import {render} from 'solid-js/web'
import {init as initEmojiMart} from 'emoji-mart'
import emojiMartData from '@emoji-mart/data'

import App from './app'
import {installPolyfills} from './polyfills'
import {initThemes} from './theme'
import {importNativeAppSettings} from './nativeApp'
import {hydrateUserSettings} from './userSettings'

import {IUser} from './user'
import {getMe} from './store/users'
import {useAppSelector} from './store/hooks'
import {AppStoreProvider, createAppStore} from './store'
import mutator from './mutator'

import '@mattermost/compass-icons/css/compass-icons.css'

// The product's two typefaces, self-hosted: the desktop build has no network,
// and the page must look the same on every platform. Both are variable, so each
// carries every weight the design uses in one file per subset, and the browser
// fetches only the subsets the page needs.
//
// Cyrillic is what narrowed the field to these two. The interface is Russian,
// and most condensed grotesques on offer — IBM Plex Sans Condensed among them —
// ship only `cyrillic-ext`, which does not cover А–Я.
import '@fontsource-variable/roboto-condensed'
import '@fontsource-variable/jetbrains-mono'

import './styles/variables.scss'
import './styles/main.scss'
import './styles/labels.scss'
import './styles/_markdown.scss'

import WithWebSockets from './components/withWebSockets'

// emoji-mart 5 persists skin/frequently-used itself, under the same `emoji-mart.*`
// localStorage keys UserSettings used to route for it, so it needs no handlers --
// only its data set, which v5 no longer bundles.
// Before anything else: what a library calls unconditionally and this webview
// does not have (polyfills.ts says which, and what it costs when it is missing).
installPolyfills()

initEmojiMart({data: emojiMartData})
importNativeAppSettings()

const MainApp = () => {
    const me = useAppSelector<IUser|null>(getMe)

    return (
        <WithWebSockets userId={me()?.id}>
            <App/>
        </WithWebSockets>
    )
}

// The first paint waits for the install's own memory: the desktop window's
// localStorage is empty on every launch (a loopback origin with a random
// port), and the theme and the language have to be right when the page
// appears, not corrected after it. One binding call over loopback; a build
// with no Go side resolves it at once.
async function boot() {
    await hydrateUserSettings()
    initThemes()

    // The store is created here, not in a module singleton, and everything
    // that writes to it from outside the component tree — the Mutator — gets
    // its actions handed over before the first render.
    const store = createAppStore()
    mutator.setActions(store.actions)

    render(() => (
        <AppStoreProvider store={store}>
            <MainApp/>
        </AppStoreProvider>
    ), document.getElementById('xciii-app')!)
}

boot()
