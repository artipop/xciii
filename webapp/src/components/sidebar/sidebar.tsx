// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, Show, createEffect, createSignal, onCleanup, onMount} from 'solid-js'

import {useDragDropMonitor} from '@dnd-kit/solid'
import {isSortable} from '@dnd-kit/dom/sortable'

import {FormattedMessage} from '../../intl'

import {getActiveThemeName, loadTheme} from '../../theme'
import IconButton from '../../widgets/buttons/iconButton'
import HamburgerIcon from '../../widgets/icons/hamburger'
import HideSidebarIcon from '../../widgets/icons/hideSidebar'
import ShowSidebarIcon from '../../widgets/icons/showSidebar'
import {getCurrentBoard, getMySortedBoards} from '../../store/boards'
import {useAppSelector, useAppStore} from '../../store/hooks'
import {Utils} from '../../utils'
import {IUser} from '../../user'

import './sidebar.scss'

import {
    BoardCategoryWebsocketData,
    Category,
    CategoryBoards,
    getSidebarCategories,
} from '../../store/sidebar'

import BoardsSwitcher from '../boardsSwitcher/boardsSwitcher'

import wsClient, {WSClient} from '../../wsclient'

import {getCurrentTeam, getCurrentTeamId} from '../../store/teams'

import {Constants} from '../../constants'

import {getMe} from '../../store/users'
import {getCurrentViewId} from '../../store/views'

import octoClient from '../../octoClient'

import {useWebsockets} from '../../hooks/websockets'

import mutator from '../../mutator'

import {Board} from '../../blocks/board'

import SidebarCategory, {CategoryBoardsDroppableData} from './sidebarCategory'
import SidebarSettingsMenu from './sidebarSettingsMenu'
import SidebarUserMenu from './sidebarUserMenu'

type Props = {
    activeBoardId?: string
    onBoardTemplateSelectorOpen: () => void
    onBoardTemplateSelectorClose?: () => void
}

function getWindowDimensions() {
    const {innerWidth: width, innerHeight: height} = window
    return {
        width,
        height,
    }
}

// The shape react-beautiful-dnd reported a drop with. The handlers below are
// written against it, so it outlives the library that named it.
type DropResult = {
    draggableId: string
    type: string
    source: {index: number, droppableId: string}
    destination?: {index: number, droppableId: string}
}

// Categories are sortables in one list and carry no group of their own; the name
// is the droppable id react-beautiful-dnd gave that list, which the handlers
// below still compare against.
const CategoriesDroppableID = 'lhs-categories'

// As much of a finished dnd-kit operation as the mapping below reads. Written as
// plain data rather than taken as dnd-kit entities so the mapping can be tested
// without a pointer, an element and a live drag.
export type SidebarDragSource = {
    id: string
    type: string

    // Its position among its peers as rendered: the index of a category in the
    // sidebar, of a board in the visible boards of `group`.
    index: number
    group?: string
}

export type SidebarDropTarget = {
    id: string
    index?: number
    group?: string

    // Set by a category's boards drop zone, which is not a sortable and so has
    // no group to name the category by.
    categoryID?: string
}

// Where a board sits as handleCategoryBoardDND wants it: its index in its
// category's boardMetadata, which is not the index dnd-kit knows, because the
// rendered list of a category leaves out its hidden boards and its templates.
function boardMetadataIndex(categories: CategoryBoards[], categoryID: string, boardID: string): number {
    const category = categories.find((c) => c.id === categoryID)
    return category ? category.boardMetadata.findIndex((metadata) => metadata.boardID === boardID) : -1
}

function boardDropDestination(categories: CategoryBoards[], target: SidebarDropTarget): {index: number, droppableId: string} | undefined {
    // Released over another board: it takes that board's place.
    if (target.group !== undefined) {
        const index = boardMetadataIndex(categories, target.group, target.id)
        return index < 0 ? undefined : {index, droppableId: target.group}
    }

    // Released over a category but not over any board in it -- all an empty
    // category can offer, and the way one gets filled. Append.
    if (target.categoryID === undefined) {
        return undefined
    }
    const category = categories.find((c) => c.id === target.categoryID)
    return category ? {index: category.boardMetadata.length, droppableId: category.id} : undefined
}

