// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show, createEffect, createSignal, onMount} from 'solid-js'

import {FormattedMessage, useIntl} from '../../intl'

import ViewMenu from '../../components/viewMenu'
import mutator from '../../mutator'
import {Board, IPropertyTemplate} from '../../blocks/board'
import {BoardView} from '../../blocks/boardView'
import {Card} from '../../blocks/card'
import Button from '../../widgets/buttons/button'
import IconButton from '../../widgets/buttons/iconButton'
import DropdownIcon from '../../widgets/icons/dropdown'
import MenuWrapper from '../../widgets/menuWrapper'
import Editable from '../../widgets/editable'

import ModalWrapper from '../modalWrapper'

import {useAppSelector} from '../../store/hooks'
import {Permission} from '../../constants'
import {useHasCurrentBoardPermissions} from '../../hooks/permissions'
import {
    getOnboardingTourCategory,
    getOnboardingTourStarted,
    getOnboardingTourStep,
} from '../../store/users'
import {
    BoardTourSteps,
    TOUR_BOARD,
    TourCategoriesMapToSteps,
} from '../onboardingTour'
import {OnboardingBoardTitle} from '../cardDetail/cardDetail'
import AddViewTourStep from '../onboardingTour/addView/add_view'
import {getCurrentCard} from '../../store/cards'
import BoardPermissionGate from '../permissions/boardPermissionGate'

import NewCardButton from './newCardButton'
import ViewHeaderPropertiesMenu from './viewHeaderPropertiesMenu'
import ViewHeaderGroupByMenu from './viewHeaderGroupByMenu'
import ViewHeaderDisplayByMenu from './viewHeaderDisplayByMenu'
import ViewHeaderSortMenu from './viewHeaderSortMenu'
import ViewHeaderActionsMenu from './viewHeaderActionsMenu'
import ViewHeaderSearch from './viewHeaderSearch'
import FilterComponent from './filterComponent'

import './viewHeader.scss'

type Props = {
    board: Board
    activeView: BoardView
    views: BoardView[]
    cards: Card[]
    groupByProperty?: IPropertyTemplate
    addCard: () => void
    addCardFromTemplate: (cardTemplateId: string) => void
    addCardTemplate: () => void
    editCardTemplate: (cardTemplateId: string) => void
    readonly: boolean
    dateDisplayProperty?: IPropertyTemplate
}

