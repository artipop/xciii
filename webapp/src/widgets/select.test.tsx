import {createSignal} from 'solid-js'
import {fireEvent, render, screen, within} from '@solidjs/testing-library'
import '@testing-library/jest-dom'

import {chooseOption, optionsOf, wrapIntl} from '../testUtils'

import Select from './select'

describe('widgets/select', () => {
    const options = [
        {value: '', label: 'Choose…'},
        {value: 'claude', label: 'Claude'},
        {value: 'codex', label: 'Codex'},
    ]

    test('shows what is chosen and offers the rest', () => {
        const [value, setValue] = createSignal('claude')
        render(() => wrapIntl(() =>
            <Select
                value={value()}
                options={options}
                onChange={setValue}
                label='Kind'
            />,
        ))

        const field = screen.getByRole('button', {name: 'Kind'})
        expect(optionsOf(field)).toEqual(['Choose…', 'Claude', 'Codex'])

        chooseOption(field, 'Codex')
        expect(value()).toBe('codex')
        expect(screen.getByRole('button', {name: 'Codex'})).toBeInTheDocument()
    })

    // Nothing chosen is a state a field has to show, not one it can hide: half
    // of these stand for "no folder" and "the card's own", which are answers.
    test('says the placeholder while the value matches no option', () => {
        render(() => wrapIntl(() =>
            <Select
                value='gone'
                options={options}
                onChange={() => {}}
                placeholder='Choose…'
                label='Kind'
            />,
        ))

        expect(screen.getByRole('button', {name: 'Choose…'})).toBeInTheDocument()
    })

    // A dropdown that can only be used with a mouse is worse than the native
    // one it replaced. Down opens it and steps in, the arrows walk it, Enter
    // takes what is under the cursor.
    test('is opened, walked and answered from the keyboard', () => {
        const [value, setValue] = createSignal('claude')
        render(() => wrapIntl(() =>
            <Select
                value={value()}
                options={options}
                onChange={setValue}
                label='Kind'
            />,
        ))

        const field = screen.getByRole('button', {name: 'Kind'})

        // Scoped to the menu: the field answers to the name of what is chosen,
        // so «Claude» is two elements while the menu is open.
        const option = (name: string) => within(field.querySelector('.Menu') as HTMLElement).
            getByRole('button', {name})

        fireEvent.keyDown(field, {key: 'ArrowDown'})
        expect(document.activeElement).toBe(option('Choose…'))

        fireEvent.keyDown(option('Choose…'), {key: 'ArrowDown'})
        expect(document.activeElement).toBe(option('Claude'))

        fireEvent.keyDown(option('Claude'), {key: 'End'})
        expect(document.activeElement).toBe(option('Codex'))

        fireEvent.keyDown(option('Codex'), {key: 'Enter'})
        expect(value()).toBe('codex')
    })

    // Opening a menu must not move focus by itself: half of them stand inside
    // something that is being edited, and that something closes the moment
    // focus leaves it.
    test('opening it with the pointer leaves focus where it was', () => {
        render(() => wrapIntl(() =>
            <Select
                value='claude'
                options={options}
                onChange={() => {}}
                label='Kind'
            />,
        ))

        const before = document.activeElement
        fireEvent.click(screen.getByRole('button', {name: 'Kind'}))
        expect(screen.getByRole('button', {name: 'Codex'})).toBeInTheDocument()
        expect(document.activeElement).toBe(before)
    })
})
