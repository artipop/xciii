// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {render} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'

import {TestRouter, mockAppStore, mockMatchMedia, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import {TestBlockFactory} from '../../test/testBlockFactory'
import octoClient from '../../../../webapp/src/octoClient'
import {CategoryBoards} from '../../store/sidebar'

import Sidebar, {sidebarDropResult} from './sidebar'

vi.mock('../../octoClient')
const mockedOctoClient = vi.mocked(octoClient)

beforeAll(() => {
    mockMatchMedia({matches: true})
})

describe('components/sidebarSidebar', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    const board = TestBlockFactory.createBoard()
    board.id = 'board1'

    const categoryAttribute1 = TestBlockFactory.createCategoryBoards()
    categoryAttribute1.id = 'category1'
    categoryAttribute1.name = 'Category 1'
    categoryAttribute1.boardMetadata = [{boardID: board.id, hidden: false}]

    // The category the server makes for boards nobody has filed: it is the one
    // of type 'system', and its name is the server's own English, which is why
    // the fixture gives it a different one -- nothing may find it by name.
    const defaultCategory = TestBlockFactory.createCategoryBoards()
    defaultCategory.id = 'default_category'
    defaultCategory.name = 'Whatever the server called it'
    defaultCategory.type = 'system'
    defaultCategory.boardMetadata = []

    test('sidebar hidden', () => {
        const store = mockAppStore({
            teams: {
                current: {id: 'team-id'},
            },
            boards: {
                current: board.id,
                boards: {
                    [board.id]: board,
                },
                myBoardMemberships: {
                    [board.id]: board,
                },
            },
            cards: {
                cards: {
                    card_id_1: {title: 'Card'},
                },
                current: 'card_id_1',
            },
            views: {
                views: [],
            },
            users: {
                me: {
                    id: 'user_id_1',
                    props: {},
                },
            },
            sidebar: {
                categoryAttributes: [
                    categoryAttribute1,
                ],
                hiddenBoardIDs: [],
            },
        }, {client: mockedOctoClient as any})
        const onBoardTemplateSelectorOpen = vi.fn()

        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <Sidebar onBoardTemplateSelectorOpen={onBoardTemplateSelectorOpen}/>
                </TestRouter>
            </AppStoreProvider>,
        )
        const {container} = render(component)
        expect(container).toMatchSnapshot()

        const hideSidebar = container.querySelector('button > .HideSidebarIcon')
        expect(hideSidebar).toBeDefined()

        userEvent.click(hideSidebar as Element)
        expect(container).toMatchSnapshot()

        const showSidebar = container.querySelector('button > .ShowSidebarIcon')
        expect(showSidebar).toBeDefined()
    })

    test('sidebar expect hidden', () => {
        const customGlobal = global as any

        customGlobal.innerWidth = 500

        const localCategoryAttribute = TestBlockFactory.createCategoryBoards()
        localCategoryAttribute.id = 'category1'
        localCategoryAttribute.name = 'Category 1'
        categoryAttribute1.boardMetadata = [{boardID: board.id, hidden: false}]

        const store = mockAppStore({
            teams: {
                current: {id: 'team-id'},
            },
            boards: {
                current: board.id,
                boards: {
                    [board.id]: board,
                },
                myBoardMemberships: {
                    [board.id]: board,
                },
            },
            cards: {
                cards: {
                    card_id_1: {title: 'Card'},
                },
                current: 'card_id_1',
            },
            views: {
                views: [],
            },
            users: {
                me: {
                    id: 'user_id_1',
                    props: {},
                },
            },
            sidebar: {
                categoryAttributes: [
                    categoryAttribute1,
                ],
                hiddenBoardIDs: [],
            },
        }, {client: mockedOctoClient as any})
        const onBoardTemplateSelectorOpen = vi.fn()

        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <Sidebar onBoardTemplateSelectorOpen={onBoardTemplateSelectorOpen}/>
                </TestRouter>
            </AppStoreProvider>,
        )
        const {container} = render(component)
        expect(container).toMatchSnapshot()

        const hideSidebar = container.querySelector('button > .HideSidebarIcon')
        expect(hideSidebar).toBeNull()

        const showSidebar = container.querySelector('button > .ShowSidebarIcon')
        expect(showSidebar).toBeDefined()

        customGlobal.innerWidth = 1024
    })

    test('dont show hidden boards', () => {
        const localCategoryAttribute = TestBlockFactory.createCategoryBoards()
        localCategoryAttribute.id = 'category1'
        localCategoryAttribute.name = 'Category 1'
        localCategoryAttribute.boardMetadata = [{boardID: board.id, hidden: true}]

        const store = mockAppStore({
            teams: {
                current: {id: 'team-id'},
            },
            boards: {
                current: board.id,
                boards: {
                    [board.id]: board,
                },
                myBoardMemberships: {
                    [board.id]: board,
                },
            },
            cards: {
                cards: {
                    card_id_1: {title: 'Card'},
                },
                current: 'card_id_1',
            },
            views: {
                views: [],
            },
            users: {
                me: {
                    id: 'user_id_1',
                },
                myConfig: {
                    hiddenBoardIDs: {value: {
                        [board.id]: true,
                    }},
                },
            },
            sidebar: {
                categoryAttributes: [
                    localCategoryAttribute,
                ],
                hiddenBoardIDs: [board.id],
            },
        })
        const onBoardTemplateSelectorOpen = vi.fn()

        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <Sidebar onBoardTemplateSelectorOpen={onBoardTemplateSelectorOpen}/>
                </TestRouter>
            </AppStoreProvider>,
        )
        const {container, getAllByText} = render(component)
        expect(container).toMatchSnapshot()

        const sidebarBoards = container.getElementsByClassName('SidebarBoardItem')

        // The only board in redux store is hidden, so there should
        // be no boards visible in sidebar
        expect(sidebarBoards.length).toBe(0)

        const noBoardsText = getAllByText('No boards inside')
        expect(noBoardsText.length).toBe(1)
    })

    test('some categories hidden', () => {
        const collapsedCategory = TestBlockFactory.createCategoryBoards()
        collapsedCategory.id = 'categoryCollapsed'
        collapsedCategory.name = 'Category 2'
        collapsedCategory.collapsed = true
        collapsedCategory.boardMetadata = []

        const store = mockAppStore({
            teams: {
                current: {id: 'team-id'},
            },
            boards: {
                current: board.id,
                boards: {
                    [board.id]: board,
                },
                myBoardMemberships: {
                    [board.id]: board,
                },
            },
            cards: {
                cards: {
                    card_id_1: {title: 'Card'},
                },
                current: 'card_id_1',
            },
            views: {
                views: [],
            },
            users: {
                me: {
                    id: 'user_id_1',
                    props: {},
                },
            },
            sidebar: {
                categoryAttributes: [
                    categoryAttribute1,
                    collapsedCategory,
                ],
                hiddenBoardIDs: [],
            },
        }, {client: mockedOctoClient as any})
        const onBoardTemplateSelectorOpen = vi.fn()

        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <Sidebar onBoardTemplateSelectorOpen={onBoardTemplateSelectorOpen}/>
                </TestRouter>
            </AppStoreProvider>,
        )
        const {container} = render(component)
        expect(container).toMatchSnapshot()

        const sidebarCollapsedCategory = container.querySelectorAll('.octo-sidebar-item.category.collapsed')
        expect(sidebarCollapsedCategory.length).toBe(1)
    })

    test('a board in no category is filed under the default one, found by its type', () => {
        const board2 = TestBlockFactory.createBoard()
        board2.id = 'board2'

        const store = mockAppStore({
            teams: {
                current: {id: 'team-id'},
            },
            boards: {
                current: board2.id,
                boards: {
                    [board2.id]: board2,
                },
                myBoardMemberships: {
                    [board2.id]: board2,
                },
            },
            cards: {
                cards: {
                    card_id_1: {title: 'Card'},
                },
                current: 'card_id_1',
            },
            views: {
                views: [],
            },
            users: {
                me: {
                    id: 'user_id_1',
                    props: {},
                },
            },
            sidebar: {
                categoryAttributes: [
                    categoryAttribute1,
                    defaultCategory,
                ],
                hiddenBoardIDs: [],
            },
        }, {client: mockedOctoClient as any})
        const onBoardTemplateSelectorOpen = vi.fn()

        mockedOctoClient.moveBoardToCategory.mockResolvedValueOnce({} as Response)

        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <Sidebar onBoardTemplateSelectorOpen={onBoardTemplateSelectorOpen}/>
                </TestRouter>
            </AppStoreProvider>,
        )
        const {container} = render(component)
        expect(container).toMatchSnapshot()

        expect(mockedOctoClient.moveBoardToCategory).toHaveBeenCalledWith('team-id', 'board2', 'default_category', '')
    })

    test('shouldnt do any category assignment is board is in a category', () => {
        const board2 = TestBlockFactory.createBoard()
        board2.id = 'board2'

        const categoryAttribute2 = TestBlockFactory.createCategoryBoards()
        categoryAttribute2.id = 'category2'
        categoryAttribute2.name = 'Category 2'
        categoryAttribute2.boardMetadata = [{boardID: board2.id, hidden: false}]

        const store = mockAppStore({
            teams: {
                current: {id: 'team-id'},
            },
            boards: {
                current: board2.id,
                boards: {
                    [board2.id]: board2,
                },
                myBoardMemberships: {
                    [board2.id]: board2,
                },
            },
            cards: {
                cards: {
                    card_id_1: {title: 'Card'},
                },
                current: 'card_id_1',
            },
            views: {
                views: [],
            },
            users: {
                me: {
                    id: 'user_id_1',
                    props: {},
                },
            },
            sidebar: {
                categoryAttributes: [
                    categoryAttribute1,
                    categoryAttribute2,
                    defaultCategory,
                ],
            },
        }, {client: mockedOctoClient as any})
        const onBoardTemplateSelectorOpen = vi.fn()

        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <Sidebar onBoardTemplateSelectorOpen={onBoardTemplateSelectorOpen}/>
                </TestRouter>
            </AppStoreProvider>,
        )
        const {container} = render(component)
        expect(container).toMatchSnapshot()

        expect(mockedOctoClient.moveBoardToCategory).toHaveBeenCalledTimes(0)
    })

    // TODO: Fix this later
    // test('global templates', () => {
    //     const store = mockAppStore({
    //         teams: {
    //             current: {id: 'team-id'},
    //         },
    //         boards: {
    //             boards: [],
    //             templates: [
    //                 {id: '1', title: 'Template 1', fields: {icon: '🚴🏻‍♂️'}},
    //                 {id: '2', title: 'Template 2', fields: {icon: '🚴🏻‍♂️'}},
    //                 {id: '3', title: 'Template 3', fields: {icon: '🚴🏻‍♂️'}},
    //                 {id: '4', title: 'Template 4', fields: {icon: '🚴🏻‍♂️'}},
    //             ],
    //         },
    //         views: {
    //             views: [],
    //         },
    //         users: {
    //             me: {},
    //         },
    //         globalTemplates: {
    //             value: [],
    //         },
    //         sidebar: {
    //             categoryAttributes: [
    //                 categoryAttribute1,
    //             ],
    //         },
    //     }, {client: mockedOctoClient as any})

    //     const history = createMemoryHistory()

    //     const component = () => wrapIntl(
    //         <AppStoreProvider store={store}>
    //             <TestRouter>
    //                 <Sidebar onBoardTemplateSelectorOpen={onBoardTemplateSelectorOpen}/>
    //             </TestRouter>
    //         </AppStoreProvider>,
    //     )
    //     const {container} = render(component)
    //     expect(container).toMatchSnapshot()

    //     const addBoardButton = container.querySelector('.SidebarAddBoardMenu > .MenuWrapper')
    //     expect(addBoardButton).toBeDefined()
    //     userEvent.click(addBoardButton as Element)
    //     const templates = container.querySelectorAll('.SidebarAddBoardMenu > .MenuWrapper div:not(.hideOnWidescreen).menu-options .menu-name')
    //     expect(templates).toBeDefined()

    //     console.log(templates[0].innerHTML)
    //     console.log(templates[1].innerHTML)

    //     // 4 mocked templates, one "Select a template", one "Empty Board" and one "+ New Template"
    //     expect(templates.length).toBe(7)
    // })
})

