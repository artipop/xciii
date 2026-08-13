import {fetchStoredLanguage, getCurrentLanguage, storeLanguage as i18nStoreLanguage} from '../i18n'

import type {StoreContext} from './context'

import type {RootState} from './index'

export type LanguageState = {value: string}

export const initialLanguageState = (): LanguageState => ({value: 'en'})

export const createLanguageActions = ({setState}: StoreContext) => ({

    // The synchronous guess first — localStorage, else the OS language — so
    // the page paints in the right language at once; then the install's own
    // answer, which is the one that survives restarts (ui-settings.json on
    // the Go side, because the desktop window's localStorage does not).
    async fetchLanguage() {
        setState('language', 'value', getCurrentLanguage())
        const stored = await fetchStoredLanguage()
        if (stored) {
            setState('language', 'value', stored)
        }
    },
    storeLanguage(lang: string) {
        i18nStoreLanguage(lang)
        setState('language', 'value', lang)
    },
})

export function getLanguage(state: RootState): string {
    return state.language.value
}
