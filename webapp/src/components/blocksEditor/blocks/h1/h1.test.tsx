// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {render, screen, fireEvent} from '@solidjs/testing-library'

import H1Block from '.'

describe('components/blocksEditor/blocks/h1', () => {
    test('should match Display snapshot', async () => {
        const Component = H1Block.Display
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
        const Component = H1Block.Input
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

    test('should emit onChange event', async () => {
        const onChange = vi.fn()
        const Component = H1Block.Input
        render(() =>
            <Component
                onChange={onChange}
                value='test-value'
                onCancel={vi.fn()}
                onSave={vi.fn()}
            />,
        )

        expect(onChange).not.toHaveBeenCalled()

        const input = screen.getByTestId('h1')
        fireEvent.input(input, {target: {value: 'test-value-'}})
        expect(onChange).toHaveBeenCalled()
    })

    test('should not emit onCancel event when value is not empty and hit backspace', async () => {
        const onCancel = vi.fn()
        const Component = H1Block.Input
        render(() =>
            <Component
                onChange={vi.fn()}
                value='test-value'
                onCancel={onCancel}
                onSave={vi.fn()}
            />,
        )

        expect(onCancel).not.toHaveBeenCalled()
        const input = screen.getByTestId('h1')
        fireEvent.keyDown(input, {key: 'Backspace'})
        expect(onCancel).not.toHaveBeenCalled()
    })

    test('should emit onCancel event when value is empty and hit backspace', async () => {
        const onCancel = vi.fn()
        const Component = H1Block.Input
        render(() =>
            <Component
                onChange={vi.fn()}
                value=''
                onCancel={onCancel}
                onSave={vi.fn()}
            />,
        )

        expect(onCancel).not.toHaveBeenCalled()

        const input = screen.getByTestId('h1')
        fireEvent.keyDown(input, {key: 'Backspace'})
        expect(onCancel).toHaveBeenCalled()
    })

    test('should emit onSave event hit enter', async () => {
        const onSave = vi.fn()
        const Component = H1Block.Input
        render(() =>
            <Component
                onChange={vi.fn()}
                value='test-value'
                onCancel={vi.fn()}
                onSave={onSave}
            />,
        )

        expect(onSave).not.toHaveBeenCalled()
        const input = screen.getByTestId('h1')
        fireEvent.keyDown(input, {key: 'Enter'})
        expect(onSave).toHaveBeenCalled()
    })
})
