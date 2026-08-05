// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {fireEvent, render, screen} from '@solidjs/testing-library'

import {mockAppStore, mockDOM, wrapDNDIntl} from '../testUtils'
import {AppStoreProvider} from '../store'

import {TestBlockFactory} from '../test/testBlockFactory'

import {MarkdownEditor} from './markdownEditor'

vi.mock('../utils')

describe('components/markdownEditor', () => {
    beforeAll(mockDOM)
    beforeEach(vi.clearAllMocks)

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

    test('should match snapshot', async () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <MarkdownEditor
                    id={'test-id'}
                    text={''}
                    placeholderText={'placeholder'}
                    class={'classname-test'}
                    readonly={false}
                    onChange={vi.fn()}
                    onFocus={vi.fn()}
                    onBlur={vi.fn()}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot with initial text', async () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <MarkdownEditor
                    id={'test-id'}
                    text={'some initial text already set'}
                    placeholderText={'placeholder'}
                    class={'classname-test'}
                    readonly={false}
                    onChange={vi.fn()}
                    onFocus={vi.fn()}
                    onBlur={vi.fn()}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot with on click on preview element', async () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <MarkdownEditor
                    id={'test-id'}
                    text={'some initial text already set'}
                    placeholderText={'placeholder'}
                    class={'classname-test'}
                    readonly={false}
                    onChange={vi.fn()}
                    onFocus={vi.fn()}
                    onBlur={vi.fn()}
                />
            </AppStoreProvider>,
        ))
        fireEvent.click(screen.getByTestId('preview-element'))

        // The input is a lazy chunk; the editor appears when it resolves.
        await screen.findByRole('textbox')
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot with on click on preview element and then click out of it', async () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <MarkdownEditor
                    id={'test-id'}
                    text={'some initial text already set'}
                    placeholderText={'placeholder'}
                    class={'classname-test'}
                    readonly={false}
                    onChange={vi.fn()}
                    onFocus={vi.fn()}
                    onBlur={vi.fn()}
                />
            </AppStoreProvider>,
        ))
        fireEvent.click(screen.getByTestId('preview-element'))
        const textbox = await screen.findByRole('textbox')
        fireEvent.keyDown(textbox, {
            key: 'Escape',
            code: 'Escape',
            keyCode: 27,
            charCode: 27,
        })
        expect(container).toMatchSnapshot()
    })
})
