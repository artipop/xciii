// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, Match, Switch, createEffect, createSignal, onCleanup} from 'solid-js'
import type {JSX} from 'solid-js'

import './searchDialog.scss'
import debounce from 'lodash/debounce'

import {FormattedMessage, useIntl} from '../../intl'

import Dialog from '../dialog'
import {Utils} from '../../utils'
import Search from '../../widgets/icons/search'
import {Constants} from '../../constants'

type Props = {
    onClose: () => void
    title: string
    subTitle?: string | JSX.Element
    searchHandler: (query: string) => Promise<JSX.Element[]>
    initialData?: JSX.Element[]
    selected: number
    setSelected: (n: number) => void
}

export const EmptySearch = (): JSX.Element => (
    <div class='noResults introScreen'>
        <div class='iconWrapper'>
            <Search/>
        </div>
        <h4 class='text-heading4'>
            <FormattedMessage
                id='FindBoardsDialog.IntroText'
                defaultMessage='Search for boards'
            />
        </h4>
    </div>
)

export const EmptyResults = (props: {query: string}): JSX.Element => (
    <div class='noResults'>
        <div class='iconWrapper'>
            <Search/>
        </div>
        <h4 class='text-heading4'>
            <FormattedMessage
                id='FindBoardsDialog.NoResultsFor'
                defaultMessage='No results for "{searchQuery}"'
                values={{
                    searchQuery: props.query,
                }}
            />
        </h4>
        <span>
            <FormattedMessage
                id='FindBoardsDialog.NoResultsSubtext'
                defaultMessage='Check the spelling or try another search.'
            />
        </span>
    </div>
)

const SearchDialog = (props: Props): JSX.Element => {
    const intl = useIntl()
    const [results, setResults] = createSignal<JSX.Element[]>(props.initialData || [])
    const [isSearching, setIsSearching] = createSignal<boolean>(false)
    const [searchQuery, setSearchQuery] = createSignal<string>('')

    const searchHandler = async (query: string): Promise<void> => {
        setIsSearching(true)
        props.setSelected(-1)
        setSearchQuery(query)
        const searchResults = await props.searchHandler(query)
        setResults(searchResults)
        setIsSearching(false)
    }

    const debouncedSearchHandler = debounce(searchHandler, 200)

    const emptyResult = () => results().length === 0 && !isSearching() && searchQuery()

    const handleUpDownKeyPress = (e: KeyboardEvent) => {
        if (Utils.isKeyPressed(e, Constants.keyCodes.DOWN)) {
            e.preventDefault()
            if (results().length > 0) {
                props.setSelected(((props.selected + 1) < results().length) ? (props.selected + 1) : props.selected)
            }
        }

        if (Utils.isKeyPressed(e, Constants.keyCodes.UP)) {
            e.preventDefault()
            if (results().length > 0) {
                props.setSelected(((props.selected - 1) > -1) ? (props.selected - 1) : props.selected)
            }
        }
    }

    createEffect(() => {
        document.addEventListener('keydown', handleUpDownKeyPress)

        // cleanup function
        onCleanup(() => {
            document.removeEventListener('keydown', handleUpDownKeyPress)
        })
    })

    return (
        <Dialog
            title={<div>{props.title}</div>}
            subtitle={<div>{props.subTitle}</div>}
            class='BoardSwitcherDialog'
            onClose={props.onClose}
        >
            <div class='BoardSwitcherDialogBody'>
                <div class='head'>
                    <div class='queryWrapper'>
                        <Search/>
                        <input
                            class='searchQuery'
                            placeholder={intl.formatMessage({id: 'SearchDialog.placeholder', defaultMessage: 'Search for boards'})}
                            type='text'
                            onInput={(e) => debouncedSearchHandler(e.target.value)}
                            autofocus={true}
                            maxLength={100}
                        />
                    </div>
                </div>
                <div class='searchResults'>
                    <Switch>
                        {/*When there are results to show*/}
                        <Match when={searchQuery() && results().length > 0}>
                            <For each={results()}>
                                {(result) => (
                                    <div
                                        class='searchResult'
                                        tabIndex={-1}
                                    >
                                        {result}
                                    </div>
                                )}
                            </For>
                        </Match>

                        {/*when user searched for something and there were no results*/}
                        <Match when={emptyResult()}>
                            <EmptyResults query={searchQuery()}/>
                        </Match>

                        {/*default state, when user didn't search for anything. This is the initial screen*/}
                        <Match when={!emptyResult() && !searchQuery()}>
                            <EmptySearch/>
                        </Match>
                    </Switch>
                </div>
            </div>
        </Dialog>
    )
}

export default SearchDialog
