import {render, screen, fireEvent} from '@solidjs/testing-library'

import octoClient from '../../../../octoClient'

import ImageBlock from '.'

vi.mock('../../../../octoClient')

describe('components/blocksEditor/blocks/image', () => {
    test('should match Display snapshot', async () => {
        const mockedOcto = vi.mocked(octoClient)
        mockedOcto.getFileAsDataUrl.mockResolvedValue({url: 'test.jpg'})
        const Component = ImageBlock.Display
        const {container} = render(() =>
            <Component
                onChange={vi.fn()}
                value={{file: 'test'}}
                onCancel={vi.fn()}
                onSave={vi.fn()}
            />,
        )
        await screen.findByTestId('image')
        expect(container).toMatchSnapshot()
    })

    test('should match Display snapshot with empty value', async () => {
        const Component = ImageBlock.Display
        const {container} = render(() =>
            <Component
                onChange={vi.fn()}
                value={{file: ''}}
                onCancel={vi.fn()}
                onSave={vi.fn()}
                currentBoardId=''
            />,
        )
        expect(container).toMatchSnapshot()
    })

    test('should match Input snapshot', async () => {
        const Component = ImageBlock.Input
        const {container} = render(() =>
            <Component
                onChange={vi.fn()}
                value={{file: 'test'}}
                onCancel={vi.fn()}
                onSave={vi.fn()}
            />,
        )
        expect(container).toMatchSnapshot()
    })

    test('should match Input snapshot with empty input', async () => {
        const Component = ImageBlock.Input
        const {container} = render(() =>
            <Component
                onChange={vi.fn()}
                value={{file: ''}}
                onCancel={vi.fn()}
                onSave={vi.fn()}
            />,
        )
        expect(container).toMatchSnapshot()
    })

    test('should emit onSave on change', async () => {
        const onSave = vi.fn()
        const Component = ImageBlock.Input
        render(() =>
            <Component
                onChange={vi.fn()}
                value={{file: 'test'}}
                onCancel={vi.fn()}
                onSave={onSave}
            />,
        )

        expect(onSave).not.toHaveBeenCalled()
        const input = screen.getByTestId('image-input')
        fireEvent.change(input, {target: {files: ['test-file']}})
        expect(onSave).toHaveBeenCalledWith({file: 'test-file'})
    })
})
