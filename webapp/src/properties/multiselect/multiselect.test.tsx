// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, screen} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'

import '@testing-library/jest-dom'

import {IntlProvider} from '../../intl'

import {IPropertyOption, IPropertyTemplate, createBoard} from '../../blocks/board'
import {createCard} from '../../blocks/card'
import mutator from '../../mutator'

import MultiSelectProperty from './property'
import MultiSelect from './multiselect'

vi.mock('../../mutator')
const mockedMutator = vi.mocked(mutator)

function buildMultiSelectPropertyTemplate(options: IPropertyOption[] = []): IPropertyTemplate {
    return {
        id: 'multiselect-template-1',
        name: 'Multi',
        options: [
            {
                color: 'propColorDefault',
                id: 'multi-option-1',
                value: 'a',
            },
            {
                color: '',
                id: 'multi-option-2',
                value: 'b',
            },
            {
                color: 'propColorDefault',
                id: 'multi-option-3',
                value: 'c',
            },
            ...options,
        ],
        type: 'multiSelect',
    }
}

type WrapperProps = {
    children?: JSX.Element
}

// props.children stays a lazy getter here: destructuring it would create the
// component under test before the provider exists.
const Wrapper = (props: WrapperProps) => {
    return (
        <IntlProvider
            locale='en'
            messages={{}}
        >{props.children}</IntlProvider>
    )
}

