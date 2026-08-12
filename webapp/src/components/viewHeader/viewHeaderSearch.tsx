import {createEffect, createSignal, onCleanup} from 'solid-js'
import type {JSX} from 'solid-js'
import debounce from 'lodash/debounce'

import {useIntl} from '../../intl'

import {useHotkeys} from '../../hooks/hotkeys'
import {useRouteMatch} from '../../hooks/routerMatch'
import CompassIcon from '../../widgets/icons/compassIcon'
import Editable, {Focusable} from '../../widgets/editable'

import {useAppSelector, useAppStore} from '../../store/hooks'
import {getSearchText} from '../../store/searchText'

const ViewHeaderSearch = (): JSX.Element => {
    const searchText = useAppSelector<string>(getSearchText)
    const {actions} = useAppStore()
    const intl = useIntl()
    const match = useRouteMatch()

    let searchFieldRef: Focusable | undefined
    const [searchValue, setSearchValue] = createSignal(searchText())
    const [currentView, setCurrentView] = createSignal(match().params.viewId)

    const dispatchSearchText = (value: string) => {
        actions.searchText.setSearchText(value)
    }

    const debouncedDispatchSearchText = debounce(dispatchSearchText, 200)

    createEffect(() => {
        const viewId = match().params.viewId
        if (viewId !== currentView()) {
            setCurrentView(viewId)
            setSearchValue('')

            // Previously debounced calls to change the search text should be cancelled
            // to avoid resetting the search text.
            debouncedDispatchSearchText.cancel()
            dispatchSearchText('')
        }
    })

    onCleanup(() => {
        debouncedDispatchSearchText.cancel()
    })

    useHotkeys('ctrl+shift+f,cmd+shift+f', () => {
        searchFieldRef?.focus(true)
    })

    return (
        <div class='board-search-field'>
            <CompassIcon
                icon='magnify'
                class='board-search-icon'
            />
            <Editable
                ref={(f) => {
                    searchFieldRef = f
                }}
                value={searchValue()}
                placeholderText={intl.formatMessage({id: 'ViewHeader.search-text', defaultMessage: 'Search cards'})}
                onChange={(value) => {
                    setSearchValue(value)
                    debouncedDispatchSearchText(value)
                }}
                onCancel={() => {
                    setSearchValue('')
                    debouncedDispatchSearchText('')
                }}
                onSave={() => {
                    debouncedDispatchSearchText(searchValue())
                }}
            />
        </div>
    )
}

export default ViewHeaderSearch
