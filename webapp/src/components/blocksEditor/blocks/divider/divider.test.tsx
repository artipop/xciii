import {render} from '@solidjs/testing-library'

import DividerBlock from '.'

describe('components/blocksEditor/blocks/divider', () => {
    test('should match Display snapshot', async () => {
        const Component = DividerBlock.Display
        const {container} = render(() =>
            <Component
                onChange={vi.fn()}
                value='test-value'
                onCancel={vi.fn()}
                onSave={vi.fn()}
            />,
        )
        expect(container).toMatchSnapshot()
    })

    test('should match Input snapshot', async () => {
        const Component = DividerBlock.Input
        const {container} = render(() =>
            <Component
                onChange={vi.fn()}
                value='test-value'
                onCancel={vi.fn()}
                onSave={vi.fn()}
            />,
        )
        expect(container).toMatchSnapshot()
    })

    test('should emit onSave event on mount', async () => {
        const onSave = vi.fn()
        const Component = DividerBlock.Input
        render(() =>
            <Component
                onChange={vi.fn()}
                value='test-value'
                onCancel={vi.fn()}
                onSave={onSave}
            />,
        )
        expect(onSave).toHaveBeenCalled()
    })
})
