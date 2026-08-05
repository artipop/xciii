// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, Show} from 'solid-js'
import type {JSX} from 'solid-js'

import {FormattedMessage} from '../../intl'

import {IPropertyTemplate} from '../../blocks/board'
import {BoardView, ISortOption} from '../../blocks/boardView'
import {Constants} from '../../constants'
import {Card} from '../../blocks/card'
import mutator from '../../mutator'
import Button from '../../widgets/buttons/button'
import Menu from '../../widgets/menu'
import MenuWrapper from '../../widgets/menuWrapper'
import SortDownIcon from '../../widgets/icons/sortDown'
import SortUpIcon from '../../widgets/icons/sortUp'

type Props = {
    properties: readonly IPropertyTemplate[]
    activeView: BoardView
    orderedCards: Card[]
}
const ViewHeaderSortMenu = (props: Props) => {
    const hasSort = () => props.activeView.fields.sortOptions?.length > 0
    const sortDisplayOptions = () => {
        const options = props.properties?.map((o) => ({id: o.id, name: o.name}))
        options?.unshift({id: Constants.titleColumnId, name: 'Name'})
        return options
    }

    const sortChanged = (propertyId: string) => {
        let newSortOptions: ISortOption[] = []
        if (props.activeView.fields.sortOptions && props.activeView.fields.sortOptions[0] && props.activeView.fields.sortOptions[0].propertyId === propertyId) {
            // Already sorting by name, so reverse it
            newSortOptions = [
                {propertyId, reversed: !props.activeView.fields.sortOptions[0].reversed},
            ]
        } else {
            newSortOptions = [
                {propertyId, reversed: false},
            ]
        }
        mutator.changeViewSortOptions(props.activeView.boardId, props.activeView.id, props.activeView.fields.sortOptions, newSortOptions)
    }

    const onManualSort = () => {
        // This sets the manual card order to the currently displayed order
        // Note: Perform this as a single update to change both properties correctly
        const newView = {...props.activeView, fields: {...props.activeView.fields}}
        newView.fields.cardOrder = props.orderedCards.map((o) => o.id || '') || []
        newView.fields.sortOptions = []
        mutator.updateBlock(props.activeView.boardId, newView, props.activeView, 'reorder')
    }

    const onRevertSort = () => {
        mutator.changeViewSortOptions(props.activeView.boardId, props.activeView.id, props.activeView.fields.sortOptions, [])
    }

    return (
        <MenuWrapper
            menu={
                <Menu>
                    <Show when={props.activeView.fields.sortOptions?.length > 0}>
                        <Menu.Text
                            id='manual'
                            name='Manual'
                            onClick={onManualSort}
                        />

                        <Menu.Text
                            id='revert'
                            name='Revert'
                            onClick={onRevertSort}
                        />

                        <Menu.Separator/>
                    </Show>

                    <For each={sortDisplayOptions()}>
                        {(option) => {
                            const rightIcon = (): JSX.Element | undefined => {
                                if (props.activeView.fields.sortOptions?.length > 0) {
                                    const sortOption = props.activeView.fields.sortOptions[0]
                                    if (sortOption.propertyId === option.id) {
                                        return sortOption.reversed ? <SortDownIcon/> : <SortUpIcon/>
                                    }
                                }
                                return undefined
                            }
                            return (
                                <Menu.Text
                                    id={option.id}
                                    name={option.name}
                                    rightIcon={rightIcon()}
                                    onClick={sortChanged}
                                />
                            )
                        }}
                    </For>
                </Menu>
            }
        >
            <Button active={hasSort()}>
                <FormattedMessage
                    id='ViewHeader.sort'
                    defaultMessage='Sort'
                />
            </Button>
        </MenuWrapper>
    )
}

export default ViewHeaderSortMenu
