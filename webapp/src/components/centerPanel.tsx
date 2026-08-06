// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Match, Show, Switch, createEffect, createMemo, createSignal, onMount} from 'solid-js'

import {useIntl} from '../intl'

import {useHotkeys} from '../hooks/hotkeys'
import {ClientConfig} from '../config/clientConfig'

import {Block} from '../blocks/block'
import {BlockIcons} from '../blockIcons'
import {Card, createCard} from '../blocks/card'
import {Board, IPropertyTemplate, BoardGroup} from '../blocks/board'
import {BoardView} from '../blocks/boardView'
import {CardFilter} from '../cardFilter'
import mutator from '../mutator'
import {Utils} from '../utils'
import {UserSettings} from '../userSettings'
import {getCurrentCard} from '../store/cards'
import {getCardLimitTimestamp} from '../store/limits'
import {getVisibleAndHiddenGroups} from '../boardUtils'
import TelemetryClient, {TelemetryCategory, TelemetryActions} from '../telemetry/telemetryClient'

import {getClientConfig} from '../store/clientConfig'

import './centerPanel.scss'

import {useAppSelector, useAppStore} from '../store/hooks'

import {
    getMe,
    getBoardUsers,
    getOnboardingTourCategory,
    getOnboardingTourStarted,
    getOnboardingTourStep,
} from '../store/users'

import {UserConfigPatch} from '../user'

import octoClient from '../octoClient'

import ShareBoardButton from './shareBoard/shareBoardButton'
import ShareBoardLoginButton from './shareBoard/shareBoardLoginButton'

import CardDialog from './cardDialog'
import RootPortal from './rootPortal'
import TopBar from './topBar'
import ViewHeader from './viewHeader/viewHeader'
import ViewTitle from './viewTitle'
import Kanban from './kanban/kanban'

import Table from './table/table'

import CalendarFullView from './calendar/fullCalendar'

import CardLimitNotification from './cardLimitNotification'

import Gallery from './gallery/gallery'
import {BoardTourSteps, FINISHED, TOUR_BOARD, TOUR_CARD} from './onboardingTour'
import ShareBoardTourStep from './onboardingTour/shareBoard/shareBoard'
import BoardSetupWizard from './acp/boardSetupWizard'
import {createSetupPlan, markSetupOffered, setupNeeded, shouldOfferSetup} from './acp/boardSetup'

type Props = {
    clientConfig?: ClientConfig
    board: Board
    cards: Card[]
    activeView: BoardView
    views: BoardView[]
    groupByProperty?: IPropertyTemplate
    dateDisplayProperty?: IPropertyTemplate
    readonly: boolean
    shownCardId?: string
    showCard: (cardId?: string) => void
    hiddenCardsCount: number
}

