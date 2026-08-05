// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {render} from '@solidjs/testing-library'

import {Team} from '../../store/teams'
import {TestBlockFactory} from '../../test/testBlockFactory'

import {TestRouter, mockAppStore, wrapDNDIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import BoardSwitcherDialog from './boardSwitcherDialog'

describe('component/BoardSwitcherDialog', () => {
    const team1: Team = {
        id: 'team-id-1',
        title: 'Dunder Mifflin',
        signupToken: '',
        updateAt: 0,
        modifiedBy: 'michael-scott',
    }

    const team2: Team = {
        id: 'team-id-2',
        title: 'Michael Scott Paper Company',
        signupToken: '',
        updateAt: 0,
        modifiedBy: 'michael-scott',
    }

    const me = TestBlockFactory.createUser()

    const state = {
        users: {
            me,
        },
        teams: {
            allTeams: [team1, team2],
            current: team1,
        },
    }

    let store: ReturnType<typeof mockAppStore>

    beforeEach(() => {
        store = mockAppStore(state)
    })

    test('base case', () => {
        const onCloseHandler = jest.fn()
        const component = () => wrapDNDIntl(() =>
            <TestRouter>
                <AppStoreProvider store={store}>
                    <BoardSwitcherDialog onClose={onCloseHandler}/>
                </AppStoreProvider>
            </TestRouter>,
        )

        const {container} = render(component)
        expect(container).toMatchSnapshot()
    })
})
