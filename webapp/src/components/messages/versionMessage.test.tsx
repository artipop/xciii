// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {render, screen} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'

import {IUser} from '../../user'

import {mockAppStore, wrapIntl} from '../../testUtils'
import {AppStore, AppStoreProvider} from '../../store'

import client from '../../octoClient'

import {versionProperty} from '../../store/users'

import VersionMessage from './versionMessage'

vi.mock('../../octoClient')
const mockedOctoClient = vi.mocked(client)

describe('components/messages/VersionMessage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    const renderMessage = (store: AppStore) => render(() => wrapIntl(() =>
        <AppStoreProvider store={store}>
            <VersionMessage/>
        </AppStoreProvider>,
    ))

    const user = (id: string): IUser => ({
        id,
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
    })

    if (versionProperty) {
        test('single user mode, no display', () => {
            const store = mockAppStore({users: {me: user('single-user')}})
            renderMessage(store)
            expect(screen.queryByText(/what's new/)).toBeNull()
        })

        test('property set, no message', () => {
            const store = mockAppStore({
                users: {
                    me: user('user-id-1'),
                    myConfig: {
                        [versionProperty]: {value: 'true'},
                    } as any,
                },
            })
            renderMessage(store)
            expect(screen.queryByText(/what's new/)).toBeNull()
        })

        test('show message, click close', () => {
            const store = mockAppStore({users: {me: user('user-id-1')}})
            renderMessage(store)
            const buttonElement = screen.getByRole('button', {name: 'Close dialog'})
            userEvent.click(buttonElement)
            expect(mockedOctoClient.patchUserConfig).toHaveBeenCalledWith('user-id-1', {
                updatedFields: {
                    [versionProperty]: 'true',
                },
            })
        })

        test('no me, no message', () => {
            const store = mockAppStore({users: {}})
            renderMessage(store)
            expect(screen.queryByText(/what's new/)).toBeNull()
        })
    } else {
        test('no version, does not display', () => {
            const store = mockAppStore({users: {me: user('user-id-1')}})
            renderMessage(store)
            expect(screen.queryByText(/what's new/)).toBeNull()
        })
    }
})
