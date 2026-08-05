// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Dragging in the sidebar has no other guard that touches the wiring: the tests
// below are the whole difference between "a board moves between categories" and
// a drop quietly thrown away, which is how it was for a while -- the sidebar
// read where a drop landed off the dragged item's own index and group, and
// those only move when a dnd-kit plugin this application deliberately leaves
// out is installed. sidebar.test.tsx pins the mapping from a finished operation
// to a drop; only a real drag says the operation arrives at it at all.
import {render} from '@solidjs/testing-library'

import {TestRouter, mockAppStore, mockMatchMedia, wrapDNDIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'
import {TestBlockFactory} from '../../test/testBlockFactory'
import {setupDragEnvironment, setRect, drag} from '../../test/dragEnvironment'
import octoClient from '../../octoClient'

import Sidebar from './sidebar'

vi.mock('../../octoClient')
const mockedOctoClient = vi.mocked(octoClient)

setupDragEnvironment()

// Solid needs no act(): events propagate synchronously. The helper still takes a
// wrapper so the same code serves suites that need one; this is it.
const act = async (fn: () => Promise<void>): Promise<unknown> => fn()

describe('components/sidebar dragging', () => {
    const boards = ['board1', 'board2', 'board3'].map((id) => {
        const board = TestBlockFactory.createBoard()
        board.id = id
        board.title = id
        return board
    })

    const rowHeight = 40

    beforeAll(() => {
        mockMatchMedia({matches: true})
    })

    beforeEach(() => {
        vi.clearAllMocks()
    })

    // Three categories under one another, the first holding two boards, the
    // second one, the third none -- an empty category being the only place
    // where the category's own drop zone is what a board can land on.
    function setup() {
        const categories = [
            {id: 'category1', boardIDs: ['board1', 'board2']},
            {id: 'category2', boardIDs: ['board3']},
            {id: 'category3', boardIDs: []},
        ].map(({id, boardIDs}) => {
            const category = TestBlockFactory.createCategoryBoards()
            category.id = id
            category.name = id
            category.boardMetadata = boardIDs.map((boardID) => ({boardID, hidden: false}))
            return category
        })

        // The sidebar refetches its categories on mount and writes what comes
        // back over the initial state, so the client has to answer with the same
        // thing or the categories are gone by the time anything is dragged.
        mockedOctoClient.getSidebarCategories.mockResolvedValue(categories)

        const store = mockAppStore({
            teams: {
                current: {id: 'team-id'},
            },
            boards: {
                current: 'board1',
                boards: Object.fromEntries(boards.map((board) => [board.id, board])),
                myBoardMemberships: Object.fromEntries(boards.map((board) => [board.id, board])),
            },
            cards: {cards: {}, current: ''},
            views: {views: {}},
            users: {me: {id: 'user_id_1', props: {}}},
            sidebar: {
                categoryAttributes: categories,
                hiddenBoardIDs: [],
            },
        } as never, {client: mockedOctoClient as never})

        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <Sidebar onBoardTemplateSelectorOpen={vi.fn()}/>
                </TestRouter>
            </AppStoreProvider>,
        ))

        // Nothing lays anything out in jsdom, so the sidebar is given the
        // geometry it would have had: a header row per category, a row per
        // board under it. The rectangle goes on the element dnd-kit was handed
        // -- the wrapper carrying the sortable ref, not the visible row inside
        // it -- and the boards are measured last, so that where the two overlap
        // the board is what the pointer finds.
        const areas = Array.from(container.querySelectorAll('.categoryBoardsDroppableArea'))
        const rows = Array.from(container.querySelectorAll('.SidebarBoardItem')).map((row) => row.parentElement!)

        let y = 0
        const categoryTops: number[] = []
        const rowTops = new Map<string, number>()
        categories.forEach((category, index) => {
            const top = y
            categoryTops.push(top)
            const height = rowHeight * (1 + category.boardMetadata.length)
            setRect(areas[index].parentElement!.parentElement!, {x: 0, y: top, width: 200, height})
            setRect(areas[index], {x: 0, y: top, width: 200, height})
            category.boardMetadata.forEach((metadata, boardIndex) => {
                rowTops.set(metadata.boardID, top + (rowHeight * (boardIndex + 1)))
            })
            y = top + height
        })
        const headers = Array.from(container.querySelectorAll('.octo-sidebar-item.category'))
        headers.forEach((header, index) => {
            setRect(header, {x: 0, y: categoryTops[index], width: 200, height: rowHeight})
        })
        rows.forEach((row) => {
            const id = row.querySelector('.octo-sidebar-title')!.getAttribute('title')!
            setRect(row, {x: 0, y: rowTops.get(id)!, width: 200, height: rowHeight})
        })

        const boardRow = (id: string) => rows[boards.findIndex((board) => board.id === id)]
        const categoryOf = (index: number) => ({
            wrapper: areas[index].parentElement!.parentElement!,
            header: headers[index],
        })

        return {boardRow, categoryOf, categoryTops, rowTops, container}
    }

    // Onto board3, which is what the board dropped takes the place of. Aimed at
    // the middle of the row: a pointer intersection scores 1/distance-to-centre,
    // and a row shares its category's drop zone, so anywhere else in the row the
    // two are a coin toss decided by which was measured first.
    it('moves a board into another category', async () => {
        const {boardRow, rowTops} = setup()

        await drag(act, boardRow('board1'), {x: 100, y: rowTops.get('board3')! + (rowHeight / 2)})

        expect(mockedOctoClient.moveBoardToCategory).toHaveBeenCalledWith('team-id', 'board1', 'category2', 'category1')
        expect(mockedOctoClient.reorderSidebarCategoryBoards).toHaveBeenCalledWith('team-id', 'category2', ['board1', 'board3'])
    })

    // The category that holds no boards offers nothing to drop onto but itself,
    // and its drop zone is the one that used to share an id with the category's
    // own sortable -- so this is also what says the two no longer evict each
    // other from dnd-kit's registry.
    it('moves a board into a category that holds none', async () => {
        const {boardRow, categoryTops} = setup()

        await drag(act, boardRow('board1'), {x: 100, y: categoryTops[2] + 20})

        expect(mockedOctoClient.moveBoardToCategory).toHaveBeenCalledWith('team-id', 'board1', 'category3', 'category1')
        expect(mockedOctoClient.reorderSidebarCategoryBoards).toHaveBeenCalledWith('team-id', 'category3', ['board1'])
    })

    it('reorders boards within one category', async () => {
        const {boardRow, rowTops} = setup()

        await drag(act, boardRow('board1'), {x: 100, y: rowTops.get('board2')! + 20})

        expect(mockedOctoClient.moveBoardToCategory).not.toHaveBeenCalled()
        expect(mockedOctoClient.reorderSidebarCategoryBoards).toHaveBeenCalledWith('team-id', 'category1', ['board2', 'board1'])
    })

    // A category is dragged by its title row: its middle is a board inside it,
    // which is what a press there would pick up instead.
    it('reorders the categories themselves', async () => {
        const {categoryOf, categoryTops} = setup()

        const first = categoryOf(0)
        await drag(act, first.wrapper, {x: 100, y: categoryTops[1] + 20}, first.header)

        expect(mockedOctoClient.reorderSidebarCategories).toHaveBeenCalledWith('team-id', ['category2', 'category1', 'category3'])
    })
})
