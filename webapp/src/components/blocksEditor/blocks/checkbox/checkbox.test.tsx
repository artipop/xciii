import {render, screen, fireEvent} from '@solidjs/testing-library'

import CheckboxBlock from '.'

describe('components/blocksEditor/blocks/checkbox', () => {
    test('should match Display snapshot', async () => {
        const Component = CheckboxBlock.Display
        const {container} = render(() =>
            <Component
                onChange={vi.fn()}
                value={{value: 'test-value', checked: true}}
                onCancel={vi.fn()}
                onSave={vi.fn()}
            />,
        )
        expect(container).toMatchSnapshot()
    })

    test('should match Display snapshot not checked', async () => {
        const Component = CheckboxBlock.Display
        const {container} = render(() =>
            <Component
                onChange={vi.fn()}
                value={{value: 'test-value', checked: false}}
                onCancel={vi.fn()}
                onSave={vi.fn()}
            />,
        )
        expect(container).toMatchSnapshot()
    })

    test('should match Input snapshot', async () => {
        const Component = CheckboxBlock.Input
        const {container} = render(() =>
            <Component
                onChange={vi.fn()}
                value={{value: 'test-value', checked: true}}
                onCancel={vi.fn()}
                onSave={vi.fn()}
            />,
        )
        expect(container).toMatchSnapshot()
    })

    test('should match Input snapshot not checked', async () => {
        const Component = CheckboxBlock.Input
        const {container} = render(() =>
            <Component
                onChange={vi.fn()}
                value={{value: 'test-value', checked: false}}
                onCancel={vi.fn()}
                onSave={vi.fn()}
            />,
        )
        expect(container).toMatchSnapshot()
    })

    test('should emit onSave event on Display checkbox clicked', async () => {
        const onSave = vi.fn()
        const Component = CheckboxBlock.Display
        render(() =>
            <Component
                onChange={vi.fn()}
                value={{value: 'test-value', checked: true}}
                onCancel={vi.fn()}
                onSave={onSave}
            />,
        )
        expect(onSave).not.toHaveBeenCalled()

        const input = screen.getByTestId('checkbox-check')
        fireEvent.click(input)
        expect(onSave).toHaveBeenCalledWith({value: 'test-value', checked: false})
    })

    test('should emit onChange event on input change', async () => {
        const onChange = vi.fn()
        const Component = CheckboxBlock.Input
        render(() =>
            <Component
                onChange={onChange}
                value={{value: 'test-value', checked: true}}
                onCancel={vi.fn()}
                onSave={vi.fn()}
            />,
        )

        expect(onChange).not.toHaveBeenCalled()

        const input = screen.getByTestId('checkbox-input')
        fireEvent.input(input, {target: {value: 'test-value-'}})
        expect(onChange).toHaveBeenCalledWith({value: 'test-value-', checked: true})
    })

    test('should emit onChange event on checkbox click', async () => {
        const onChange = vi.fn()
        const Component = CheckboxBlock.Input
        render(() =>
            <Component
                onChange={onChange}
                value={{value: 'test-value', checked: true}}
                onCancel={vi.fn()}
                onSave={vi.fn()}
            />,
        )

        expect(onChange).not.toHaveBeenCalled()

        const input = screen.getByTestId('checkbox-check')
        fireEvent.click(input)
        expect(onChange).toHaveBeenCalledWith({value: 'test-value', checked: false})
    })

    test('should not emit onCancel event when value is not empty and hit backspace', async () => {
        const onCancel = vi.fn()
        const Component = CheckboxBlock.Input
        render(() =>
            <Component
                onChange={vi.fn()}
                value={{value: 'test-value', checked: true}}
                onCancel={onCancel}
                onSave={vi.fn()}
            />,
        )

        expect(onCancel).not.toHaveBeenCalled()
        const input = screen.getByTestId('checkbox-input')
        fireEvent.keyDown(input, {key: 'Backspace'})
        expect(onCancel).not.toHaveBeenCalled()
    })

    test('should emit onCancel event when value is empty and hit backspace', async () => {
        const onCancel = vi.fn()
        const Component = CheckboxBlock.Input
        render(() =>
            <Component
                onChange={vi.fn()}
                value={{value: '', checked: false}}
                onCancel={onCancel}
                onSave={vi.fn()}
            />,
        )

        expect(onCancel).not.toHaveBeenCalled()

        const input = screen.getByTestId('checkbox-input')
        fireEvent.keyDown(input, {key: 'Backspace'})
        expect(onCancel).toHaveBeenCalled()
    })

    test('should emit onSave event hit enter', async () => {
        const onSave = vi.fn()
        const Component = CheckboxBlock.Input
        render(() =>
            <Component
                onChange={vi.fn()}
                value={{value: 'test-value', checked: true}}
                onCancel={vi.fn()}
                onSave={onSave}
            />,
        )

        expect(onSave).not.toHaveBeenCalled()
        const input = screen.getByTestId('checkbox-input')
        fireEvent.keyDown(input, {key: 'Enter'})
        expect(onSave).toHaveBeenCalledWith({value: 'test-value', checked: true})
    })
})