// The drag itself needs a pointer and real geometry, which jsdom has neither of.
// What is testable, and what broke, is the step between: reading a finished
// dnd-kit operation as the drop the sidebar's handlers act on.
describe('components/sidebarSidebar drops', () => {
    const categoryWithHiddenBoard: CategoryBoards = {
        ...TestBlockFactory.createCategoryBoards(),
        id: 'category1',
        name: 'Category 1',
        boardMetadata: [
            {boardID: 'hidden_board', hidden: true},
            {boardID: 'board1', hidden: false},
        ],
    }

    const otherCategory: CategoryBoards = {
        ...TestBlockFactory.createCategoryBoards(),
        id: 'category2',
        name: 'Category 2',
        boardMetadata: [{boardID: 'board2', hidden: false}],
    }

    const emptyCategory: CategoryBoards = {
        ...TestBlockFactory.createCategoryBoards(),
        id: 'category3',
        name: 'Category 3',
        boardMetadata: [],
    }

    const categories = [categoryWithHiddenBoard, otherCategory, emptyCategory]

    // The bug this covers: the destination used to be read off the dragged item,
    // which without dnd-kit's optimistic sorting never leaves where it started,
    // so a board dropped on another category reported its own category back and
    // the move was discarded as a drop in place.
    test('a board dropped on a board in another category moves to that category', () => {
        const result = sidebarDropResult(
            categories,
            {id: 'board1', type: 'board', index: 0, group: 'category1'},
            {id: 'board2', index: 0, group: 'category2', centerY: 100},
            90,
        )

        expect(result?.source).toStrictEqual({index: 1, droppableId: 'category1'})
        expect(result?.destination).toStrictEqual({index: 0, droppableId: 'category2'})
    })

    // Coming from another category the board is inserted rather than swapped
    // into place, so the half of the target it was released over is what says
    // on which side of it the board belongs -- the same rule dnd-kit's own
    // sortable follows, and the one react-beautiful-dnd followed before it.
    test('a board dropped on the lower half of a board in another category lands under it', () => {
        const result = sidebarDropResult(
            categories,
            {id: 'board1', type: 'board', index: 0, group: 'category1'},
            {id: 'board2', index: 0, group: 'category2', centerY: 100},
            110,
        )

        expect(result?.destination).toStrictEqual({index: 1, droppableId: 'category2'})
    })

    // Within one category nothing is inserted: the list closes behind the board
    // and reopens at the target's index, so both halves mean the same place.
    test('a board reordered within its category ignores which half it was dropped on', () => {
        const dropped = (pointerY: number) => sidebarDropResult(
            categories,
            {id: 'hidden_board', type: 'board', index: 0, group: 'category1'},
            {id: 'board1', index: 1, group: 'category1', centerY: 100},
            pointerY,
        )

        expect(dropped(90)?.destination).toStrictEqual({index: 1, droppableId: 'category1'})
        expect(dropped(110)?.destination).toStrictEqual({index: 1, droppableId: 'category1'})
    })

    // A category holding no boards has no board to drop onto, so it offers a
    // drop zone of its own -- the only way a board ever gets into one.
    test('a board dropped on an empty category is appended to it', () => {
        const result = sidebarDropResult(
            categories,
            {id: 'board1', type: 'board', index: 0, group: 'category1'},
            {id: 'category-boards-category3', categoryID: 'category3'},
        )

        expect(result?.destination).toStrictEqual({index: 0, droppableId: 'category3'})
    })

    // The drop zone covers the whole category, boards included, so a board
    // released over a category but past its boards lands at the end of it.
    test('a board dropped on a category rather than on a board in it goes last', () => {
        const result = sidebarDropResult(
            categories,
            {id: 'board1', type: 'board', index: 0, group: 'category1'},
            {id: 'category-boards-category2', categoryID: 'category2'},
        )

        expect(result?.destination).toStrictEqual({index: 1, droppableId: 'category2'})
    })

    // Positions are reported against boardMetadata, which the handlers splice;
    // the index dnd-kit knows counts only the boards the sidebar drew, and the
    // two part company as soon as a category holds a hidden board.
    test('a board reordered within its category is placed by its position in the category, not on screen', () => {
        const result = sidebarDropResult(
            categories,
            {id: 'board1', type: 'board', index: 0, group: 'category1'},
            {id: 'hidden_board', index: 0, group: 'category1'},
        )

        expect(result?.source).toStrictEqual({index: 1, droppableId: 'category1'})
        expect(result?.destination).toStrictEqual({index: 0, droppableId: 'category1'})
    })

    test('a category dropped on another category takes its place', () => {
        const result = sidebarDropResult(
            categories,
            {id: 'category3', type: 'category', index: 2},
            {id: 'category1', index: 0},
        )

        expect(result?.source).toStrictEqual({index: 2, droppableId: 'lhs-categories'})
        expect(result?.destination).toStrictEqual({index: 0, droppableId: 'lhs-categories'})
    })

    // The sidebar shares one drag-and-drop provider with the boards, so every
    // card dropped anywhere in the application is announced to it as well.
    test('a drop of anything the sidebar does not own is not a sidebar drop', () => {
        const result = sidebarDropResult(
            categories,
            {id: 'card1', type: 'card', index: 0, group: 'option1'},
            {id: 'card2', index: 1, group: 'option2'},
        )

        expect(result).toBeUndefined()
    })
})
