// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {render, screen, fireEvent} from '@solidjs/testing-library'

import {mockAppStore, mockDOM, wrapDNDIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'
import {TestBlockFactory} from '../../test/testBlockFactory'

import {BlockData} from './blocks/types'
import BlocksEditor from './blocksEditor'

describe('components/blocksEditor/blocksEditor', () => {
    beforeEach(mockDOM)

    const blocks: Array<BlockData<any>> = [
        {id: '1', value: 'Title', contentType: 'h1'},
        {id: '2', value: 'Sub title', contentType: 'h2'},
        {id: '3', value: 'Sub sub title', contentType: 'h3'},
        {id: '4', value: 'Some **markdown** text', contentType: 'text'},
        {id: '5', value: 'Some multiline\n**markdown** text\n### With Items\n- Item 1\n- Item2\n- Item3', contentType: 'text'},
        {id: '6', value: {checked: true, value: 'Checkbox'}, contentType: 'checkbox'},
    ]

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

    test('should match snapshot on empty', async () => {
        const {container} = render(wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <BlocksEditor
                    boardId='test-board'
                    onBlockCreated={jest.fn()}
                    onBlockModified={jest.fn()}
                    onBlockMoved={jest.fn()}
                    blocks={[]}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot with blocks', async () => {
        const {container} = render(wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <BlocksEditor
                    boardId='test-board'
                    onBlockCreated={jest.fn()}
                    onBlockModified={jest.fn()}
                    onBlockMoved={jest.fn()}
                    blocks={blocks}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })

    test('should call onBlockCreate after introduce text and hit enter', async () => {
        const onBlockCreated = jest.fn()
        render(wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <BlocksEditor
                    boardId='test-board'
                    onBlockCreated={onBlockCreated}
                    onBlockModified={jest.fn()}
                    onBlockMoved={jest.fn()}
                    blocks={[]}
                />
            </AppStoreProvider>,
        ))

        let input = screen.getByDisplayValue('')
        expect(onBlockCreated).not.toHaveBeenCalled()
        fireEvent.input(input, {target: {value: '/title'}})
        fireEvent.keyDown(input, {key: 'Enter'})

        input = screen.getByDisplayValue('')
        fireEvent.input(input, {target: {value: 'test'}})
        fireEvent.keyDown(input, {key: 'Enter'})

        expect(onBlockCreated).toHaveBeenCalledWith(expect.objectContaining({value: 'test'}))
    })

    test('should call onBlockModified after introduce text and hit enter', async () => {
        const onBlockModified = jest.fn()
        render(wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <BlocksEditor
                    boardId='test-board'
                    onBlockCreated={jest.fn()}
                    onBlockModified={onBlockModified}
                    onBlockMoved={jest.fn()}
                    blocks={blocks}
                />
            </AppStoreProvider>,
        ))
        const input = screen.getByTestId('checkbox-check')
        expect(onBlockModified).not.toHaveBeenCalled()
        fireEvent.click(input)
        expect(onBlockModified).toHaveBeenCalledWith(expect.objectContaining({value: {checked: false, value: 'Checkbox'}}))
    })
})
