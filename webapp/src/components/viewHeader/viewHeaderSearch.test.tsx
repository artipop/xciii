// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, screen} from '@solidjs/testing-library'

import '@testing-library/jest-dom'
import userEvent from '@testing-library/user-event'

import {TestRouter, mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import ViewHeaderSearch from './viewHeaderSearch'

describe('components/viewHeader/ViewHeaderSearch', () => {
    const state = {
        users: {
            me: {
                id: 'user-id-1',
                username: 'username_1'},
        },
        searchText: {
        },
    }

    const store = mockAppStore(state)
    beforeEach(() => {
        jest.clearAllMocks()
    })
    test('return search menu', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <TestRouter>
                        <ViewHeaderSearch/>
                    </TestRouter>
                </AppStoreProvider>,
            ),
        )
        expect(container).toMatchSnapshot()
    })
    test('search text after input', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <TestRouter>
                        <ViewHeaderSearch/>
                    </TestRouter>
                </AppStoreProvider>,
            ),
        )
        const elementSearchText = screen.getByPlaceholderText('Search cards')
        userEvent.type(elementSearchText, 'Hello')
        expect(container).toMatchSnapshot()
    })
})