// The drop as react-beautiful-dnd would have reported it, which is the shape the
// handlers are written against.
//
// Where the drop landed is read off the target rather than off the source.
// OptimisticSortingPlugin is the only thing that moves a sortable's index and
// group as it is dragged, and it is left out everywhere (see hooks/sortable.tsx)
// -- so at dragend both still say where the drag began. Asking the source where
// it ended answered "where it started" every time, and every sidebar drag
// cancelled itself on the equality check in onDragEnd.
export function sidebarDropResult(categories: CategoryBoards[], source: SidebarDragSource, target: SidebarDropTarget): DropResult | undefined {
    if (source.type === 'category') {
        if (target.index === undefined) {
            return undefined
        }
        return {
            draggableId: source.id,
            type: source.type,
            source: {index: source.index, droppableId: CategoriesDroppableID},
            destination: {index: target.index, droppableId: CategoriesDroppableID},
        }
    }

    if (source.type !== 'board') {
        return undefined
    }

    const fromCategoryID = source.group ?? ''
    const sourceIndex = boardMetadataIndex(categories, fromCategoryID, source.id)
    const destination = boardDropDestination(categories, target)
    if (sourceIndex < 0 || !destination) {
        return undefined
    }

    return {
        draggableId: source.id,
        type: source.type,
        source: {index: sourceIndex, droppableId: fromCategoryID},
        destination,
    }
}

