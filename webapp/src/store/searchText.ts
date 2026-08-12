import type {StoreContext} from './context'

import type {RootState} from './index'

export type SearchTextState = {value: string}

export const initialSearchTextState = (): SearchTextState => ({value: ''})

export const createSearchTextActions = ({setState}: StoreContext) => ({
    setSearchText(text: string) {
        setState('searchText', 'value', text)
    },
})

export function getSearchText(state: RootState): string {
    return state.searchText.value
}