const ViewHeader = (props: Props) => {
    const [showFilter, setShowFilter] = createSignal(false)
    const [lockFilterOnClose, setLockFilterOnClose] = createSignal(false)
    const intl = useIntl()
    const canEditBoardProperties = useHasCurrentBoardPermissions([Permission.ManageBoardProperties])

    const withGroupBy = () => props.activeView.fields.viewType === 'board' || props.activeView.fields.viewType === 'table'
    const withDisplayBy = () => props.activeView.fields.viewType === 'calendar'
    const withSortBy = () => props.activeView.fields.viewType !== 'calendar'

    const [viewTitle, setViewTitle] = createSignal(props.activeView.title)

    createEffect(() => {
        setViewTitle(props.activeView.title)
    })

    const hasFilter = () => props.activeView.fields.filter && props.activeView.fields.filter.filters?.length > 0

    const isOnboardingBoard = () => props.board.title === OnboardingBoardTitle
    const onboardingTourStarted = useAppSelector(getOnboardingTourStarted)
    const onboardingTourCategory = useAppSelector(getOnboardingTourCategory)
    const onboardingTourStep = useAppSelector(getOnboardingTourStep)

    const currentCard = useAppSelector(getCurrentCard)
    const noCardOpen = () => !currentCard()

    const showTourBaseCondition = () => isOnboardingBoard() &&
        onboardingTourStarted() &&
        noCardOpen() &&
        onboardingTourCategory() === TOUR_BOARD &&
        onboardingTourStep() === BoardTourSteps.ADD_VIEW.toString()

    const [delayComplete, setDelayComplete] = createSignal(false)

    createEffect(() => {
        if (showTourBaseCondition()) {
            setTimeout(() => {
                setDelayComplete(true)
            }, 800)
        }
    })

    onMount(() => {
        if (!BoardTourSteps.SHARE_BOARD) {
            BoardTourSteps.SHARE_BOARD = 2
        }

        TourCategoriesMapToSteps[TOUR_BOARD] = BoardTourSteps
    })

    const showAddViewTourStep = () => showTourBaseCondition() && delayComplete()

    return (
        <div class='ViewHeader'>
            <div class='viewSelector'>
                <Editable
                    value={viewTitle()}
                    placeholderText='Untitled View'
                    onSave={(): void => {
                        mutator.changeBlockTitle(props.activeView.boardId, props.activeView.id, props.activeView.title, viewTitle())
                    }}
                    onCancel={(): void => {
                        setViewTitle(props.activeView.title)
                    }}
                    onChange={setViewTitle}
                    saveOnEsc={true}
                    readonly={props.readonly || !canEditBoardProperties()}
                    spellCheck={true}
                    autoExpand={false}
                />
                <Show when={!props.readonly}>
                    <div>
                        <MenuWrapper
                            label={intl.formatMessage({id: 'ViewHeader.view-menu', defaultMessage: 'View menu'})}
                            menu={
                                <ViewMenu
                                    board={props.board}
                                    activeView={props.activeView}
                                    views={props.views}
                                    readonly={props.readonly || !canEditBoardProperties()}
                                />
                            }
                        >
                            <IconButton icon={<DropdownIcon/>}/>
                        </MenuWrapper>
                        <Show when={showAddViewTourStep()}>
                            <AddViewTourStep/>
                        </Show>
                    </div>
                </Show>

            </div>

            <div class='octo-spacer'/>

            <Show when={!props.readonly && canEditBoardProperties()}>
                {/* Card properties */}

                <ViewHeaderPropertiesMenu
                    properties={props.board.cardProperties}
                    activeView={props.activeView}
                />

                {/* Group by */}

                <Show when={withGroupBy()}>
                    <ViewHeaderGroupByMenu
                        properties={props.board.cardProperties}
                        activeView={props.activeView}
                        groupByProperty={props.groupByProperty}
                    />
                </Show>

                {/* Display by */}

                <Show when={withDisplayBy()}>
                    <ViewHeaderDisplayByMenu
                        properties={props.board.cardProperties}
                        activeView={props.activeView}
                        dateDisplayPropertyName={props.dateDisplayProperty?.name}
                    />
                </Show>

                {/* Filter */}

                <ModalWrapper>
                    <Button
                        active={hasFilter()}
                        onClick={() => setShowFilter(!showFilter())}
                        onMouseOver={() => setLockFilterOnClose(true)}
                        onMouseLeave={() => setLockFilterOnClose(false)}
                    >
                        <FormattedMessage
                            id='ViewHeader.filter'
                            defaultMessage='Filter'
                        />
                    </Button>
                    <Show when={showFilter()}>
                        <FilterComponent
                            board={props.board}
                            activeView={props.activeView}
                            onClose={() => {
                                if (!lockFilterOnClose()) {
                                    setShowFilter(false)
                                }
                            }}
                        />
                    </Show>
                </ModalWrapper>

                {/* Sort */}

                <Show when={withSortBy()}>
                    <ViewHeaderSortMenu
                        properties={props.board.cardProperties}
                        activeView={props.activeView}
                        orderedCards={props.cards}
                    />
                </Show>
            </Show>

            {/* Search */}

            <ViewHeaderSearch/>

            {/* Options menu */}

            <Show when={!props.readonly}>
                <ViewHeaderActionsMenu
                    board={props.board}
                    activeView={props.activeView}
                    cards={props.cards}
                />

                {/* New card button */}

                <BoardPermissionGate permissions={[Permission.ManageBoardCards]}>
                    <NewCardButton
                        board={props.board}
                        addCard={props.addCard}
                        addCardFromTemplate={props.addCardFromTemplate}
                        addCardTemplate={props.addCardTemplate}
                        editCardTemplate={props.editCardTemplate}
                    />
                </BoardPermissionGate>
            </Show>
        </div>
    )
}

export default ViewHeader
