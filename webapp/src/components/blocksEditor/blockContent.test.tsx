// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {render, screen, fireEvent} from '@solidjs/testing-library'

import {mockAppStore, mockDOM, wrapDNDIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'
import {TestBlockFactory} from '../../test/testBlockFactory'

import BlockContent from './blockContent'

describe('components/blocksEditor/blockContent', () => {
    beforeEach(mockDOM)

    const block = {id: '1', value: 'Title', contentType: 'h1'}

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
                <BlockContent
                    boardId='fake-board-id'
                    block={block}
                    contentOrder={[block.id]}
                    editing={null}
                    setEditing={vi.fn()}
                    setAfterBlock={vi.fn()}
                    onSave={vi.fn()}
                    onMove={vi.fn()}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot editing', async () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <BlockContent
                    boardId='fake-board-id'
                    block={block}
                    contentOrder={[block.id]}
                    editing={block}
                    setEditing={vi.fn()}
                    setAfterBlock={vi.fn()}
                    onSave={vi.fn()}
                    onMove={vi.fn()}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })

    test('should call setEditing on click the content', async () => {
        const setEditing = vi.fn()
        render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <BlockContent
                    boardId='fake-board-id'
                    block={block}
                    contentOrder={[block.id]}
                    editing={null}
                    setEditing={setEditing}
                    setAfterBlock={vi.fn()}
                    onSave={vi.fn()}
                    onMove={vi.fn()}
                />
            </AppStoreProvider>,
        ))
        const item = screen.getByTestId('block-content')
        expect(setEditing).not.toHaveBeenCalled()
        fireEvent.click(item)
        expect(setEditing).toHaveBeenCalledWith(block)
    })

    test('should call setEditing on click the content', async () => {
        const setAfterBlock = vi.fn()
        render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <BlockContent
                    boardId='fake-board-id'
                    block={block}
                    contentOrder={[block.id]}
                    editing={null}
                    setEditing={vi.fn()}
                    setAfterBlock={setAfterBlock}
                    onSave={vi.fn()}
                    onMove={vi.fn()}
                />
            </AppStoreProvider>,
        ))
        const item = screen.getByTestId('add-action')
        expect(setAfterBlock).not.toHaveBeenCalled()
        fireEvent.click(item)
        expect(setAfterBlock).toHaveBeenCalledWith(block)
    })

    test('should call onSave on hit enter in the input', async () => {
        const onSave = vi.fn()
        render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <BlockContent
                    boardId='fake-board-id'
                    block={block}
                    contentOrder={[block.id]}
                    editing={block}
                    setEditing={vi.fn()}
                    setAfterBlock={vi.fn()}
                    onSave={onSave}
                    onMove={vi.fn()}
                />
            </AppStoreProvider>,
        ))
        const input = screen.getByDisplayValue('Title')
        expect(onSave).not.toHaveBeenCalled()
        fireEvent.input(input, {target: {value: 'test'}})
        fireEvent.keyDown(input, {key: 'Enter'})

        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({value: 'test'}))
    })
})
