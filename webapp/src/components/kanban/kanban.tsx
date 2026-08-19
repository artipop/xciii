import {For, Show, createEffect, createSignal} from 'solid-js'

import {FormattedMessage, useIntl} from '../../intl'

import {useAppSelector} from '../../store/hooks'

import {Position} from '../cardDetail/cardDetailContents'

import {Board, IPropertyOption, IPropertyTemplate, BoardGroup} from '../../blocks/board'
import {Card} from '../../blocks/card'
import {BoardView} from '../../blocks/boardView'
import mutator from '../../mutator'
import {Utils, IDType} from '../../utils'
import Button from '../../widgets/buttons/button'
import {Constants, Permission} from '../../constants'

import {dragAndDropRearrange} from '../cardDetail/cardDetailContentsUtility'

import {getCurrentBoardTemplates} from '../../store/cards'
import BoardPermissionGate from '../permissions/boardPermissionGate'

import {invalidateBoardColumns} from '../acp/columnBadge'
import AutomationDialog from '../acp/automationDialog'

import KanbanCard from './kanbanCard'
import KanbanColumn from './kanbanColumn'
import KanbanColumnHeader from './kanbanColumnHeader'
import KanbanHiddenColumnItem from './kanbanHiddenColumnItem'

import './kanban.scss'

type Props = {
    board: Board
    activeView: BoardView
    cards: Card[]
    groupByProperty?: IPropertyTemplate
    visibleGroups: BoardGroup[]
    hiddenGroups: BoardGroup[]
    selectedCardIds: string[]
    readonly: boolean
    onCardClicked: (e: MouseEvent, card: Card) => void
    addCard: (groupByOptionId?: string, show?: boolean) => Promise<void>
    addCardFromTemplate: (cardTemplateId: string, groupByOptionId?: string) => void
    showCard: (cardId?: string) => void
}

