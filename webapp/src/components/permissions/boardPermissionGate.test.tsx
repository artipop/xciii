import {render} from '@solidjs/testing-library'

import '@testing-library/jest-dom'

import {TestBlockFactory} from '../../test/testBlockFactory'
import {Permission} from '../../constants'

import {mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import BoardPermissionGate from './boardPermissionGate'

const board = TestBlockFactory.createBoard()

describe('components/permission/boardPermissionGate', () => {
    const state = {
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
    }
    const store = mockAppStore(state)
    test('match snapshot when the user has the permissions', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <BoardPermissionGate
                        permissions={[Permission.ManageBoardCards]}
                    >
                        {'Content'}
                    </BoardPermissionGate>
                </AppStoreProvider>,
            ),
        )
        expect(container).toMatchSnapshot()
    })

    test('match snapshot when the user has the permissions with invert', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <BoardPermissionGate
                        permissions={[Permission.ManageBoardCards]}
                        invert={true}
                    >
                        {'Content'}
                    </BoardPermissionGate>
                </AppStoreProvider>,
            ),
        )
        expect(container).toMatchSnapshot()
    })

    test('match snapshot when the user doesnt have the permissions', () => {
        const localStore = mockAppStore({...state, teams: {current: undefined}})
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={localStore}>
                    <BoardPermissionGate
                        permissions={[Permission.ManageBoardCards]}
                    >
                        {'Content'}
                    </BoardPermissionGate>
                </AppStoreProvider>,
            ),
        )
        expect(container).toMatchSnapshot()
    })

    test('match snapshot when the user doesnt have the permissions with invert', () => {
        const localStore = mockAppStore({...state, teams: {current: undefined}})
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={localStore}>
                    <BoardPermissionGate
                        permissions={[Permission.ManageBoardCards]}
                        invert={true}
                    >
                        {'Content'}
                    </BoardPermissionGate>
                </AppStoreProvider>,
            ),
        )
        expect(container).toMatchSnapshot()
    })
})
