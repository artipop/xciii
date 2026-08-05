// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {render, screen, fireEvent} from '@solidjs/testing-library'

import octoClient from '../../../../octoClient'

import VideoBlock from '.'

vi.mock('../../../../octoClient')

describe('components/blocksEditor/blocks/video', () => {
    test('should match Display snapshot', async () => {
        const mockedOcto = vi.mocked(octoClient)
        mockedOcto.getFileAsDataUrl.mockResolvedValue({url: 'test.jpg'})
        const Component = VideoBlock.Display
        const {container} = render(() =>
            <Component
                onChange={vi.fn()}
                value={{file: 'test', filename: 'test-filename'}}
                onCancel={vi.fn()}
                onSave={vi.fn()}
            />,
        )
        await screen.findByTestId('video')
        expect(container).toMatchSnapshot()
    })

    test('should match Display snapshot with empty value', async () => {
        const Component = VideoBlock.Display
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
        const Component = VideoBlock.Input
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
        const Component = VideoBlock.Input
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
        const Component = VideoBlock.Input
        render(() =>
            <Component
                onChange={vi.fn()}
                value={{file: 'test', filename: 'test-filename'}}
                onCancel={vi.fn()}
                onSave={onSave}
            />,
        )

        expect(onSave).not.toHaveBeenCalled()
        const input = screen.getByTestId('video-input')
        fireEvent.change(input, {target: {files: ['test-file']}})
        expect(onSave).toHaveBeenCalledWith({file: 'test-file'})
    })
})