const CenterPanel = (props: Props) => {
    const intl = useIntl()
    const [selectedCardIds, setSelectedCardIds] = createSignal<string[]>([])

    // A board that runs something on a machine that cannot run it yet. The
    // wizard opens by itself once per board — after that the header says so
    // quietly and waits to be asked, because a modal on every launch is how a
    // thing you meant to get round to becomes a thing you dismiss on reflex.
    const [showSetup, setShowSetup] = createSignal(false)
    const [plan, refreshPlan] = createSetupPlan(() => props.board)
    const setupPending = () => setupNeeded(plan())
    createEffect(() => {
        const board = props.board
        if (shouldOfferSetup(plan())) {
            // Marked as offered when it opens, not when it closes: closing the
            // window, quitting mid-way or never touching it again all mean the
            // same thing — it has had its turn.
            markSetupOffered(board.id).catch(() => undefined)
            setShowSetup(true)
        }
    })
    const [cardIdToFocusOnRender, setCardIdToFocusOnRender] = createSignal('')
    const [showHiddenCardCountNotification, setShowHiddenCardCountNotification] = createSignal(false)

    const onboardingTourStarted = useAppSelector(getOnboardingTourStarted)
    const onboardingTourCategory = useAppSelector(getOnboardingTourCategory)
    const onboardingTourStep = useAppSelector(getOnboardingTourStep)
    const cardLimitTimestamp = useAppSelector(getCardLimitTimestamp)
    const me = useAppSelector(getMe)
    const currentCard = useAppSelector(getCurrentCard)
    const boardUsers = useAppSelector(getBoardUsers)
    const {actions} = useAppStore()

    const clientConfig = useAppSelector<ClientConfig>(getClientConfig)

    onMount(() => {
        TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.ViewBoard, {board: props.board.id, view: props.activeView.id, viewType: props.activeView.fields.viewType})
    })

    useHotkeys('esc', (e: KeyboardEvent) => {
        if (e.target !== document.body || props.readonly) {
            return
        }
        if (selectedCardIds().length > 0) {
            setSelectedCardIds([])
            e.stopPropagation()
        }
    })

    useHotkeys('ctrl+d', (e: KeyboardEvent) => {
        if (e.target !== document.body || props.readonly) {
            return
        }

        if (selectedCardIds().length > 0) {
            // CTRL+D: Duplicate selected cards
            const {board} = props
            if (selectedCardIds().length < 1) {
                return
            }

            mutator.performAsUndoGroup(async () => {
                for (const cardId of selectedCardIds()) {
                    const card = props.cards.find((o) => o.id === cardId)
                    if (card) {
                        mutator.duplicateCard(cardId, board.id)
                    } else {
                        Utils.assertFailure(`Selected card not found: ${cardId}`)
                    }
                }
            })

            setSelectedCardIds([])
            e.stopPropagation()
            e.preventDefault()
        }
    })

    useHotkeys('del,backspace', (e: KeyboardEvent) => {
        if (e.target !== document.body || props.readonly) {
            return
        }

        if (selectedCardIds().length > 0) {
            // Backspace or Del: Delete selected cards
            if (selectedCardIds().length < 1) {
                return
            }

            mutator.performAsUndoGroup(async () => {
                for (const cardId of selectedCardIds()) {
                    const card = props.cards.find((o) => o.id === cardId)
                    if (card) {
                        mutator.deleteBlock(card, selectedCardIds().length > 1 ? `delete ${selectedCardIds().length} cards` : 'delete card')
                    } else {
                        Utils.assertFailure(`Selected card not found: ${cardId}`)
                    }
                }
            })

            setSelectedCardIds([])
            e.stopPropagation()
        }
    })

    const showCard = (cardId?: string) => {
        if (selectedCardIds().length > 0) {
            setSelectedCardIds([])
        }
        props.showCard(cardId)
    }

    const addCard = async (groupByOptionId?: string, show = false, properties: Record<string, string> = {}): Promise<void> => {
        const {activeView, board, groupByProperty} = props

        const card = createCard()

        TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.CreateCard, {board: board.id, view: activeView.id, card: card.id})

        card.parentId = board.id
        card.boardId = board.id
        const propertiesThatMeetFilters = CardFilter.propertiesThatMeetFilterGroup(activeView.fields.filter, board.cardProperties)
        if ((activeView.fields.viewType === 'board' || activeView.fields.viewType === 'table') && groupByProperty) {
            if (groupByOptionId) {
                propertiesThatMeetFilters[groupByProperty.id] = groupByOptionId
            } else {
                delete propertiesThatMeetFilters[groupByProperty.id]
            }
        }
        card.fields.properties = {...card.fields.properties, ...properties, ...propertiesThatMeetFilters}
        if (!card.fields.icon && UserSettings.prefillRandomIcons) {
            card.fields.icon = BlockIcons.shared.randomIcon()
        }
        mutator.performAsUndoGroup(async () => {
            const newCard = await mutator.insertBlock(
                card.boardId,
                card,
                'add card',
                async (block: Block) => {
                    if (show) {
                        actions.cards.addCard(createCard(block))
                        actions.views.updateView({...activeView, fields: {...activeView.fields, cardOrder: [...activeView.fields.cardOrder, block.id]}})
                        showCard(block.id)
                    } else {
                        // Focus on this card's title inline on next render
                        setCardIdToFocusOnRender(block.id)
                        setTimeout(() => setCardIdToFocusOnRender(''), 300)
                    }
                },
                async () => {
                    showCard(undefined)
                },
            )
            actions.cards.showCardHiddenWarning(cardLimitTimestamp() > 0)
            await mutator.changeViewCardOrder(board.id, activeView.id, activeView.fields.cardOrder, [...activeView.fields.cardOrder, newCard.id], 'add-card')
        })
    }

    const addEmptyCardAndShow = () => addCard('', true)

    const shouldStartBoardsTour = (): boolean => {
        const isOnboardingBoard = props.board.title === 'Welcome to Boards!'
        const isTourStarted = onboardingTourStarted()
        const completedCardsTour = onboardingTourCategory() === TOUR_CARD && onboardingTourStep() === FINISHED.toString()
        const noCardOpen = !currentCard()

        return isOnboardingBoard && isTourStarted && completedCardsTour && noCardOpen
    }

    const prepareBoardsTour = async () => {
        if (!me()?.id) {
            return
        }

        const patch: UserConfigPatch = {
            updatedFields: {
                tourCategory: TOUR_BOARD,
                onboardingTourStep: BoardTourSteps.ADD_VIEW.toString(),
            },
        }

        const patchedProps = await octoClient.patchUserConfig(me()!.id, patch)
        if (patchedProps) {
            actions.users.patchProps(patchedProps)
        }
    }

    const startBoardsTour = async () => {
        if (!shouldStartBoardsTour()) {
            return
        }

        await prepareBoardsTour()
    }

    createEffect(() => {
        startBoardsTour()
    })

    const backgroundClicked = (e: MouseEvent) => {
        if (selectedCardIds().length > 0) {
            setSelectedCardIds([])
            e.stopPropagation()
        }
    }

    const addCardFromTemplate = async (cardTemplateId: string, groupByOptionId?: string) => {
        const {activeView, board, groupByProperty} = props

        const propertiesThatMeetFilters = CardFilter.propertiesThatMeetFilterGroup(activeView.fields.filter, board.cardProperties)
        if ((activeView.fields.viewType === 'board' || activeView.fields.viewType === 'table') && groupByProperty) {
            if (groupByOptionId) {
                propertiesThatMeetFilters[groupByProperty.id] = groupByOptionId
            } else {
                delete propertiesThatMeetFilters[groupByProperty.id]
            }
        }

        mutator.performAsUndoGroup(async () => {
            const [, newCardId] = await mutator.duplicateCard(
                cardTemplateId,
                board.id,
                true,
                intl.formatMessage({id: 'Mutator.new-card-from-template', defaultMessage: 'new card from template'}),
                false,
                propertiesThatMeetFilters,
                async (cardId) => {
                    actions.views.updateView({...activeView, fields: {...activeView.fields, cardOrder: [...activeView.fields.cardOrder, cardId]}})
                    TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.CreateCardViaTemplate, {board: props.board.id, view: props.activeView.id, card: cardId, cardTemplateId})
                    showCard(cardId)
                },
                async () => {
                    showCard(undefined)
                },
            )
            await mutator.changeViewCardOrder(props.board.id, activeView.id, activeView.fields.cardOrder, [...activeView.fields.cardOrder, newCardId], 'add-card')
        })
    }

    const addCardTemplate = async () => {
        const {board, activeView} = props

        const cardTemplate = createCard()
        cardTemplate.fields.isTemplate = true
        cardTemplate.parentId = board.id
        cardTemplate.boardId = board.id

        await mutator.insertBlock(
            cardTemplate.boardId,
            cardTemplate,
            'add card template',
            async (newBlock: Block) => {
                const newTemplate = createCard(newBlock)
                TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.CreateCardTemplate, {board: board.id, view: activeView.id, card: newTemplate.id})
                actions.cards.addTemplate(newTemplate)
                showCard(newTemplate.id)
            }, async () => {
                showCard(undefined)
            },
        )
    }

    const editCardTemplate = (cardTemplateId: string) => {
        showCard(cardTemplateId)
    }

    const cardClicked = (e: MouseEvent, card: Card): void => {
        const {activeView, cards} = props

        if (e.shiftKey) {
            let newSelectedCardIds = [...selectedCardIds()]
            if (newSelectedCardIds.length > 0 && (e.metaKey || e.ctrlKey)) {
                // Cmd+Shift+Click: Extend the selection
                const orderedCardIds = cards.map((o) => o.id)
                const lastCardId = newSelectedCardIds[newSelectedCardIds.length - 1]
                const srcIndex = orderedCardIds.indexOf(lastCardId)
                const destIndex = orderedCardIds.indexOf(card.id)
                const newCardIds = (srcIndex < destIndex) ? orderedCardIds.slice(srcIndex, destIndex + 1) : orderedCardIds.slice(destIndex, srcIndex + 1)
                for (const newCardId of newCardIds) {
                    if (!newSelectedCardIds.includes(newCardId)) {
                        newSelectedCardIds.push(newCardId)
                    }
                }
                setSelectedCardIds(newSelectedCardIds)
            } else {
                // Shift+Click: add to selection
                if (newSelectedCardIds.includes(card.id)) {
                    newSelectedCardIds = selectedCardIds().filter((o) => o !== card.id)
                } else {
                    newSelectedCardIds.push(card.id)
                }
                setSelectedCardIds(newSelectedCardIds)
            }
        } else if (activeView.fields.viewType === 'board' || activeView.fields.viewType === 'gallery') {
            showCard(card.id)
        }

        e.stopPropagation()
    }

    const hiddenCardCountNotifyHandler = (show: boolean) => {
        setShowHiddenCardCountNotification(show)
    }

    const showShareButton = () => !props.readonly && me()?.id !== 'single-user'
    const showShareLoginButton = () => props.readonly && me()?.id !== 'single-user'

    const getUserDisplayName = (boardGroup: BoardGroup) => {
        const user = boardUsers()[boardGroup.option.id]
        if (user) {
            return Utils.getUserDisplayName(user, clientConfig().teammateNameDisplay)
        } else if (boardGroup.option.id === 'undefined') {
            return intl.formatMessage({
                id: 'centerPanel.undefined',
                defaultMessage: 'No {propertyName}',
            }, {propertyName: props.groupByProperty?.name})
        }
        return intl.formatMessage({id: 'centerPanel.unknown-user', defaultMessage: 'Unknown user'})
    }

    const groups = createMemo(() => {
        const {cards, activeView, groupByProperty} = props
        const {visible: vg, hidden: hg} = getVisibleAndHiddenGroups(cards, activeView.fields.visibleOptionIds, activeView.fields.hiddenOptionIds, groupByProperty)
        if (groupByProperty?.type === 'createdBy' || groupByProperty?.type === 'updatedBy' || groupByProperty?.type === 'person') {
            if (boardUsers()) {
                vg.forEach((value) => {
                    value.option.value = getUserDisplayName(value)
                })
                hg.forEach((value) => {
                    value.option.value = getUserDisplayName(value)
                })
            }
        }
        return {visible: vg, hidden: hg}
    })

    return (
        <div
            class='BoardComponent'
            onClick={backgroundClicked}
        >
            <Show when={showSetup()}>
                <RootPortal>
                    <BoardSetupWizard
                        board={props.board}
                        onClose={() => {
                            setShowSetup(false)
                            refreshPlan()
                        }}
                    />
                </RootPortal>
            </Show>
            <Show when={props.shownCardId}>
                <RootPortal>
                    <CardDialog
                        board={props.board}
                        activeView={props.activeView}
                        views={props.views}
                        cards={props.cards}
                        cardId={props.shownCardId!}
                        onClose={() => showCard(undefined)}
                        showCard={(cardId) => showCard(cardId)}
                        readonly={props.readonly}
                    />
                </RootPortal>
            </Show>

            <div class='top-head'>
                <TopBar/>
                <div class='mid-head'>
                    <ViewTitle
                        board={props.board}
                        readonly={props.readonly}
                    />
                    <Show when={setupPending()}>
                        {/* The board says it runs agents and the machine cannot
                            yet. Quiet, and always the way back into the wizard. */}
                        <button
                            class='CenterPanel__setupPending'
                            onClick={() => setShowSetup(true)}
                        >
                            {intl.formatMessage({
                                id: 'BoardSetup.pending',
                                defaultMessage: 'This board is not set up yet',
                            })}
                        </button>
                    </Show>
                    <div class='shareButtonWrapper'>
                        <Show when={showShareButton()}>
                            <ShareBoardButton
                                enableSharedBoards={props.clientConfig?.enablePublicSharedBoards || false}
                            />
                        </Show>
                        <Show when={showShareLoginButton()}>
                            <ShareBoardLoginButton/>
                        </Show>
                        <ShareBoardTourStep/>
                    </div>
                </div>
                <ViewHeader
                    board={props.board}
                    activeView={props.activeView}
                    cards={props.cards}
                    views={props.views}
                    groupByProperty={props.groupByProperty}
                    dateDisplayProperty={props.dateDisplayProperty}
                    addCard={addEmptyCardAndShow}
                    addCardFromTemplate={addCardFromTemplate}
                    addCardTemplate={addCardTemplate}
                    editCardTemplate={editCardTemplate}
                    readonly={props.readonly}
                />
            </div>

            <Switch>
                <Match when={props.activeView.fields.viewType === 'board'}>
                    <Kanban
                        board={props.board}
                        activeView={props.activeView}
                        cards={props.cards}
                        groupByProperty={props.groupByProperty}
                        visibleGroups={groups().visible}
                        hiddenGroups={groups().hidden}
                        selectedCardIds={selectedCardIds()}
                        readonly={props.readonly}
                        onCardClicked={cardClicked}
                        addCard={addCard}
                        addCardFromTemplate={addCardFromTemplate}
                        showCard={showCard}
                        hiddenCardsCount={props.hiddenCardsCount}
                        showHiddenCardCountNotification={hiddenCardCountNotifyHandler}
                    />
                </Match>
                <Match when={props.activeView.fields.viewType === 'table'}>
                    <Table
                        board={props.board}
                        activeView={props.activeView}
                        cards={props.cards}
                        groupByProperty={props.groupByProperty}
                        views={props.views}
                        visibleGroups={groups().visible}
                        selectedCardIds={selectedCardIds()}
                        readonly={props.readonly}
                        cardIdToFocusOnRender={cardIdToFocusOnRender()}
                        showCard={showCard}
                        addCard={addCard}
                        onCardClicked={cardClicked}
                        hiddenCardsCount={props.hiddenCardsCount}
                        showHiddenCardCountNotification={hiddenCardCountNotifyHandler}
                    />
                </Match>
                <Match when={props.activeView.fields.viewType === 'calendar'}>
                    <CalendarFullView
                        board={props.board}
                        cards={props.cards}
                        activeView={props.activeView}
                        readonly={props.readonly}
                        dateDisplayProperty={props.dateDisplayProperty}
                        showCard={showCard}
                        addCard={(properties: Record<string, string>) => {
                            addCard('', true, properties)
                        }}
                    />
                </Match>
                <Match when={props.activeView.fields.viewType === 'gallery'}>
                    <Gallery
                        board={props.board}
                        cards={props.cards}
                        activeView={props.activeView}
                        readonly={props.readonly}
                        onCardClicked={cardClicked}
                        selectedCardIds={selectedCardIds()}
                        addCard={(show) => addCard('', show)}
                        hiddenCardsCount={props.hiddenCardsCount}
                        showHiddenCardCountNotification={hiddenCardCountNotifyHandler}
                    />
                </Match>
            </Switch>
            <CardLimitNotification
                showHiddenCardNotification={showHiddenCardCountNotification()}
                hiddenCardCountNotificationHandler={hiddenCardCountNotifyHandler}
            />
        </div>
    )
}

export default CenterPanel
