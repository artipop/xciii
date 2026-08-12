import {createSignal} from 'solid-js'
import {render} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'

import {TestBlockFactory} from '../../test/testBlockFactory'

import {TestRouter, mockAppStore, wrapIntl, wrapRBDNDDroppable} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import SidebarCategory from './sidebarCategory'

describe('components/sidebarCategory', () => {
    const board = TestBlockFactory.createBoard()
    board.id = 'board_id'

    const view = TestBlockFactory.createBoardView(board)
    view.fields.sortOptions = []

    const board1 = TestBlockFactory.createBoard()
    board1.id = 'board_1_id'

    const board2 = TestBlockFactory.createBoard()
    board2.id = 'board_2_id'

    const boards = [board1, board2]
    const categoryBoards1 = TestBlockFactory.createCategoryBoards()
    categoryBoards1.id = 'category_1_id'
    categoryBoards1.name = 'Category 1'
    categoryBoards1.boardMetadata = [{boardID: board1.id, hidden: false}, {boardID: board2.id, hidden: false}]

    const categoryBoards2 = TestBlockFactory.createCategoryBoards()
    categoryBoards2.id = 'category_2_id'
    categoryBoards2.name = 'Category 2'

    const categoryBoards3 = TestBlockFactory.createCategoryBoards()
    categoryBoards3.id = 'category_id_3'
    categoryBoards3.name = 'Category 3'

    const allCategoryBoards = [
        categoryBoards1,
        categoryBoards2,
        categoryBoards3,
    ]

    const state = {
        users: {
            me: {
                id: 'user_id_1',
                props: {},
            },
        },
        boards: {
            current: board.id,
            boards: {
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
            current: view.id,
            views: {
                [view.id]: view,
            },
        },
        teams: {
            current: {
                id: 'team-id',
            },
        },
    }

    test('sidebar call hideSidebar', () => {
        const store = mockAppStore(state)

        const component = wrapRBDNDDroppable(wrapIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <SidebarCategory
                        hideSidebar={() => {}}
                        categoryBoards={categoryBoards1}
                        boards={boards}
                        allCategories={allCategoryBoards}
                        index={0}
                    />
                </TestRouter>
            </AppStoreProvider>,
        ))
        const {container} = render(component)
        expect(container).toMatchSnapshot()

        // testing collapsed state of category
        const subItems = container.querySelectorAll('.category')
        expect(subItems).toBeDefined()
        userEvent.click(subItems[0] as Element)
        expect(container).toMatchSnapshot()
    })

    test('sidebar collapsed without active board', () => {
        const store = mockAppStore(state)

        const component = wrapRBDNDDroppable(wrapIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <SidebarCategory
                        hideSidebar={() => {}}
                        categoryBoards={categoryBoards1}
                        boards={boards}
                        allCategories={allCategoryBoards}
                        index={0}
                    />
                </TestRouter>
            </AppStoreProvider>,
        ))
        const {container} = render(component)

        const subItems = container.querySelectorAll('.category-title')
        expect(subItems).toBeDefined()
        userEvent.click(subItems[0] as Element)
        expect(container).toMatchSnapshot()
    })

    test('sidebar collapsed with active board in it', () => {
        const store = mockAppStore(state)

        const component = wrapRBDNDDroppable(wrapIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <SidebarCategory
                        hideSidebar={() => {}}
                        activeBoardID={board1.id}
                        categoryBoards={categoryBoards1}
                        boards={boards}
                        allCategories={allCategoryBoards}
                        index={0}
                    />
                </TestRouter>
            </AppStoreProvider>,
        ))
        const {container} = render(component)

        const subItems = container.querySelectorAll('.category-title')
        expect(subItems).toBeDefined()
        userEvent.click(subItems[0] as Element)
        expect(container).toMatchSnapshot()
    })

    test('sidebar template close self', () => {
        const store = mockAppStore(state)

        const mockTemplateClose = vi.fn()

        const component = wrapRBDNDDroppable(wrapIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <SidebarCategory
                        activeBoardID={board1.id}
                        hideSidebar={() => {}}
                        categoryBoards={categoryBoards1}
                        boards={boards}
                        allCategories={allCategoryBoards}
                        index={0}
                        onBoardTemplateSelectorClose={mockTemplateClose}
                    />
                </TestRouter>
            </AppStoreProvider>,
        ))
        const {container} = render(component)
        expect(container).toMatchSnapshot()

        // testing collapsed state of category
        const subItems = container.querySelectorAll('.subitem')
        expect(subItems).toBeDefined()
        userEvent.click(subItems[0] as Element)
        expect(mockTemplateClose).toHaveBeenCalled()
    })

    test('sidebar template close other', () => {
        const store = mockAppStore(state)

        const mockTemplateClose = vi.fn()

        const component = wrapRBDNDDroppable(wrapIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <SidebarCategory
                        activeBoardID={board2.id}
                        hideSidebar={() => {}}
                        categoryBoards={categoryBoards1}
                        boards={boards}
                        allCategories={allCategoryBoards}
                        index={0}
                        onBoardTemplateSelectorClose={mockTemplateClose}
                    />
                </TestRouter>
            </AppStoreProvider>,
        ))
        const {container} = render(component)
        expect(container).toMatchSnapshot()

        // testing collapsed state of category
        const subItems = container.querySelectorAll('.category-title')
        expect(subItems).toBeDefined()
        userEvent.click(subItems[0] as Element)
        expect(mockTemplateClose).not.toHaveBeenCalled()
    })

    // The category the server makes for unfiled boards is named in the server's
    // own English, which nobody chose and nobody can change. The sidebar reads
    // in the language of the page, so the name has to come from the catalogue.
    test('the default category is named by the page and not by the server', () => {
        const store = mockAppStore(state)

        const systemCategory = {
            ...TestBlockFactory.createCategoryBoards(),
            id: 'default_category',
            name: 'Whatever the server called it',
            type: 'system' as const,
            boardMetadata: [],
        }

        const component = wrapRBDNDDroppable(wrapIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <SidebarCategory
                        hideSidebar={() => {}}
                        categoryBoards={systemCategory}
                        boards={[]}
                        allCategories={[systemCategory]}
                        index={0}
                    />
                </TestRouter>
            </AppStoreProvider>,
        ))
        const {container, queryByText} = render(component)

        expect(queryByText('Whatever the server called it')).toBeNull()
        expect(container.querySelector('.category-title')?.textContent).toContain('Boards')
    })

    // A collapse is persisted and comes back as an update of the category, so
    // the row has to take the answer it is handed. It used to keep its own, and
    // an update rebuilt the row from a category the store had not been told
    // about -- which is how every collapse undid itself a moment later.
    test('a category collapsed elsewhere collapses here', () => {
        const store = mockAppStore(state)
        const [category, setCategory] = createSignal(categoryBoards1)

        const component = wrapRBDNDDroppable(wrapIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <SidebarCategory
                        hideSidebar={() => {}}
                        categoryBoards={category()}
                        boards={boards}
                        allCategories={allCategoryBoards}
                        index={0}
                    />
                </TestRouter>
            </AppStoreProvider>,
        ))
        const {container} = render(component)
        expect(container.querySelector('.octo-sidebar-item.category.collapsed')).toBeNull()

        setCategory({...categoryBoards1, collapsed: true})

        expect(container.querySelector('.octo-sidebar-item.category.collapsed')).not.toBeNull()
    })
})
