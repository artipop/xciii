// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {render, screen, fireEvent} from '@solidjs/testing-library'

import octoClient from '../../../../octoClient'

import AttachmentBlock from '.'

vi.mock('../../../../octoClient')

describe('components/blocksEditor/blocks/attachment', () => {
    test('should match Display snapshot', async () => {
        const mockedOcto = vi.mocked(octoClient)
        mockedOcto.getFileAsDataUrl.mockResolvedValue({url: 'test.jpg'})
        const Component = AttachmentBlock.Display
        const {container} = render(() =>
            <Component
                onChange={vi.fn()}
                value={{file: 'test', filename: 'test-filename'}}
                onCancel={vi.fn()}
                onSave={vi.fn()}
            />,
        )
        await screen.findByTestId('attachment')
        expect(container).toMatchSnapshot()
    })

    test('should match Display snapshot with empty value', async () => {
        const Component = AttachmentBlock.Display
        const {container} = render(() =>
            <Component
                onChange={vi.fn()}
                value={{file: '', filename: ''}}
                onCancel={vi.fn()}
                onSave={vi.fn()}
                currentBoardId=''
            />,
        )
        expect(container).toMatchSnapshot()
    })

    test('should match Input snapshot', async () => {
        const Component = AttachmentBlock.Input
        const {container} = render(() =>
            <Component
                onChange={vi.fn()}
                value={{file: 'test', filename: 'test-filename'}}
                onCancel={vi.fn()}
                onSave={vi.fn()}
            />,
        )
        expect(container).toMatchSnapshot()
    })

    test('should match Input snapshot with empty input', async () => {
        const Component = AttachmentBlock.Input
        const {container} = render(() =>
            <Component
                onChange={vi.fn()}
                value={{file: '', filename: ''}}
                onCancel={vi.fn()}
                onSave={vi.fn()}
            />,
        )
        expect(container).toMatchSnapshot()
    })

    test('should emit onSave on change', async () => {
        const onSave = vi.fn()
        const Component = AttachmentBlock.Input
        render(() =>
            <Component
                onChange={vi.fn()}
                value={{file: 'test', filename: 'test-filename'}}
                onCancel={vi.fn()}
                onSave={onSave}
            />,
        )

        expect(onSave).not.toHaveBeenCalled()
        const input = screen.getByTestId('attachment-input')
        fireEvent.change(input, {target: {files: {length: 1, item: () => new File([], 'test-file', {type: 'text/plain'})}}})
        expect(onSave).toHaveBeenCalledWith({file: new File([], 'test-file', {type: 'text/plain'}), filename: 'test-file'})
    })
})
