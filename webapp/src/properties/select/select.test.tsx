import {render, screen} from '@solidjs/testing-library'
import '@testing-library/jest-dom'

import userEvent from '@testing-library/user-event'

import {IPropertyTemplate, createBoard} from '../../blocks/board'
import {createCard} from '../../blocks/card'

import {wrapIntl} from '../../testUtils'
import mutator from '../../mutator'

import SelectProperty from './property'
import Select from './select'

vi.mock('../../mutator')
const mockedMutator = vi.mocked(mutator)

function selectPropertyTemplate(): IPropertyTemplate {
    return {
        id: 'select-template',
        name: 'select',
        type: 'select',
        options: [
            {
                id: 'option-1',
                value: 'one',
                color: 'propColorDefault',
            },
            {
                id: 'option-2',
                value: 'two',
                color: 'propColorGreen',
            },
            {
                id: 'option-3',
                value: 'three',
                color: 'propColorRed',
            },
        ],
    }
}

describe('properties/select', () => {
    const nonEditableSelectTestId = 'select-non-editable'

    const clearButton = () => screen.queryByRole('button', {name: /clear/i})
    const board = createBoard()
    const card = createCard()

    it('shows the selected option', () => {
        const propertyTemplate = selectPropertyTemplate()
        const option = propertyTemplate.options[0]

        const {container} = render(() => wrapIntl(() =>
            <Select
                property={new SelectProperty()}
                board={{...board}}
                card={{...card}}
                propertyTemplate={propertyTemplate}
                propertyValue={option.id}
                readOnly={true}
                showEmptyPlaceholder={false}
            />,
        ))

        expect(screen.getByText(option.value)).toBeInTheDocument()
        expect(clearButton()).not.toBeInTheDocument()

        expect(container).toMatchSnapshot()
    })

    it('shows empty placeholder', () => {
        const propertyTemplate = selectPropertyTemplate()
        const emptyValue = 'Empty'

        const {container} = render(() => wrapIntl(() =>
            <Select
                property={new SelectProperty()}
                board={{...board}}
                card={{...card}}
                showEmptyPlaceholder={true}
                propertyTemplate={propertyTemplate}
                propertyValue={''}
                readOnly={true}
            />,
        ))

        expect(screen.getByText(emptyValue)).toBeInTheDocument()
        expect(clearButton()).not.toBeInTheDocument()

        expect(container).toMatchSnapshot()
    })

    it('shows the menu with options when preview is clicked', () => {
        const propertyTemplate = selectPropertyTemplate()
        const selected = propertyTemplate.options[1]

        render(() => wrapIntl(() =>
            <Select
                property={new SelectProperty()}
                board={{...board}}
                card={{...card}}
                propertyTemplate={propertyTemplate}
                propertyValue={selected.id}
                showEmptyPlaceholder={false}
                readOnly={false}
            />,
        ))

        userEvent.click(screen.getByTestId(nonEditableSelectTestId))

        // check that all options are visible
        for (const option of propertyTemplate.options) {
            const elements = screen.getAllByText(option.value)

            // selected option is rendered twice: in the input and inside the menu
            const expected = option.id === selected.id ? 2 : 1
            expect(elements.length).toBe(expected)
        }

        expect(clearButton()).toBeInTheDocument()
    })

    it('can select the option from menu', () => {
        const propertyTemplate = selectPropertyTemplate()
        const optionToSelect = propertyTemplate.options[2]

        render(() => wrapIntl(() =>
            <Select
                property={new SelectProperty()}
                board={{...board}}
                card={{...card}}
                propertyTemplate={propertyTemplate}
                propertyValue={''}
                showEmptyPlaceholder={false}
                readOnly={false}
            />,
        ))

        userEvent.click(screen.getByTestId(nonEditableSelectTestId))
        userEvent.click(screen.getByText(optionToSelect.value))

        expect(clearButton()).not.toBeInTheDocument()
        expect(mockedMutator.changePropertyValue).toHaveBeenCalledWith(board.id, card, propertyTemplate.id, optionToSelect.id)
    })

    it('can clear the selected option', () => {
        const propertyTemplate = selectPropertyTemplate()
        const selected = propertyTemplate.options[1]

        render(() => wrapIntl(() =>
            <Select
                property={new SelectProperty()}
                board={{...board}}
                card={{...card}}
                propertyTemplate={propertyTemplate}
                propertyValue={selected.id}
                showEmptyPlaceholder={false}
                readOnly={false}
            />,
        ))

        userEvent.click(screen.getByTestId(nonEditableSelectTestId))

        const clear = clearButton()
        expect(clear).toBeInTheDocument()

        userEvent.click(clear!)

        expect(mockedMutator.changePropertyValue).toHaveBeenCalledWith(board.id, card, propertyTemplate.id, '')
    })

    it('can create new option', () => {
        const propertyTemplate = selectPropertyTemplate()
        const initialOption = propertyTemplate.options[0]
        const newOption = 'new-option'

        render(() => wrapIntl(() =>
            <Select
                property={new SelectProperty()}
                board={{...board}}
                card={{...card}}
                propertyTemplate={propertyTemplate}
                propertyValue={initialOption.id}
                showEmptyPlaceholder={false}
                readOnly={false}
            />,
        ))

        mockedMutator.insertPropertyOption.mockResolvedValue()

        userEvent.click(screen.getByTestId(nonEditableSelectTestId))
        userEvent.type(screen.getByRole('combobox', {name: /value selector/i}), `${newOption}{enter}`)

        expect(mockedMutator.insertPropertyOption).toHaveBeenCalledWith(board.id, board.cardProperties, propertyTemplate, expect.objectContaining({value: newOption}), 'add property option')
        expect(mockedMutator.changePropertyValue).toHaveBeenCalledWith(board.id, card, propertyTemplate.id, 'option-3')
    })

    // On the card the chosen option is a chip you can take off, the way the
    // people a card is assigned to are. Before this the only visible way out
    // was «Delete» in the option's own menu, which takes the option away from
    // the whole board.
    it('is cleared from the card by the cross on the chip', () => {
        const propertyTemplate = selectPropertyTemplate()
        const option = propertyTemplate.options[0]

        render(() => wrapIntl(() =>
            <Select
                property={new SelectProperty()}
                board={{...board}}
                card={{...card}}
                propertyTemplate={propertyTemplate}
                propertyValue={option.id}
                showEmptyPlaceholder={true}
                readOnly={false}
            />,
        ))

        userEvent.click(clearButton()!)

        expect(mockedMutator.changePropertyValue).toHaveBeenCalledWith(board.id, card, propertyTemplate.id, '')

        // And the chip did not also open the selector on the way out.
        expect(screen.queryByRole('combobox', {name: /value selector/i})).not.toBeInTheDocument()
    })

    // Everywhere the value is only being read — a table cell, a badge on a
    // kanban card — a cross on every value is noise.
    it('offers no cross outside the card', () => {
        const propertyTemplate = selectPropertyTemplate()

        render(() => wrapIntl(() =>
            <Select
                property={new SelectProperty()}
                board={{...board}}
                card={{...card}}
                propertyTemplate={propertyTemplate}
                propertyValue={propertyTemplate.options[0].id}
                showEmptyPlaceholder={false}
                readOnly={false}
            />,
        ))

        expect(clearButton()).not.toBeInTheDocument()
    })
})
