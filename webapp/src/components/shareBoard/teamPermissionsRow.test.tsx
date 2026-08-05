// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'

import {IUser} from '../../user'
import {TestBlockFactory} from '../../test/testBlockFactory'
import {TestRouter, mockAppStore, wrapDNDIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import {MemberRole} from '../../blocks/board'

import TeamPermissionsRow from './teamPermissionsRow'

vi.useFakeTimers()

const boardId = '1'

vi.mock('../../utils')

const board = TestBlockFactory.createBoard()
board.id = boardId
board.teamId = 'team-id'
board.channelId = 'channel_1'
board.minimumRole = MemberRole.Editor

describe('src/components/shareBoard/teamPermissionsRow', () => {
    const me: IUser = {
        id: 'user-id-1',
        username: 'username_1',
        email: '',
        nickname: '',
        firstname: '',
        lastname: '',
        props: {},
        create_at: 0,
        update_at: 0,
        is_bot: false,
        is_guest: false,
        roles: 'system_user',
    }

    const state = {
        teams: {
            current: {id: 'team-id', title: 'Test Team'},
        },
        users: {
            me,
            boardUsers: [me],
            blockSubscriptions: [],
        },
        boards: {
            current: board.id,
            boards: {
                [board.id]: board,
            },
            templates: [],
            membersInBoards: {
                [board.id]: {},
            },
            myBoardMemberships: {
                [board.id]: {userId: me.id, schemeAdmin: true},
            },
        },
    }

    beforeEach(() => {
        vi.clearAllMocks()
    })

    test('should match snapshot', async () => {
        const store = mockAppStore(state)
        const result = render(() =>
            wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <TeamPermissionsRow/>
                </AppStoreProvider>),
        {wrapper: TestRouter},
        )
        const container = result.container

        const buttonElement = container?.querySelector('.user-item__button')
        expect(buttonElement).toBeDefined()
        userEvent.click(buttonElement!)

        expect(container).toMatchSnapshot()
    })

    test('should match snapshot in plugin mode', async () => {
        const store = mockAppStore(state)
        const result = render(() =>
            wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <TeamPermissionsRow/>
                </AppStoreProvider>),
        {wrapper: TestRouter},
        )
        const container = result.container

        const buttonElement = container?.querySelector('.user-item__button')
        expect(buttonElement).toBeDefined()
        userEvent.click(buttonElement!)

        expect(container).toMatchSnapshot()
    })

    test('should match snapshot in template', async () => {
        const testState = {
            ...state,
            boards: {
                ...state.boards,
                boards: {},
                templates: {
                    [board.id]: {...board, isTemplate: true},
                },
            },
        }
        const store = mockAppStore(testState)
        const result = render(() =>
            wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <TeamPermissionsRow/>
                </AppStoreProvider>),
        {wrapper: TestRouter},
        )
        const container = result.container

        const buttonElement = container?.querySelector('.user-item__button')
        expect(buttonElement).toBeDefined()
        userEvent.click(buttonElement!)

        expect(container).toMatchSnapshot()
    })
})
