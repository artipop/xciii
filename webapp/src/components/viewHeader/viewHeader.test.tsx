import {render} from '@solidjs/testing-library'

import '@testing-library/jest-dom'

import {TestBlockFactory} from '../../test/testBlockFactory'

import {TestRouter, mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import ViewHeader from './viewHeader'

const board = TestBlockFactory.createBoard()
const activeView = TestBlockFactory.createBoardView(board)
const card = TestBlockFactory.createCard(board)
const card2 = TestBlockFactory.createCard(board)

describe('components/viewHeader/viewHeader', () => {
    const state = {
        users: {
            me: {
                id: 'user-id-1',
                username: 'username_1',
                props: {},
            },
        },
        searchText: {
        },
        teams: {
            current: {id: 'team-id'},
        },
        boards: {
            current: board.id,
            boards: {
                [board.id]: board,
            },
            templates: [],
            myBoardMemberships: {
                [board.id]: {userId: 'user_id_1', schemeAdmin: true},
            },
        },
        cards: {
            templates: [card],
            cards: {
                [card2.id]: card2,
            },
            current: card2.id,
        },
        views: {
            views: {
                boardView: activeView,
            },
            current: 'boardView',
        },
    }
    const store = mockAppStore(state)
    test('return viewHeader', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <TestRouter>
                        <ViewHeader
                            board={board}
                            activeView={activeView}
                            views={[activeView]}
                            cards={[card]}
                            groupByProperty={board.cardProperties[0]}
                            addCard={vi.fn()}
                            addCardFromTemplate={vi.fn()}
                            addCardTemplate={vi.fn()}
                            editCardTemplate={vi.fn()}
                            readonly={false}
                        />
                    </TestRouter>
                </AppStoreProvider>,
            ),
        )
        expect(container).toMatchSnapshot()
    })
    test('return viewHeader without permissions', () => {
        const localStore = mockAppStore({...state, teams: {current: undefined}})
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={localStore}>
                    <TestRouter>
                        <ViewHeader
                            board={board}
                            activeView={activeView}
                            views={[activeView]}
                            cards={[card]}
                            groupByProperty={board.cardProperties[0]}
                            addCard={vi.fn()}
                            addCardFromTemplate={vi.fn()}
                            addCardTemplate={vi.fn()}
                            editCardTemplate={vi.fn()}
                            readonly={false}
                        />
                    </TestRouter>
                </AppStoreProvider>,
            ),
        )
        expect(container).toMatchSnapshot()
    })
    test('return viewHeader readonly', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <TestRouter>
                        <ViewHeader
                            board={board}
                            activeView={activeView}
                            views={[activeView]}
                            cards={[card]}
                            groupByProperty={board.cardProperties[0]}
                            addCard={vi.fn()}
                            addCardFromTemplate={vi.fn()}
                            addCardTemplate={vi.fn()}
                            editCardTemplate={vi.fn()}
                            readonly={true}
                        />
                    </TestRouter>
                </AppStoreProvider>,
            ),
        )
        expect(container).toMatchSnapshot()
    })
})
