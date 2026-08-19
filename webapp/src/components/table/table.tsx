import {For, Show} from 'solid-js'
import type {JSX} from 'solid-js'

import {FormattedMessage} from '../../intl'

import {IPropertyOption, IPropertyTemplate, Board, BoardGroup} from '../../blocks/board'
import {createBoardView, BoardView} from '../../blocks/boardView'
import {Card} from '../../blocks/card'
import {Constants, Permission} from '../../constants'
import mutator from '../../mutator'
import {Utils} from '../../utils'
import {useAppStore} from '../../store/hooks'
import {useHasCurrentBoardPermissions} from '../../hooks/permissions'

import BoardPermissionGate from '../permissions/boardPermissionGate'

import './table.scss'

import TableHeaders from './tableHeaders'
import TableRows from './tableRows'
import TableGroup from './tableGroup'
import CalculationRow from './calculation/calculationRow'
import {ColumnResizeProvider} from './tableColumnResizeContext'

type Props = {
    selectedCardIds: string[]
    board: Board
    cards: Card[]
    activeView: BoardView
    views: BoardView[]
    visibleGroups: BoardGroup[]
    groupByProperty?: IPropertyTemplate
    readonly: boolean
    cardIdToFocusOnRender: string
    showCard: (cardId?: string) => void
    addCard: (groupByOptionId?: string) => Promise<void>
    onCardClicked: (e: MouseEvent, card: Card) => void
}

