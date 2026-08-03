// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, Show, createEffect, createSignal, onCleanup} from 'solid-js'

import {FormattedMessage, useIntl} from '../../intl'

import {useNavigate} from '@solidjs/router'

import debounce from 'lodash/debounce'

import {useSortable} from '@dnd-kit/solid/sortable'
import {SortableKeyboardPlugin} from '@dnd-kit/dom/sortable'
import {useDroppable} from '@dnd-kit/solid'

import HandRightIcon from '@mattermost/compass-icons/components/hand-right'

import {Board} from '../../blocks/board'
import mutator from '../../mutator'
import IconButton from '../../widgets/buttons/iconButton'
import DeleteIcon from '../../widgets/icons/delete'
import CompassIcon from '../../widgets/icons/compassIcon'
import OptionsIcon from '../../widgets/icons/options'
import Menu from '../../widgets/menu'
import MenuWrapper from '../../widgets/menuWrapper'

import './sidebarCategory.scss'
import {Category, CategoryBoardMetadata, CategoryBoards} from '../../store/sidebar'
import ChevronDown from '../../widgets/icons/chevronDown'
import ChevronRight from '../../widgets/icons/chevronRight'
import CreateNewFolder from '../../widgets/icons/newFolder'
import CreateCategory from '../createCategory/createCategory'
import {useAppSelector} from '../../store/hooks'
import {useRouteMatch} from '../../hooks/routerMatch'
import {
    getOnboardingTourCategory,
    getOnboardingTourStep,
} from '../../store/users'

import {getCurrentCard} from '../../store/cards'
import {Utils} from '../../utils'

import {TOUR_SIDEBAR, SidebarTourSteps, TOUR_BOARD, FINISHED} from '../../components/onboardingTour/index'
import telemetryClient, {TelemetryActions, TelemetryCategory} from '../../telemetry/telemetryClient'

import {getCurrentTeam} from '../../store/teams'

import ConfirmationDialogBox, {ConfirmationDialogBoxProps} from '../confirmationDialogBox'

import SidebarCategoriesTourStep from '../../components/onboardingTour/sidebarCategories/sidebarCategories'
import ManageCategoriesTourStep from '../../components/onboardingTour/manageCategories/manageCategories'

import DeleteBoardDialog from './deleteBoardDialog'
import SidebarBoardItem from './sidebarBoardItem'

type Props = {
    activeCategoryId?: string
    activeBoardID?: string
    activeViewID?: string
    hideSidebar: () => void
    categoryBoards: CategoryBoards
    boards: Board[]
    allCategories: CategoryBoards[]
    index: number
    onBoardTemplateSelectorClose?: () => void
    draggedItemID?: string
    forceCollapse?: boolean
}

export const ClassForManageCategoriesTourStep = 'manageCategoriesTourStep'

