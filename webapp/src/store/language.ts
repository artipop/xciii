import {getCurrentLanguage, storeLanguage as i18nStoreLanguage} from '../i18n'

import type {StoreContext} from './context'

import type {RootState} from './index'

export type LanguageState = {value: string}

export const initialLanguageState = (): LanguageState => ({value: 'en'})

export const createLanguageActions = ({setState}: StoreContext) => ({
    fetchLanguage() {
        setState('language', 'value', getCurrentLanguage())
    },
    storeLanguage(lang: string) {
        i18nStoreLanguage(lang)
        setState('language', 'value', lang)
    },
})

export function getLanguage(state: RootState): string {
    return state.language.value
}