const Kanban = (props: Props) => {
    // The column whose automation is open. Held here rather than in the header
    // because a board edit made from inside the dialog re-creates the headers.
    const [settingsColumn, setSettingsColumn] = createSignal('')
    const intl = useIntl()
    const cardTemplates = useAppSelector(getCurrentBoardTemplates)
    const [defaultTemplateID, setDefaultTemplateID] = createSignal<string>()

    createEffect(() => {
        if (props.activeView.fields.defaultTemplateId) {
            if (cardTemplates().find((ct) => ct.id === props.activeView.fields.defaultTemplateId)) {
                setDefaultTemplateID(props.activeView.fields.defaultTemplateId)
            }
        }
    })

    const visiblePropertyTemplates = () => {
        return props.board.cardProperties.filter(
            (template: IPropertyTemplate) => props.activeView.fields.visiblePropertyIds.includes(template.id),
        )
    }
    const isManualSort = () => props.activeView.fields.sortOptions.length === 0
    const visibleBadges = () => props.activeView.fields.visiblePropertyIds.includes(Constants.badgesColumnId)

    const propertyNameChanged = async (option: IPropertyOption, text: string): Promise<void> => {
        await mutator.changePropertyOptionValue(props.board.id, props.board.cardProperties, props.groupByProperty!, option, text)
    }

    const addGroupClicked = async () => {
        Utils.log('onAddGroupClicked')

        const option: IPropertyOption = {
            id: Utils.createGuid(IDType.BlockID),
            value: 'New group',
            color: 'propColorDefault',
        }

        await mutator.insertPropertyOption(props.board.id, props.board.cardProperties, props.groupByProperty!, option, 'add group')
    }

    const orderAfterMoveToColumn = (cardIds: string[], columnId?: string): string[] => {
        let cardOrder = props.activeView.fields.cardOrder.slice()
        const columnGroup = props.visibleGroups.find((g) => g.option.id === columnId)
        const columnCards = columnGroup?.cards
        if (!columnCards || columnCards.length === 0) {
            return cardOrder
        }
        const lastCardId = columnCards[columnCards.length - 1].id
        const setOfIds = new Set(cardIds)
        cardOrder = cardOrder.filter((id) => !setOfIds.has(id))
        const lastCardIndex = cardOrder.indexOf(lastCardId)
        cardOrder.splice(lastCardIndex + 1, 0, ...cardIds)
        return cardOrder
    }

    const onDropToColumn = async (option: IPropertyOption, card?: Card, dstOption?: IPropertyOption) => {
        const {selectedCardIds, activeView, cards, groupByProperty, visibleGroups} = props
        const optionId = option ? option.id : undefined

        let draggedCardIds = selectedCardIds
        if (card) {
            draggedCardIds = Array.from(new Set(selectedCardIds).add(card.id))
        }

        if (draggedCardIds.length > 0) {
            await mutator.performAsUndoGroup(async () => {
                const cardsById: { [key: string]: Card } = cards.reduce((acc: { [key: string]: Card }, c: Card): { [key: string]: Card } => {
                    acc[c.id] = c
                    return acc
                }, {})
                const draggedCards: Card[] = draggedCardIds.map((o: string) => cardsById[o]).filter((c) => c)
                const description = draggedCards.length > 1 ? `drag ${draggedCards.length} cards` : 'drag card'
                const awaits = []
                for (const draggedCard of draggedCards) {
                    Utils.log(`ondrop. Card: ${draggedCard.title}, column: ${optionId}`)
                    const oldValue = draggedCard.fields.properties[groupByProperty!.id]
                    if (optionId !== oldValue) {
                        awaits.push(mutator.changePropertyValue(props.board.id, draggedCard, groupByProperty!.id, optionId, description))
                    }
                }
                const newOrder = orderAfterMoveToColumn(draggedCardIds, optionId)
                awaits.push(mutator.changeViewCardOrder(props.board.id, activeView.id, activeView.fields.cardOrder, newOrder, description))
                await Promise.all(awaits)
            })
        } else if (dstOption) {
            Utils.log(`ondrop. Header option: ${dstOption.value}, column: ${option?.value}`)

            const visibleOptionIds = visibleGroups.map((o) => o.option.id)
            const srcBlockX = visibleOptionIds.indexOf(option.id)
            const dstBlockX = visibleOptionIds.indexOf(dstOption.id)

            // Here aboveRow means to the left while belowRow means to the right
            const moveTo = (srcBlockX > dstBlockX ? 'aboveRow' : 'belowRow') as Position

            const visibleOptionIdsRearranged = dragAndDropRearrange({
                contentOrder: visibleOptionIds,
                srcBlockX,
                srcBlockY: -1,
                dstBlockX,
                dstBlockY: -1,
                srcBlockId: option.id,
                dstBlockId: dstOption.id,
                moveTo,
            }) as string[]

            await mutator.changeViewVisibleOptionIds(props.board.id, activeView.id, activeView.fields.visibleOptionIds, visibleOptionIdsRearranged)
        }
    }

    const onDropToCard = async (srcCard: Card, dstCard: Card) => {
        if (srcCard.id === dstCard.id || !props.groupByProperty) {
            return
        }
        Utils.log(`onDropToCard: ${dstCard.title}`)
        const {selectedCardIds, activeView, cards, groupByProperty} = props
        const optionId = dstCard.fields.properties[groupByProperty.id]

        const draggedCardIds = Array.from(new Set(selectedCardIds).add(srcCard.id))

        const description = draggedCardIds.length > 1 ? `drag ${draggedCardIds.length} cards` : 'drag card'

        // Update dstCard order
        const cardsById: { [key: string]: Card } = cards.reduce((acc: { [key: string]: Card }, c: Card): { [key: string]: Card } => {
            acc[c.id] = c
            return acc
        }, {})
        const draggedCards: Card[] = draggedCardIds.map((o: string) => cardsById[o]).filter((c) => c)
        let cardOrder = cards.map((o) => o.id)
        const isDraggingDown = cardOrder.indexOf(srcCard.id) <= cardOrder.indexOf(dstCard.id)
        cardOrder = cardOrder.filter((id) => !draggedCardIds.includes(id))
        let destIndex = cardOrder.indexOf(dstCard.id)
        if (srcCard.fields.properties[groupByProperty!.id] === optionId && isDraggingDown) {
            // If the cards are in the same column and dragging down, drop after the target dstCard
            destIndex += 1
        }
        cardOrder.splice(destIndex, 0, ...draggedCardIds)

        await mutator.performAsUndoGroup(async () => {
            // Update properties of dragged cards
            const awaits = []
            for (const draggedCard of draggedCards) {
                Utils.log(`draggedCard: ${draggedCard.title}, column: ${optionId}`)
                const oldOptionId = draggedCard.fields.properties[groupByProperty!.id]
                if (optionId !== oldOptionId) {
                    awaits.push(mutator.changePropertyValue(props.board.id, draggedCard, groupByProperty!.id, optionId, description))
                }
            }
            await Promise.all(awaits)
            await mutator.changeViewCardOrder(props.board.id, activeView.id, activeView.fields.cardOrder, cardOrder, description)
        })
    }

    const [showCalculationsMenu, setShowCalculationsMenu] = createSignal<Map<string, boolean>>(new Map<string, boolean>())
    const toggleOptions = (templateId: string, show: boolean) => {
        const newShowOptions = new Map<string, boolean>(showCalculationsMenu())
        newShowOptions.set(templateId, show)
        setShowCalculationsMenu(newShowOptions)
    }

    if (!props.groupByProperty) {
        Utils.assertFailure('Board views must have groupByProperty set')
        return <div/>
    }

    // Some columns are not places a card can be put. Grouped by who created it
    // — which is what «Входящие» is, one column per source — a column is a fact
    // about the past: dropping a card in another one would be asking the board
    // to have been written by somebody else. So the cards do not drag, and
    // there is no group to add.
    const columnsAreFacts = () => {
        const type = props.groupByProperty?.type
        return type === 'createdBy' || type === 'updatedBy'
    }

    return (
        <div class='Kanban'>
            <div
                class='octo-board-header'
                id='mainBoardHeader'
            >
                {/* Column headers */}

                <For each={props.visibleGroups}>
                    {(group) => (
                        <KanbanColumnHeader
                            group={group}
                            board={props.board}
                            activeView={props.activeView}
                            intl={intl}
                            groupByProperty={props.groupByProperty}
                            addCard={props.addCard}
                            readonly={props.readonly}
                            propertyNameChanged={propertyNameChanged}
                            onDropToColumn={onDropToColumn}
                            calculationMenuOpen={showCalculationsMenu().get(group.option.id) || false}
                            onCalculationMenuOpen={() => toggleOptions(group.option.id, true)}
                            onCalculationMenuClose={() => toggleOptions(group.option.id, false)}
                            onOpenSettings={setSettingsColumn}
                        />
                    )}
                </For>

                {/* Hidden column header */}

                <Show when={props.hiddenGroups.length > 0}>
                    <div class='octo-board-header-cell narrow'>
                        <FormattedMessage
                            id='BoardComponent.hidden-columns'
                            defaultMessage='Hidden columns'
                        />
                    </div>
                </Show>

                <Show when={!props.readonly && !columnsAreFacts()}>
                    <BoardPermissionGate permissions={[Permission.ManageBoardProperties]}>
                        <div class='octo-board-header-cell narrow'>
                            <Button
                                onClick={addGroupClicked}
                            >
                                <FormattedMessage
                                    id='BoardComponent.add-a-group'
                                    defaultMessage='+ Add a group'
                                />
                            </Button>
                        </div>
                    </BoardPermissionGate>
                </Show>
            </div>

            {/* Main content */}

            <div
                class='octo-board-body'
                id='mainBoardBody'
            >
                {/* Columns */}

                <For each={props.visibleGroups}>
                    {(group) => (
                        <KanbanColumn
                            accepts={!columnsAreFacts()}
                            onDrop={(card: Card) => onDropToColumn(group.option, card)}
                        >
                            <For each={group.cards}>
                                {(card, cardIndex) => (
                                    <KanbanCard
                                        card={card}
                                        index={cardIndex()}
                                        groupId={group.option.id || 'empty'}
                                        board={props.board}
                                        visiblePropertyTemplates={visiblePropertyTemplates()}
                                        visibleBadges={visibleBadges()}
                                        readonly={props.readonly}
                                        dragDisabled={columnsAreFacts()}
                                        isSelected={props.selectedCardIds.includes(card.id)}
                                        onClick={props.onCardClicked}
                                        onDrop={onDropToCard}
                                        showCard={props.showCard}
                                        isManualSort={isManualSort()}
                                    />
                                )}
                            </For>
                            <Show when={!props.readonly}>
                                <BoardPermissionGate permissions={[Permission.ManageBoardCards]}>
                                    <Button
                                        onClick={() => {
                                            if (defaultTemplateID()) {
                                                props.addCardFromTemplate(defaultTemplateID()!, group.option.id)
                                            } else {
                                                props.addCard(group.option.id, true)
                                            }
                                        }}
                                    >
                                        <FormattedMessage
                                            id='BoardComponent.new'
                                            defaultMessage='+ New'
                                        />
                                    </Button>
                                </BoardPermissionGate>
                            </Show>
                        </KanbanColumn>
                    )}
                </For>

                {/* Hidden columns */}

                <Show when={props.hiddenGroups.length > 0}>
                    <div class='octo-board-column narrow'>
                        <For each={props.hiddenGroups}>
                            {(group) => (
                                <KanbanHiddenColumnItem
                                    group={group}
                                    activeView={props.activeView}
                                    intl={intl}
                                    readonly={props.readonly}
                                    onDrop={(card: Card) => onDropToColumn(group.option, card)}
                                />
                            )}
                        </For>
                    </div>
                </Show>
            </div>

            <Show when={settingsColumn()}>
                <AutomationDialog
                    board={props.board}
                    focusColumnId={settingsColumn()}
                    onClose={() => setSettingsColumn('')}
                    onSaved={invalidateBoardColumns}
                />
            </Show>
        </div>
    )
}

export default Kanban