const Table = (props: Props): JSX.Element => {
    const isManualSort = () => props.activeView.fields.sortOptions?.length === 0
    const canEditBoardProperties = useHasCurrentBoardPermissions([Permission.ManageBoardProperties])
    const canEditCards = useHasCurrentBoardPermissions([Permission.ManageBoardCards])
    const {actions} = useAppStore()

    const resizeColumn = async (columnId: string, width: number) => {
        const activeView = props.activeView
        const columnWidths = {...activeView.fields.columnWidths}
        const newWidth = Math.max(Constants.minColumnWidth, width)
        if (newWidth !== columnWidths[columnId]) {
            Utils.log(`Resize of column finished: prev=${columnWidths[columnId]}, new=${newWidth}`)

            columnWidths[columnId] = newWidth

            const newView = createBoardView(activeView)
            newView.fields.columnWidths = columnWidths
            try {
                actions.views.updateView(newView)
                await mutator.updateBlock(props.board.id, newView, activeView, 'resize column')
            } catch {
                actions.views.updateView(activeView)
            }
        }
    }

    const hideGroup = (groupById: string): void => {
        const activeView = props.activeView
        const index: number = activeView.fields.collapsedOptionIds.indexOf(groupById)
        const newValue: string[] = [...activeView.fields.collapsedOptionIds]
        if (index > -1) {
            newValue.splice(index, 1)
        } else if (groupById !== '') {
            newValue.push(groupById)
        }

        const newView = createBoardView(activeView)
        newView.fields.collapsedOptionIds = newValue
        mutator.performAsUndoGroup(async () => {
            await mutator.updateBlock(props.board.id, newView, activeView, 'hide group')
        })
    }

    const onDropToGroupHeader = async (option: IPropertyOption, dstOption?: IPropertyOption) => {
        if (dstOption) {
            Utils.log(`ondrop. Header target: ${dstOption.value}, source: ${option?.value}`)

            // Move option to new index
            const visibleOptionIds = props.visibleGroups.map((o) => o.option.id)
            const srcIndex = visibleOptionIds.indexOf(dstOption.id)
            const destIndex = visibleOptionIds.indexOf(option.id)

            visibleOptionIds.splice(srcIndex, 0, visibleOptionIds.splice(destIndex, 1)[0])
            Utils.log(`ondrop. updated visibleoptionids: ${visibleOptionIds}`)

            await mutator.changeViewVisibleOptionIds(props.board.id, props.activeView.id, props.activeView.fields.visibleOptionIds, visibleOptionIds)
        }
    }

    const onDropToCard = (srcCard: Card, dstCard: Card) => {
        Utils.log(`onDropToCard: ${dstCard.title}`)
        onDropToGroup(srcCard, dstCard.fields.properties[props.activeView.fields.groupById!] as string, dstCard.id)
    }

    const onDropToGroup = (srcCard: Card, groupID: string, dstCardID: string) => {
        Utils.log(`onDropToGroup: ${srcCard.title}`)
        const {selectedCardIds} = props
        const activeView = props.activeView
        const cards = props.cards

        const draggedCardIds = Array.from(new Set(selectedCardIds).add(srcCard.id))
        const description = draggedCardIds.length > 1 ? `drag ${draggedCardIds.length} cards` : 'drag card'

        if (activeView.fields.groupById !== undefined) {
            const cardsById: { [key: string]: Card } = cards.reduce((acc: { [key: string]: Card }, card: Card): { [key: string]: Card } => {
                acc[card.id] = card
                return acc
            }, {})
            const draggedCards: Card[] = draggedCardIds.map((o: string) => cardsById[o])

            mutator.performAsUndoGroup(async () => {
                // Update properties of dragged cards
                const awaits = []
                for (const draggedCard of draggedCards) {
                    Utils.log(`draggedCard: ${draggedCard.title}, column: ${draggedCard.fields.properties}`)
                    Utils.log(`droppedColumn:  ${groupID}`)
                    const oldOptionId = draggedCard.fields.properties[props.groupByProperty!.id]
                    Utils.log(`ondrop. oldValue: ${oldOptionId}`)

                    if (groupID !== oldOptionId) {
                        awaits.push(mutator.changePropertyValue(props.board.id, draggedCard, props.groupByProperty!.id, groupID, description))
                    }
                }
                await Promise.all(awaits)
            })
        }

        // Update dstCard order
        if (isManualSort()) {
            let cardOrder = Array.from(new Set([...activeView.fields.cardOrder, ...cards.map((o) => o.id)]))
            if (dstCardID) {
                const isDraggingDown = cardOrder.indexOf(srcCard.id) <= cardOrder.indexOf(dstCardID)
                cardOrder = cardOrder.filter((id) => !draggedCardIds.includes(id))
                let destIndex = cardOrder.indexOf(dstCardID)
                if (isDraggingDown) {
                    destIndex += 1
                }
                cardOrder.splice(destIndex, 0, ...draggedCardIds)
            } else {
                // Find index of first group item
                const firstCard = cards.find((card) => card.fields.properties[activeView.fields.groupById!] === groupID)
                if (firstCard) {
                    const destIndex = cardOrder.indexOf(firstCard.id)
                    cardOrder.splice(destIndex, 0, ...draggedCardIds)
                } else {
                    // if not found, this is the only item in group.
                    return
                }
            }

            mutator.performAsUndoGroup(async () => {
                await mutator.changeViewCardOrder(props.board.id, activeView.id, activeView.fields.cardOrder, cardOrder, description)
            })
        }
    }

    const propertyNameChanged = async (option: IPropertyOption, text: string): Promise<void> => {
        await mutator.changePropertyOptionValue(props.board.id, props.board.cardProperties, props.groupByProperty!, option, text)
    }

    return (
        <div class='Table'>
            <ColumnResizeProvider
                columnWidths={props.activeView.fields.columnWidths}
                onResizeColumn={resizeColumn}
            >
                <div class='octo-table-body'>
                    <TableHeaders
                        board={props.board}
                        cards={props.cards}
                        activeView={props.activeView}
                        views={props.views}
                        readonly={props.readonly || !canEditBoardProperties()}
                    />

                    {/* Table rows */}
                    <div class='table-row-container'>
                        <Show when={props.activeView.fields.groupById}>
                            <For each={props.visibleGroups}>
                                {(group) => (
                                    <TableGroup
                                        board={props.board}
                                        activeView={props.activeView}
                                        groupByProperty={props.groupByProperty}
                                        group={group}
                                        readonly={props.readonly || !canEditCards()}
                                        selectedCardIds={props.selectedCardIds}
                                        cardIdToFocusOnRender={props.cardIdToFocusOnRender}
                                        hideGroup={hideGroup}
                                        addCard={props.addCard}
                                        showCard={props.showCard}
                                        propertyNameChanged={propertyNameChanged}
                                        onCardClicked={props.onCardClicked}
                                        onDropToGroupHeader={onDropToGroupHeader}
                                        onDropToCard={onDropToCard}
                                        onDropToGroup={onDropToGroup}
                                    />
                                )}
                            </For>
                        </Show>

                        {/* No Grouping, Rows, one per card */}
                        <Show when={!props.activeView.fields.groupById}>
                            <TableRows
                                board={props.board}
                                activeView={props.activeView}
                                cards={props.cards}
                                selectedCardIds={props.selectedCardIds}
                                readonly={props.readonly || !canEditCards()}
                                cardIdToFocusOnRender={props.cardIdToFocusOnRender}
                                showCard={props.showCard}
                                addCard={props.addCard}
                                onCardClicked={props.onCardClicked}
                                onDrop={onDropToCard}
                            />
                        </Show>
                    </div>

                    {/* Add New row */}
                    <div class='octo-table-footer'>
                        <Show when={!props.readonly && !props.activeView.fields.groupById}>
                            <BoardPermissionGate permissions={[Permission.ManageBoardCards]}>
                                <div
                                    class='octo-table-cell'
                                    onClick={() => {
                                        props.addCard('')
                                    }}
                                >
                                    <FormattedMessage
                                        id='TableComponent.plus-new'
                                        defaultMessage='+ New'
                                    />
                                </div>
                            </BoardPermissionGate>
                        </Show>
                    </div>

                    <CalculationRow
                        board={props.board}
                        cards={props.cards}
                        activeView={props.activeView}
                        readonly={props.readonly || !canEditBoardProperties()}
                    />
                </div>
            </ColumnResizeProvider>
        </div>
    )
}

export default Table
