// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For} from 'solid-js'
import type {JSX} from 'solid-js'

import {Card} from '../../blocks/card'
import {Board} from '../../blocks/board'
import {BoardView} from '../../blocks/boardView'

import './table.scss'

import TableRow from './tableRow'

type Props = {
    board: Board
    activeView: BoardView
    cards: readonly Card[]
    selectedCardIds: string[]
    readonly: boolean
    cardIdToFocusOnRender: string
    showCard: (cardId?: string) => void
    addCard: (groupByOptionId?: string) => Promise<void>
    onCardClicked: (e: MouseEvent, card: Card) => void
    onDrop: (srcCard: Card, dstCard: Card) => void
}

const TableRows = (props: Props): JSX.Element => {
    const onClickRow = (e: MouseEvent, card: Card) => {
        props.onCardClicked(e, card)
    }

    return (
        <For each={props.cards as Card[]}>
            {(card, idx) => (
                <TableRow
                    board={props.board}
                    columnWidths={props.activeView.fields.columnWidths}
                    isManualSort={props.activeView.fields.sortOptions.length === 0}
                    groupById={props.activeView.fields.groupById}
                    visiblePropertyIds={props.activeView.fields.visiblePropertyIds}
                    collapsedOptionIds={props.activeView.fields.collapsedOptionIds}
                    card={card}
                    addCard={props.addCard}
                    isSelected={props.selectedCardIds.includes(card.id)}
                    focusOnMount={props.cardIdToFocusOnRender === card.id}
                    isLastCard={idx() === (props.cards.length - 1)}
                    onClick={onClickRow}
                    showCard={props.showCard}
                    readonly={props.readonly}
                    onDrop={props.onDrop}
                />
            )}
        </For>
    )
}

export default TableRows
