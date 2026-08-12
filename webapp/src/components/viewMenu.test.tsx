import '@testing-library/jest-dom'
import {render} from '@solidjs/testing-library'
import 'isomorphic-fetch'

import {FetchMock} from '../test/fetchMock'
import {TestBlockFactory} from '../test/testBlockFactory'
import {TestRouter, mockAppStore, wrapDNDIntl} from '../testUtils'
import {AppStoreProvider} from '../store'

import ViewMenu from './viewMenu'

global.fetch = FetchMock.fn

beforeEach(() => {
    FetchMock.fn.mockReset()
})

describe('/components/viewMenu', () => {
    const board = TestBlockFactory.createBoard()
    const boardView = TestBlockFactory.createBoardView(board)
    const tableView = TestBlockFactory.createTableView(board)
    const activeView = boardView
    const views = [boardView, tableView]

    const card = TestBlockFactory.createCard(board)
    activeView.fields.viewType = 'table'
    activeView.fields.groupById = undefined
    activeView.fields.visiblePropertyIds = ['property1', 'property2']

    const state = {
        users: {
            me: {
                id: 'user-id-1',
                username: 'username_1',
            },
        },
        searchText: {},
        teams: {
            current: {id: 'team-id'},
        },
        boards: {
            current: board.id,
            boards: {
                [board.id]: board,
            },
            myBoardMemberships: {
                [board.id]: {userId: 'user_id_1', schemeAdmin: true},
            },
        },
        cards: {
            templates: [card],
        },
        views: {
            views: {
                boardView: activeView,
            },
            current: 'boardView',
        },
        clientConfig: {},
    }

    it('should match snapshot', () => {
        const store = mockAppStore(state)

        const component = () => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <ViewMenu
                        board={board}
                        activeView={activeView}
                        views={views}
                        readonly={false}
                    />
                </TestRouter>
            </AppStoreProvider>,
        )

        const container = render(component)
        expect(container).toMatchSnapshot()
    })

    it('should match snapshot, read only', () => {
        const store = mockAppStore(state)

        const component = () => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <ViewMenu
                        board={board}
                        activeView={activeView}
                        views={views}
                        readonly={true}
                    />
                </TestRouter>
            </AppStoreProvider>,
        )

        const container = render(component)
        expect(container).toMatchSnapshot()
    })
})
