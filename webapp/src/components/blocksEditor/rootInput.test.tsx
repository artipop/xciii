// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {render, screen, fireEvent} from '@solidjs/testing-library'

import {wrapIntl} from '../../testUtils'

import RootInput from './rootInput'

describe('components/blocksEditor/rootInput', () => {
    test('should match Display snapshot', async () => {
        const {container} = render(() => wrapIntl(() =>
            <RootInput
                onChange={vi.fn()}
                value='test-value'
                onChangeType={vi.fn()}
                onSave={vi.fn()}
            />,
        ))
        expect(container).toMatchSnapshot()
    })

    test('should match Input snapshot', async () => {
        const {container} = render(() => wrapIntl(() =>
            <RootInput
                onChange={vi.fn()}
                value='test-value'
                onChangeType={vi.fn()}
                onSave={vi.fn()}
            />,
        ))
        expect(container).toMatchSnapshot()
    })

    test('should match Input snapshot with menu open', async () => {
        const {container} = render(() => wrapIntl(() =>
            <RootInput
                onChange={vi.fn()}
                value=''
                onChangeType={vi.fn()}
                onSave={vi.fn()}
            />,
        ))
        const input = screen.getByDisplayValue('')
        fireEvent.input(input, {target: {value: '/'}})
        expect(container).toMatchSnapshot()
    })

    test('should emit onChange event', async () => {
        const onChange = vi.fn()
        render(() => wrapIntl(() =>
            <RootInput
                onChange={onChange}
                value='test-value'
                onChangeType={vi.fn()}
                onSave={vi.fn()}
            />,
        ))

        expect(onChange).not.toHaveBeenCalled()

        const input = screen.getByDisplayValue('test-value')
        fireEvent.input(input, {target: {value: 'test-value-'}})
        expect(onChange).toHaveBeenCalled()
    })

    test('should not emit onChangeType event when value is not empty and hit backspace', async () => {
        const onChangeType = vi.fn()
        render(() => wrapIntl(() =>
            <RootInput
                onChange={vi.fn()}
                value='test-value'
                onChangeType={onChangeType}
                onSave={vi.fn()}
            />,
        ))

        expect(onChangeType).not.toHaveBeenCalled()
        const input = screen.getByDisplayValue('test-value')
        fireEvent.keyDown(input, {key: 'Backspace'})
        expect(onChangeType).not.toHaveBeenCalled()
    })

    test('should emit onSave event hit enter', async () => {
        const onSave = vi.fn()
        render(() => wrapIntl(() =>
            <RootInput
                onChange={vi.fn()}
                value='test-value'
                onChangeType={vi.fn()}
                onSave={onSave}
            />,
        ))

        expect(onSave).not.toHaveBeenCalled()
        const input = screen.getByDisplayValue('test-value')
        fireEvent.keyDown(input, {key: 'Enter'})
        expect(onSave).toHaveBeenCalled()
    })

    test('should emit onChangeType event on menu option selected', async () => {
        const onChangeType = vi.fn()
        render(() => wrapIntl(() =>
            <RootInput
                onChange={vi.fn()}
                value=''
                onChangeType={onChangeType}
                onSave={vi.fn()}
            />,
        ))

        const input = screen.getByDisplayValue('')
        fireEvent.input(input, {target: {value: '/'}})

        const option = screen.getByText('/title Creates a new Title block.')
        fireEvent.click(option)

        expect(onChangeType).toHaveBeenCalledWith(expect.objectContaining({name: 'h1'}))
    })
})
