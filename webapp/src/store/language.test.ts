// The language lives with the install, not with the browser: the desktop
// window opens on a loopback origin whose localStorage forgets on every
// launch, so ui-settings.json on the Go side is the memory and localStorage
// is only the boot-time guess.

import {UserSettings} from '../userSettings'

import {getLanguage} from './language'

import {createAppStore} from './index'

const anyWindow = window as any

describe('store/language', () => {
    afterEach(() => {
        delete anyWindow.go
        UserSettings.language = null
        vi.clearAllMocks()
    })

    test('the language the install kept wins over the boot guess', async () => {
        anyWindow.go = {main: {App: {GetUILanguage: vi.fn().mockResolvedValue('de')}}}

        const {state, actions} = createAppStore({client: {} as any})
        await actions.language.fetchLanguage()

        expect(getLanguage(state)).toBe('de')

        // …and it warms the cache, so the next boot's synchronous guess is
        // already right.
        expect(UserSettings.language).toBe('de')
    })

    test('picking a language tells the install, not only the browser', async () => {
        const set = vi.fn().mockResolvedValue(undefined)
        anyWindow.go = {main: {App: {SetUILanguage: set}}}

        const {state, actions} = createAppStore({client: {} as any})
        actions.language.storeLanguage('ru')

        expect(getLanguage(state)).toBe('ru')
        expect(UserSettings.language).toBe('ru')
        expect(set).toHaveBeenCalledWith('ru')
    })

    // The same bundle runs in a plain browser and as a Mattermost plugin,
    // where there is no Go side at all: localStorage stays the whole memory.
    test('falls back to the browser when there are no bindings', async () => {
        UserSettings.language = 'sv'

        const {state, actions} = createAppStore({client: {} as any})
        await actions.language.fetchLanguage()

        expect(getLanguage(state)).toBe('sv')
    })
})
