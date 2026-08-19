import '@testing-library/jest-dom'
import {render} from '@solidjs/testing-library'

import {TestBlockFactory} from '../../test/testBlockFactory'
import {mockAppStore, mockDOM, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import CardActionsMenu from './cardActionsMenu'

beforeAll(() => {
    mockDOM()
})

describe('components/cardActionsMenu', () => {
    const board = TestBlockFactory.createBoard()
    board.id = 'boardId'

    const state = {
        // "Copy link" is offered where somebody else can open it, which is a
        // team install (docs/teamwork.md).
        clientConfig: {
            value: {teamMode: true},
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
        teams: {
            current: {id: 'team-id'},
        },
        users: {
            me: {
                id: 'user_id_1',
            },
        },
    }
    const store = mockAppStore(state)

    test('should match snapshot', async () => {
        const {container} = render(() => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <CardActionsMenu
                    cardId='123'
                    boardId='345'
                    onClickDelete={vi.fn()}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot w/ onClickDuplicate prop', async () => {
        const {container} = render(() => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <CardActionsMenu
                    cardId='123'
                    boardId='345'
                    onClickDelete={vi.fn()}
                    onClickDuplicate={vi.fn()}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot w/ children prop', async () => {
        const {container} = render(() => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <CardActionsMenu
                    cardId='123'
                    boardId='345'
                    onClickDelete={vi.fn()}
                >
                    {'Test.'}
                </CardActionsMenu>
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })
})