describe('properties/multiSelect', () => {
    const nonEditableMultiSelectTestId = 'multiselect-non-editable'

    const board = createBoard()
    const card = createCard()

    const expectOptionsMenuToBeVisible = (template: IPropertyTemplate) => {
        for (const option of template.options) {
            expect(screen.getByRole('menuitem', {name: option.value})).toBeInTheDocument()
        }
    }

    beforeEach(() => {
        vi.resetAllMocks()
    })

    it('shows only the selected options when menu is not opened', () => {
        const propertyTemplate = buildMultiSelectPropertyTemplate()
        const propertyValue = ['multi-option-1', 'multi-option-2']

        const {container} = render(() =>
            <MultiSelect
                property={new MultiSelectProperty()}
                readOnly={true}
                showEmptyPlaceholder={false}
                propertyTemplate={propertyTemplate}
                propertyValue={propertyValue}
                board={{...board}}
                card={{...card}}
            />,
        {wrapper: Wrapper},
        )

        const multiSelectParent = screen.getByTestId(nonEditableMultiSelectTestId)

        expect(multiSelectParent.children.length).toBe(propertyValue.length)

        expect(container).toMatchSnapshot()
    })

    it('opens editable multi value selector menu when the button/label is clicked', () => {
        const propertyTemplate = buildMultiSelectPropertyTemplate()

        render(() =>
            <MultiSelect
                property={new MultiSelectProperty()}
                readOnly={false}
                showEmptyPlaceholder={false}
                propertyTemplate={propertyTemplate}
                propertyValue={[]}
                board={{...board}}
                card={{...card}}
            />,
        {wrapper: Wrapper},
        )

        userEvent.click(screen.getByTestId(nonEditableMultiSelectTestId))

        expect(screen.getByRole('combobox', {name: /value selector/i})).toBeInTheDocument()
    })

    it('can select a option', async () => {
        const propertyTemplate = buildMultiSelectPropertyTemplate()
        const propertyValue = ['multi-option-1']

        render(() =>
            <MultiSelect
                property={new MultiSelectProperty()}
                readOnly={false}
                showEmptyPlaceholder={false}
                propertyTemplate={propertyTemplate}
                propertyValue={propertyValue}
                board={{...board}}
                card={{...card}}
            />,
        {wrapper: Wrapper},
        )

        userEvent.click(screen.getByTestId(nonEditableMultiSelectTestId))

        userEvent.type(screen.getByRole('combobox', {name: /value selector/i}), 'b{enter}')

        expect(mockedMutator.changePropertyValue).toHaveBeenCalledWith(board.id, card, propertyTemplate.id, ['multi-option-1', 'multi-option-2'])
        expectOptionsMenuToBeVisible(propertyTemplate)
    })

    it('can unselect a option', async () => {
        const propertyTemplate = buildMultiSelectPropertyTemplate()
        const propertyValue = ['multi-option-1', 'multi-option-2']

        render(() =>
            <MultiSelect
                property={new MultiSelectProperty()}
                readOnly={false}
                showEmptyPlaceholder={false}
                propertyTemplate={propertyTemplate}
                propertyValue={propertyValue}
                board={{...board}}
                card={{...card}}
            />,
        {wrapper: Wrapper},
        )

        userEvent.click(screen.getByTestId(nonEditableMultiSelectTestId))

        userEvent.click(screen.getAllByRole('button', {name: /clear/i})[0])

        expect(mockedMutator.changePropertyValue).toHaveBeenCalledWith(board.id, card, propertyTemplate.id, ['multi-option-2'])
        expectOptionsMenuToBeVisible(propertyTemplate)
    })

    it('can unselect a option via backspace', async () => {
        const propertyTemplate = buildMultiSelectPropertyTemplate()
        const propertyValue = ['multi-option-1', 'multi-option-2']

        render(() =>
            <MultiSelect
                property={new MultiSelectProperty()}
                readOnly={false}
                showEmptyPlaceholder={false}
                propertyTemplate={propertyTemplate}
                propertyValue={propertyValue}
                board={{...board}}
                card={{...card}}
            />,
        {wrapper: Wrapper},
        )

        userEvent.click(screen.getByTestId(nonEditableMultiSelectTestId))

        userEvent.type(screen.getByRole('combobox', {name: /value selector/i}), '{backspace}')

        expect(mockedMutator.changePropertyValue).toHaveBeenCalledWith(board.id, card, propertyTemplate.id, ['multi-option-1'])
        expectOptionsMenuToBeVisible(propertyTemplate)
    })

    it('can close menu on escape', async () => {
        const propertyTemplate = buildMultiSelectPropertyTemplate()
        const propertyValue = ['multi-option-1', 'multi-option-2']

        render(() =>
            <MultiSelect
                property={new MultiSelectProperty()}
                readOnly={false}
                showEmptyPlaceholder={false}
                propertyTemplate={propertyTemplate}
                propertyValue={propertyValue}
                board={{...board}}
                card={{...card}}
            />,
        {wrapper: Wrapper},
        )

        userEvent.click(screen.getByTestId(nonEditableMultiSelectTestId))

        userEvent.type(screen.getByRole('combobox', {name: /value selector/i}), '{escape}')

        for (const option of propertyTemplate.options) {
            expect(screen.queryByRole('menuitem', {name: option.value})).toBeNull()
        }
    })

    it('can create a new option', async () => {
        const propertyTemplate = buildMultiSelectPropertyTemplate()
        const propertyValue = ['multi-option-1', 'multi-option-2']

        render(() =>
            <MultiSelect
                property={new MultiSelectProperty()}
                readOnly={false}
                showEmptyPlaceholder={false}
                propertyTemplate={propertyTemplate}
                propertyValue={propertyValue}
                board={{...board}}
                card={{...card}}
            />,
        {wrapper: Wrapper},
        )

        mockedMutator.insertPropertyOption.mockResolvedValue()

        userEvent.click(screen.getByTestId(nonEditableMultiSelectTestId))
        userEvent.type(screen.getByRole('combobox', {name: /value selector/i}), 'new-value{enter}')

        expect(mockedMutator.insertPropertyOption).toHaveBeenCalledWith(board.id, board.cardProperties, propertyTemplate, expect.objectContaining({value: 'new-value'}), 'add property option')
        expectOptionsMenuToBeVisible(propertyTemplate)
    })

    it('can delete a option', () => {
        const propertyTemplate = buildMultiSelectPropertyTemplate()
        const propertyValue = ['multi-option-1', 'multi-option-2']

        render(() =>
            <MultiSelect
                property={new MultiSelectProperty()}
                readOnly={false}
                showEmptyPlaceholder={false}
                propertyTemplate={propertyTemplate}
                propertyValue={propertyValue}
                board={{...board}}
                card={{...card}}
            />,
        {wrapper: Wrapper},
        )

        userEvent.click(screen.getByTestId(nonEditableMultiSelectTestId))

        userEvent.click(screen.getAllByRole('button', {name: /open menu/i})[0])

        userEvent.click(screen.getByRole('button', {name: /delete/i}))

        const optionToDelete = propertyTemplate.options.find((option: IPropertyOption) => option.id === propertyValue[0])

        expect(mockedMutator.deletePropertyOption).toHaveBeenCalledWith(board.id, board.cardProperties, propertyTemplate, optionToDelete)
    })

    it('can change color for any option', () => {
        const propertyTemplate = buildMultiSelectPropertyTemplate()
        const propertyValue = ['multi-option-1', 'multi-option-2']
        const newColorKey = 'propColorYellow'
        const newColorValue = 'yellow'

        render(() =>
            <MultiSelect
                property={new MultiSelectProperty()}
                readOnly={false}
                showEmptyPlaceholder={false}
                propertyTemplate={propertyTemplate}
                propertyValue={propertyValue}
                board={{...board}}
                card={{...card}}
            />,
        {wrapper: Wrapper},
        )

        userEvent.click(screen.getByTestId(nonEditableMultiSelectTestId))

        userEvent.click(screen.getAllByRole('button', {name: /open menu/i})[0])

        userEvent.click(screen.getByRole('button', {name: new RegExp(newColorValue, 'i')}))

        const selectedOption = propertyTemplate.options.find((option: IPropertyOption) => option.id === propertyValue[0])

        expect(mockedMutator.changePropertyOptionColor).toHaveBeenCalledWith(board.id, board.cardProperties, propertyTemplate, selectedOption, newColorKey)
    })

    // On the card each chosen folder is a chip you can take off, the way the
    // people a card is assigned to are. The only visible way out used to be
    // «Delete» in the option's own menu, which takes the option away from the
    // whole board — a different act entirely.
    it('takes one value off the card by the cross on its chip', () => {
        const propertyTemplate = buildMultiSelectPropertyTemplate()
        const propertyValue = ['multi-option-1', 'multi-option-2']

        render(() =>
            <MultiSelect
                property={new MultiSelectProperty()}
                readOnly={false}
                showEmptyPlaceholder={true}
                propertyTemplate={propertyTemplate}
                propertyValue={propertyValue}
                board={{...board}}
                card={{...card}}
            />,
        {wrapper: Wrapper},
        )

        userEvent.click(screen.getAllByRole('button', {name: /clear/i})[0])

        expect(mockedMutator.changePropertyValue).toHaveBeenCalledWith(board.id, card, propertyTemplate.id, ['multi-option-2'])

        // And the chip did not also open the selector on the way out.
        expect(screen.queryByRole('combobox', {name: /value selector/i})).not.toBeInTheDocument()
    })

    // Everywhere the values are only being read — a table cell, a badge on a
    // kanban card — a cross on every one of them is noise.
    it('offers no crosses outside the card', () => {
        const propertyTemplate = buildMultiSelectPropertyTemplate()

        render(() =>
            <MultiSelect
                property={new MultiSelectProperty()}
                readOnly={false}
                showEmptyPlaceholder={false}
                propertyTemplate={propertyTemplate}
                propertyValue={['multi-option-1']}
                board={{...board}}
                card={{...card}}
            />,
        {wrapper: Wrapper},
        )

        expect(screen.queryByRole('button', {name: /clear/i})).not.toBeInTheDocument()
    })
})