const Sidebar = (props: Props) => {
    const [isHidden, setHidden] = createSignal(false)
    const [userHidden, setUserHidden] = createSignal(false)
    const [windowDimensions, setWindowDimensions] = createSignal(getWindowDimensions())
    const boards = useAppSelector(getMySortedBoards)
    const {actions} = useAppStore()
    const sidebarCategories = useAppSelector<CategoryBoards[]>(getSidebarCategories)
    const me = useAppSelector<IUser|null>(getMe)
    const activeViewID = useAppSelector(getCurrentViewId)
    const currentBoard = useAppSelector(getCurrentBoard)

    onMount(() => {
        const categoryOnChangeHandler = (_: WSClient, categories: Category[]) => {
            actions.sidebar.updateCategories(categories)
        }

        const blockCategoryOnChangeHandler = (_: WSClient, blockCategories: BoardCategoryWebsocketData[]) => {
            actions.sidebar.updateBoardCategories(blockCategories)
        }

        wsClient.addOnChange(categoryOnChangeHandler, 'category')
        wsClient.addOnChange(blockCategoryOnChangeHandler, 'blockCategories')

        onCleanup(() => {
            wsClient.removeOnChange(categoryOnChangeHandler, 'category')
            wsClient.removeOnChange(blockCategoryOnChangeHandler, 'blockCategories')
        })
    })

    const teamId = useAppSelector(getCurrentTeamId)
    const team = useAppSelector(getCurrentTeam)

    createEffect(() => {
        if (team()) {
            actions.sidebar.fetchSidebarCategories(team()!.id)
        }
    })

    onMount(() => {
        loadTheme()
    })

    onMount(() => {
        function handleResize() {
            setWindowDimensions(getWindowDimensions())
        }

        window.addEventListener('resize', handleResize)
        onCleanup(() => window.removeEventListener('resize', handleResize))
    })

    createEffect(() => {
        windowDimensions()
        hideSidebar()
    })

    // This handles the case when a user opens a linked board from Channels RHS
    // and thats the first time that user is opening that board.
    // Here we check if that board has a associated category for the user. If not,
    // we assign it to the default "Boards" category.
    // We do this on the client side rather than the server side like for all other cases
    // because there is no good, explicit API call to add this logic to when opening
    // a board that you have implicit access to.
    createEffect(() => {
        const categories = sidebarCategories()
        const board = currentBoard()
        const currentTeam = team()
        if (!categories || categories.length === 0 || !board || !currentTeam || board.isTemplate) {
            return
        }

        // find the category the current board belongs to
        const category = categories.find((c) => c.boardMetadata.find((boardMetadata) => boardMetadata.boardID === board.id))
        if (category) {
            // Boards does belong to a category.
            // All good here. Nothing to do
            return
        }

        // if the board doesn't belong to a category
        // we need to move it to the default "Boards" category
        const boardsCategory = categories.find((c) => c.name === 'Boards')
        if (!boardsCategory) {
            Utils.logError('Boards category not found for user')
            return
        }

        octoClient.moveBoardToCategory(currentTeam.id, board.id, boardsCategory.id, '')
    })

    useWebsockets(teamId, (websocketClient: WSClient) => {
        const onCategoryReorderHandler = (_: WSClient, newCategoryOrder: string[]): void => {
            actions.sidebar.updateCategoryOrder(newCategoryOrder)
        }

        websocketClient.addOnChange(onCategoryReorderHandler, 'categoryOrder')
        return () => {
            websocketClient.removeOnChange(onCategoryReorderHandler, 'categoryOrder')
        }
    })

    const hideSidebar = () => {
        if (!userHidden()) {
            if (windowDimensions().width < 768) {
                setHidden(true)
            } else {
                setHidden(false)
            }
        }
    }

    const handleCategoryDND = async (result: DropResult) => {
        const {destination, source} = result
        const currentTeam = team()
        if (!currentTeam || !destination) {
            return
        }

        const categories = sidebarCategories()

        // creating a mutable copy
        const newCategories = Array.from(categories)

        // remove category from old index
        newCategories.splice(source.index, 1)

        // add it to new index
        newCategories.splice(destination.index, 0, categories[source.index])

        const newCategoryOrder = newCategories.map((category) => category.id)

        // optimistically updating the store to produce a lag-free UI
        actions.sidebar.updateCategoryOrder(newCategoryOrder)
        await octoClient.reorderSidebarCategories(currentTeam.id, newCategoryOrder)
    }

    const handleCategoryBoardDND = async (result: DropResult) => {
        const {source, destination, draggableId} = result
        const currentTeam = team()

        if (!currentTeam || !destination) {
            return
        }

        const fromCategoryID = source.droppableId
        const toCategoryID = destination.droppableId
        const boardID = draggableId

        if (fromCategoryID === toCategoryID) {
            // board re-arranged withing the same category
            const toSidebarCategory = sidebarCategories().find((category) => category.id === toCategoryID)
            if (!toSidebarCategory) {
                Utils.logError(`toCategoryID not found in list of sidebar categories. toCategoryID: ${toCategoryID}`)
                return
            }

            const categoryBoardMetadata = [...toSidebarCategory.boardMetadata]
            categoryBoardMetadata.splice(source.index, 1)
            categoryBoardMetadata.splice(destination.index, 0, toSidebarCategory.boardMetadata[source.index])

            actions.sidebar.updateCategoryBoardsOrder({categoryID: toCategoryID, boardsMetadata: categoryBoardMetadata})

            const reorderedBoardIDs = categoryBoardMetadata.map((m) => m.boardID)
            await octoClient.reorderSidebarCategoryBoards(currentTeam.id, toCategoryID, reorderedBoardIDs)
        } else {
            // board moved to a different category
            const toSidebarCategory = sidebarCategories().find((category) => category.id === toCategoryID)
            const fromSidebarCategory = sidebarCategories().find((category) => category.id === fromCategoryID)

            if (!toSidebarCategory) {
                Utils.logError(`toCategoryID not found in list of sidebar categories. toCategoryID: ${toCategoryID}`)
                return
            }

            if (!fromSidebarCategory) {
                Utils.logError(`fromCategoryID not found in list of sidebar categories. fromCategoryID: ${fromCategoryID}`)
                return
            }

            const categoryBoardMetadata = [...toSidebarCategory.boardMetadata]
            const fromCategoryBoardMetadata = fromSidebarCategory.boardMetadata[source.index]
            categoryBoardMetadata.splice(destination.index, 0, fromCategoryBoardMetadata)

            // optimistically updating the store to create a lag-free UI.
            actions.sidebar.updateCategoryBoardsOrder({categoryID: toCategoryID, boardsMetadata: categoryBoardMetadata})
            actions.sidebar.updateBoardCategories([{...fromCategoryBoardMetadata, categoryID: toCategoryID}])

            await mutator.moveBoardToCategory(currentTeam.id, boardID, toCategoryID, fromCategoryID)

            const reorderedBoardIDs = categoryBoardMetadata.map((m) => m.boardID)
            await octoClient.reorderSidebarCategoryBoards(currentTeam.id, toCategoryID, reorderedBoardIDs)
        }
    }

    const onDragEnd = async (result: DropResult) => {
        const {destination, source, type} = result

        if (!team() || !destination) {
            setDraggedItemID('')
            setIsCategoryBeingDragged(false)
            return
        }

        if (destination.droppableId === source.droppableId && destination.index === source.index) {
            setDraggedItemID('')
            setIsCategoryBeingDragged(false)
            return
        }

        if (type === 'category') {
            handleCategoryDND(result)
        } else if (type === 'board') {
            handleCategoryBoardDND(result)
        } else {
            Utils.logWarn(`unknown drag type encountered, type: ${type}`)
        }

        setDraggedItemID('')
        setIsCategoryBeingDragged(false)
    }

    useDragDropMonitor({
        onDragStart(event) {
            const source = event.operation.source
            if (!source || !isSortable(source)) {
                return
            }
            const draggedType = String(source.type ?? '')
            if (draggedType !== 'category' && draggedType !== 'board') {
                return
            }
            setDraggedItemID(String(source.id))
            setIsCategoryBeingDragged(draggedType === 'category')
        },
        onDragEnd(event) {
            if (event.canceled) {
                setDraggedItemID('')
                setIsCategoryBeingDragged(false)
                return
            }
            const {source, target} = event.operation

            // This monitor sees every drop in the application, not only the
            // sidebar's. Cards used to be raw draggables and were filtered out
            // by isSortable here; now that they are sortables of their own,
            // their drops arrive too, and sidebarDropResult declines them by
            // type rather than letting them reach onDragEnd's "unknown drag
            // type" warning and reset sidebar state on the way.
            if (!source || !isSortable(source) || !target) {
                return
            }

            const result = sidebarDropResult(
                sidebarCategories(),
                {
                    id: String(source.id),
                    type: String(source.type ?? ''),
                    index: source.index,
                    group: source.group === undefined ? undefined : String(source.group),
                },
                {
                    id: String(target.id),
                    index: isSortable(target) ? target.index : undefined,
                    group: isSortable(target) && target.group !== undefined ? String(target.group) : undefined,
                    categoryID: (target.data as CategoryBoardsDroppableData | undefined)?.categoryID,
                },
            )

            if (result) {
                onDragEnd(result)
            }
        },
    })

    const [draggedItemID, setDraggedItemID] = createSignal<string>('')
    const [isCategoryBeingDragged, setIsCategoryBeingDragged] = createSignal<boolean>(false)

    const getSortedCategoryBoards = (category: CategoryBoards): Board[] => {
        const categoryBoardsByID = new Map<string, Board>()
        boards().forEach((board) => {
            if (!category.boardMetadata.find((m) => m.boardID === board.id)) {
                return
            }

            categoryBoardsByID.set(board.id, board)
        })

        const sortedBoards: Board[] = []
        category.boardMetadata.forEach((boardMetadata) => {
            const b = categoryBoardsByID.get(boardMetadata.boardID)
            if (b) {
                sortedBoards.push(b)
            }
        })
        return sortedBoards
    }

    return (
        <Show when={boards() && me()}>
            <Show
                when={!isHidden()}
                fallback={
                    <div class='Sidebar octo-sidebar hidden'>
                        <div class='octo-sidebar-header show-button'>
                            <div class='hamburger-icon'>
                                <IconButton
                                    icon={<HamburgerIcon/>}
                                    onClick={() => {
                                        setUserHidden(false)
                                        setHidden(false)
                                    }}
                                />
                            </div>
                            <div class='show-icon'>
                                <IconButton
                                    icon={<ShowSidebarIcon/>}
                                    onClick={() => {
                                        setUserHidden(false)
                                        setHidden(false)
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                }
            >
                <div class='Sidebar octo-sidebar'>
                    <div class='octo-sidebar-header'>
                        <div class='heading'>
                            <SidebarUserMenu/>
                        </div>

                        <div class='octo-spacer'/>
                        <div class='sidebarSwitcher'>
                            <IconButton
                                onClick={() => {
                                    setUserHidden(true)
                                    setHidden(true)
                                }}
                                icon={<HideSidebarIcon/>}
                            />
                        </div>
                    </div>

                    <Show when={team() && team()!.id !== Constants.globalTeamId}>
                        <div class='WorkspaceTitle'/>
                    </Show>

                    <BoardsSwitcher/>

                    <div class='octo-sidebar-list'>
                        <For each={sidebarCategories()}>
                            {(category, index) => (
                                <SidebarCategory
                                    hideSidebar={hideSidebar}
                                    activeBoardID={props.activeBoardId}
                                    activeViewID={activeViewID()}
                                    categoryBoards={category}
                                    boards={getSortedCategoryBoards(category)}
                                    allCategories={sidebarCategories()}
                                    index={index()}
                                    onBoardTemplateSelectorClose={props.onBoardTemplateSelectorClose}
                                    draggedItemID={draggedItemID()}
                                    forceCollapse={isCategoryBeingDragged()}
                                />
                            )}
                        </For>
                    </div>

                    <div class='octo-spacer'/>

                    <div
                        class='add-board'
                        onClick={props.onBoardTemplateSelectorOpen}
                    >
                        <FormattedMessage
                            id='Sidebar.add-board'
                            defaultMessage='+ Add board'
                        />
                    </div>

                    <SidebarSettingsMenu activeTheme={getActiveThemeName()}/>
                </div>
            </Show>
        </Show>
    )
}

export default Sidebar
