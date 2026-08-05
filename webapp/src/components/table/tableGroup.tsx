// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Show} from 'solid-js'
import type {JSX} from 'solid-js'

import {Board, IPropertyOption, IPropertyTemplate, BoardGroup} from '../../blocks/board'
import {BoardView} from '../../blocks/boardView'
import {Card} from '../../blocks/card'

import {useDropZone} from '../../hooks/sortable'

import TableGroupHeaderRow from './tableGroupHeaderRow'
import TableRows from './tableRows'

type Props = {
    board: Board
    activeView: BoardView
    groupByProperty?: IPropertyTemplate
    group: BoardGroup
    readonly: boolean
    selectedCardIds: string[]
    cardIdToFocusOnRender: string
    hideGroup: (groupByOptionId: string) => void
    addCard: (groupByOptionId?: string) => Promise<void>
    showCard: (cardId?: string) => void
    propertyNameChanged: (option: IPropertyOption, text: string) => Promise<void>
    onCardClicked: (e: MouseEvent, card: Card) => void
    onDropToGroupHeader: (srcOption: IPropertyOption, dstOption?: IPropertyOption) => void
    onDropToCard: (srcCard: Card, dstCard: Card) => void
    onDropToGroup: (srcCard: Card, groupID: string, dstCardID: string) => void
}

const TableGroup = (props: Props): JSX.Element => {
    const groupId = () => props.group.option.id

    const [isOver, drop] = useDropZone<Card>('card', () => true, (card) => props.onDropToGroup(card, groupId(), ''))

    const classes = () => {
        let name = 'octo-table-group'
        if (isOver()) {
            name += ' dragover'
        }
        return name
    }

    return (
        <div
            ref={drop}
            class={classes()}
        >
            <TableGroupHeaderRow
                group={props.group}
                board={props.board}
                activeView={props.activeView}
                groupByProperty={props.groupByProperty}
                hideGroup={props.hideGroup}
                addCard={props.addCard}
                readonly={props.readonly}
                propertyNameChanged={props.propertyNameChanged}
                onDrop={props.onDropToGroupHeader}
            />

            <Show when={props.group.cards.length > 0}>
                <TableRows
                    board={props.board}
                    activeView={props.activeView}
                    cards={props.group.cards}
                    selectedCardIds={props.selectedCardIds}
                    readonly={props.readonly}
                    cardIdToFocusOnRender={props.cardIdToFocusOnRender}
                    showCard={props.showCard}
                    addCard={props.addCard}
                    onCardClicked={props.onCardClicked}
                    onDrop={props.onDropToCard}
                />
            </Show>
        </div>
    )
}

export default TableGroup