const SidebarCategory = (props: Props) => {
    const [collapsed, setCollapsed] = createSignal(props.categoryBoards.collapsed)
    const intl = useIntl()
    const navigate = useNavigate()

    const [deleteBoard, setDeleteBoard] = createSignal<Board|null>()
    const [showDeleteCategoryDialog, setShowDeleteCategoryDialog] = createSignal<boolean>(false)
    const [categoryMenuOpen, setCategoryMenuOpen] = createSignal<boolean>(false)

    const match = useRouteMatch()
    const [showCreateCategoryModal, setShowCreateCategoryModal] = createSignal(false)
    const [showUpdateCategoryModal, setShowUpdateCategoryModal] = createSignal(false)

    const onboardingTourCategory = useAppSelector(getOnboardingTourCategory)
    const onboardingTourStep = useAppSelector(getOnboardingTourStep)
    const currentCard = useAppSelector(getCurrentCard)
    const noCardOpen = () => !currentCard()
    const team = useAppSelector(getCurrentTeam)
    const teamID = () => team()?.id || ''

    let menuWrapperRef: HTMLDivElement | undefined

    // A category is sortable among categories and, at the same time, the place
    // boards get dropped into -- including an empty one, which is why the boards
    // area is its own droppable keyed by the category id.
    const {ref, isDragSource: isDragging} = useSortable({
        get id() {
            return props.categoryBoards.id
        },
        get index() {
            return props.index
        },
        type: 'category',
        accept: 'category',

        // Left out everywhere, not only here: see hooks/sortable.tsx.
        plugins: [SortableKeyboardPlugin],
    })

    const {ref: boardsRef, isDropTarget: isBoardOver} = useDroppable({
        get id() {
            return props.categoryBoards.id
        },
        type: 'board',
        accept: 'board',
    })

    const [boardDraggingOver, setBoardDraggingOver] = createSignal<boolean>(false)

    const shouldViewSidebarTour = () => props.boards.length !== 0 &&
                                  noCardOpen() &&
                                  (onboardingTourCategory() === TOUR_SIDEBAR || onboardingTourCategory() === TOUR_BOARD) &&
                                  ((onboardingTourCategory() === TOUR_SIDEBAR && onboardingTourStep() === SidebarTourSteps.SIDE_BAR.toString()) || (onboardingTourCategory() === TOUR_BOARD && onboardingTourStep() === FINISHED.toString()))

    const shouldViewManageCatergoriesTour = () => props.boards.length !== 0 &&
                                            noCardOpen() &&
                                            onboardingTourCategory() === TOUR_SIDEBAR &&
                                            onboardingTourStep() === SidebarTourSteps.MANAGE_CATEGORIES.toString()

    createEffect(() => {
        if (shouldViewManageCatergoriesTour() && props.index === 0) {
            setCategoryMenuOpen(true)
        }
    })

    const showBoard = (boardId: string) => {
        if (boardId === props.activeBoardID && props.onBoardTemplateSelectorClose) {
            props.onBoardTemplateSelectorClose()
        }
        Utils.showBoard(boardId, match(), navigate)
        props.hideSidebar()
    }

    const showView = (viewId: string, boardId: string) => {
        if (viewId === props.activeViewID && props.onBoardTemplateSelectorClose) {
            props.onBoardTemplateSelectorClose()
        }

        // if the same board, reuse the match params
        // otherwise remove viewId and cardId, results in first view being selected
        const currentMatch = match()
        const params = {...currentMatch.params, boardId: boardId || '', viewId: viewId || ''}
        if (boardId !== currentMatch.params.boardId && viewId !== currentMatch.params.viewId) {
            params.cardId = undefined
        }
        const newPath = Utils.generatePath(Utils.getBoardPagePath(currentMatch.path), params)
        navigate(newPath)
        props.hideSidebar()
    }

    const sidebarBoardMetadata = () => props.categoryBoards.boardMetadata || []

    const isBoardVisible = (boardID: string, existingBoardMetadata?: CategoryBoardMetadata): boolean => {
        const categoryBoardMetadata = existingBoardMetadata || sidebarBoardMetadata().find((metadata) => metadata.boardID === boardID)

        // hide if board doesn't belong to current category
        if (!categoryBoardMetadata) {
            return false
        }

        // hide if board was hidden by the user
        return !categoryBoardMetadata.hidden
    }

    const visibleBlocks = () => props.categoryBoards.boardMetadata.filter((boardMetadata) => isBoardVisible(boardMetadata.boardID, boardMetadata))

    const handleCreateNewCategory = () => {
        setShowCreateCategoryModal(true)
    }

    const handleDeleteCategory = async () => {
        await mutator.deleteCategory(teamID(), props.categoryBoards.id)
    }

    const handleUpdateCategory = async () => {
        setShowUpdateCategoryModal(true)
    }

    const deleteCategoryProps = (): ConfirmationDialogBoxProps => ({
        heading: intl.formatMessage({
            id: 'SidebarCategories.CategoryMenu.DeleteModal.Title',
            defaultMessage: 'Delete this category?',
        }),
        subText: intl.formatMessage(
            {
                id: 'SidebarCategories.CategoryMenu.DeleteModal.Body',
                defaultMessage: 'Boards in <b>{categoryName}</b> will move back to the Boards categories. You\'re not removed from any boards.',
            },
            {
                categoryName: props.categoryBoards.name,
                b: (...chunks: unknown[]) => <b>{chunks as never}</b>,
            },
        ) as never,
        onConfirm: () => handleDeleteCategory(),
        onClose: () => setShowDeleteCategoryDialog(false),
    })

    const onDeleteBoard = async () => {
        const board = deleteBoard()
        if (!board) {
            return
        }
        telemetryClient.trackEvent(TelemetryCategory, TelemetryActions.DeleteBoard, {board: board.id})
        mutator.deleteBoard(
            board,
            intl.formatMessage({id: 'Sidebar.delete-board', defaultMessage: 'Delete board'}),
            async () => {
                let nextBoardId: number | undefined
                if (props.boards.length > 1) {
                    const deleteBoardIndex = props.boards.findIndex((b) => b.id === board.id)
                    nextBoardId = deleteBoardIndex + 1 === props.boards.length ? deleteBoardIndex - 1 : deleteBoardIndex + 1
                }

                if (nextBoardId) {
                // This delay is needed because WSClient has a default 100 ms notification delay before updates
                    setTimeout(() => {
                        showBoard(props.boards[nextBoardId as number].id)
                    }, 120)
                }
            },
            async () => {
                showBoard(board.id)
            },
        )
    }

    const updateCategory = async (value: boolean) => {
        const updatedCategory: Category = {
            ...props.categoryBoards,
            collapsed: value,
        }
        await mutator.updateCategory(updatedCategory)
    }

    const debouncedUpdateCategory = debounce(updateCategory, 400)

    const toggleCollapse = async () => {
        const newVal = !collapsed()
        setCollapsed(newVal)

        // The default 'Boards' category isn't stored in database,
        // so avoid making the API call for it
        if (props.categoryBoards.id !== '') {
            debouncedUpdateCategory(newVal)
        }
    }

    const newCategoryBadge = () => (
        <div class='badge newCategoryBadge'>
            <span>
                {
                    intl.formatMessage({
                        id: 'Sidebar.new-category.badge',
                        defaultMessage: 'New',
                    })
                }
            </span>
        </div>
    )

    const newCategoryDragArea = () => (
        <div class='newCategoryDragArea'>
            <HandRightIcon/>
            <span>
                {
                    intl.formatMessage({
                        id: 'Sidebar.new-category.drag-boards-cta',
                        defaultMessage: 'Drag boards here...',
                    })
                }
            </span>
        </div>
    )

    // The render prop used to notice isDraggingOver flipping and defer the state
    // change out of render; an effect is where that belonged all along.
    createEffect(() => {
        const over = isBoardOver()
        const timeout = setTimeout(() => setBoardDraggingOver(over), 200)
        onCleanup(() => clearTimeout(timeout))
    })

    const expandedBoardsHidden = () => collapsed() || props.forceCollapse || isDragging() || props.draggedItemID === props.categoryBoards.id

    return (
        <div
            ref={ref}
        >
            <div
                class={`SidebarCategory${props.categoryBoards.isNew ? ' new' : ''}${boardDraggingOver() ? ' draggingOver' : ''}`}
                ref={menuWrapperRef}
            >
                <div
                    class={`categoryBoardsDroppableArea${isBoardOver() ? ' draggingOver' : ''}`}
                    ref={boardsRef}
                >
                    <div
                        class={`octo-sidebar-item category ${collapsed() || props.forceCollapse ? 'collapsed' : 'expanded'} ${props.categoryBoards.id === props.activeCategoryId ? 'active' : ''}`}
                    >
                        <div
                            class='octo-sidebar-title category-title'
                            title={props.categoryBoards.name}
                            onClick={toggleCollapse}
                        >
                            {collapsed() || isDragging() || props.forceCollapse ? <ChevronRight/> : <ChevronDown/>}
                            {props.categoryBoards.name}
                            <div class='sidebarCategoriesTour'>
                                <Show when={props.index === 0 && shouldViewSidebarTour()}>
                                    <SidebarCategoriesTourStep/>
                                </Show>
                            </div>
                        </div>
                        <div class={(props.index === 0 && shouldViewManageCatergoriesTour()) ? `${ClassForManageCategoriesTourStep}` : ''}>
                            <Show when={props.index === 0 && shouldViewManageCatergoriesTour()}>
                                <ManageCategoriesTourStep/>
                            </Show>

                            <Show when={props.categoryBoards.isNew && !categoryMenuOpen()}>
                                {newCategoryBadge()}
                            </Show>

                            <MenuWrapper
                                className={categoryMenuOpen() ? 'menuOpen' : ''}
                                stopPropagationOnToggle={true}
                                onToggle={(open) => setCategoryMenuOpen(open)}
                                menu={
                                    <Menu
                                        position='auto'
                                        fixed={true}
                                        parentRef={{current: menuWrapperRef ?? null}}
                                    >
                                        <Show when={props.categoryBoards.type === 'custom'}>
                                            <Menu.Text
                                                id='updateCategory'
                                                name={intl.formatMessage({id: 'SidebarCategories.CategoryMenu.Update', defaultMessage: 'Rename Category'})}
                                                icon={<CompassIcon icon='pencil-outline'/>}
                                                onClick={handleUpdateCategory}
                                            />
                                            <Menu.Text
                                                id='deleteCategory'
                                                className='text-danger'
                                                name={intl.formatMessage({id: 'SidebarCategories.CategoryMenu.Delete', defaultMessage: 'Delete Category'})}
                                                icon={<DeleteIcon/>}
                                                onClick={() => setShowDeleteCategoryDialog(true)}
                                            />
                                            <Menu.Separator/>
                                        </Show>
                                        <Menu.Text
                                            id='createNewCategory'
                                            name={intl.formatMessage({id: 'SidebarCategories.CategoryMenu.CreateNew', defaultMessage: 'Create New Category'})}
                                            icon={<CreateNewFolder/>}
                                            onClick={handleCreateNewCategory}
                                        />
                                    </Menu>
                                }
                            >
                                <IconButton icon={<OptionsIcon/>}/>
                            </MenuWrapper>
                        </div>
                    </div>
                    <Show when={!expandedBoardsHidden() && visibleBlocks().length === 0}>
                        <div>
                            <Show when={!props.categoryBoards.isNew}>
                                <div class='octo-sidebar-item subitem no-views'>
                                    <FormattedMessage
                                        id='Sidebar.no-boards-in-category'
                                        defaultMessage='No boards inside'
                                    />
                                </div>
                            </Show>

                            <Show when={props.categoryBoards.isNew}>
                                {newCategoryDragArea()}
                            </Show>
                        </div>
                    </Show>
                    <Show when={!props.forceCollapse && collapsed() && !isDragging() && props.draggedItemID !== props.categoryBoards.id}>
                        <For each={props.boards.filter((board: Board) => board.id === props.activeBoardID && isBoardVisible(board.id))}>
                            {(board: Board, zzz) => (
                                <SidebarBoardItem
                                    index={zzz()}
                                    board={board}
                                    categoryBoards={props.categoryBoards}
                                    allCategories={props.allCategories}
                                    isActive={board.id === props.activeBoardID}
                                    showBoard={showBoard}
                                    showView={showView}
                                    onDeleteRequest={setDeleteBoard}
                                />
                            )}
                        </For>
                    </Show>
                    <Show when={!expandedBoardsHidden()}>
                        <For each={props.boards.filter((board) => isBoardVisible(board.id) && !board.isTemplate)}>
                            {(board: Board, zzz) => (
                                <SidebarBoardItem
                                    index={zzz()}
                                    board={board}
                                    categoryBoards={props.categoryBoards}
                                    allCategories={props.allCategories}
                                    isActive={board.id === props.activeBoardID}
                                    showBoard={showBoard}
                                    showView={showView}
                                    onDeleteRequest={setDeleteBoard}
                                    hideViews={props.draggedItemID === board.id || props.draggedItemID === props.categoryBoards.id}
                                />
                            )}
                        </For>
                    </Show>

                    <Show when={showCreateCategoryModal()}>
                        <CreateCategory
                            onClose={() => setShowCreateCategoryModal(false)}
                            title={(
                                <FormattedMessage
                                    id='SidebarCategories.CategoryMenu.CreateNew'
                                    defaultMessage='Create New Category'
                                />
                            )}
                        />
                    </Show>

                    <Show when={showUpdateCategoryModal()}>
                        <CreateCategory
                            initialValue={props.categoryBoards.name}
                            title={(
                                <FormattedMessage
                                    id='SidebarCategories.CategoryMenu.Update'
                                    defaultMessage='Rename Category'
                                />
                            )}
                            onClose={() => setShowUpdateCategoryModal(false)}
                            boardCategoryId={props.categoryBoards.id}
                            renameModal={true}
                        />
                    </Show>

                    <Show when={deleteBoard()}>
                        <DeleteBoardDialog
                            boardTitle={deleteBoard()!.title}
                            onClose={() => setDeleteBoard(null)}
                            onDelete={onDeleteBoard}
                        />
                    </Show>

                    <Show when={showDeleteCategoryDialog()}>
                        <ConfirmationDialogBox dialogBox={deleteCategoryProps()}/>
                    </Show>
                </div>
            </div>
        </div>
    )
}

export default SidebarCategory
