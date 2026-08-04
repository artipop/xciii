// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {render} from '@solidjs/testing-library'

import {mockAppStore, mockDOM, wrapDNDIntl} from '../../../../testUtils'
import {AppStoreProvider} from '../../../../store'
import {TestBlockFactory} from '../../../../test/testBlockFactory'

import TextBlock from '.'

describe('components/blocksEditor/blocks/text', () => {
    beforeEach(mockDOM)

    const board1 = TestBlockFactory.createBoard()
    board1.id = 'board-id-1'

    const state = {
        users: {
            boardUsers: {
                1: {username: 'abc'},
                2: {username: 'd'},
                3: {username: 'e'},
                4: {username: 'f'},
                5: {username: 'g'},
            },
        },
        boards: {
            current: 'board-id-1',
            boards: {
                [board1.id]: board1,
            },
        },
        clientConfig: {
            value: {},
        },
    }
    const store = mockAppStore(state)

    test('should match Display snapshot', async () => {
        const Component = TextBlock.Display
        const {container} = render(wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <Component
                    onChange={jest.fn()}
                    value='test-value'
                    onCancel={jest.fn()}
                    onSave={jest.fn()}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })

    test('should match Input snapshot', async () => {
        const Component = TextBlock.Input
        const {container} = render(wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <Component
                    onChange={jest.fn()}
                    value='test-value'
                    onCancel={jest.fn()}
                    onSave={jest.fn()}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })
})
