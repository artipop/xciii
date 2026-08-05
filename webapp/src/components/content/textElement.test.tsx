// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {render} from '@solidjs/testing-library'

import '@testing-library/jest-dom'

import {TextBlock} from '../../blocks/textBlock'

import {mockAppStore, mockDOM, wrapDNDIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import {Utils} from '../../utils'

import {TestBlockFactory} from '../../test/testBlockFactory'

import TextElement from './textElement'

vi.mock('../../utils')
vi.mock('../../mutator')
const mockedUtils = vi.mocked(Utils)
mockedUtils.createGuid.mockReturnValue('test-id')
const defaultBlock: TextBlock = {
    id: 'test-id',
    boardId: 'test-id',
    parentId: 'test-id',
    modifiedBy: 'test-user-id',
    schema: 0,
    type: 'text',
    title: '',
    fields: {},
    createdBy: 'test-user-id',
    createAt: 0,
    updateAt: 0,
    deleteAt: 0,
    limited: false,
}
describe('components/content/TextElement', () => {
    beforeAll(() => {
        mockDOM()
    })

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

    test('return a textElement', async () => {
        const component = () => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <TextElement
                    block={defaultBlock}
                    readonly={false}
                />
            </AppStoreProvider>,
        )

        const {container} = render(component)
        expect(container).toMatchSnapshot()
    })
})
