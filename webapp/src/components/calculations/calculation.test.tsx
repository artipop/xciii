import type {JSX} from 'solid-js'

import {render} from '@solidjs/testing-library'

import userEvent from '@testing-library/user-event'

import {TestBlockFactory} from '../../test/testBlockFactory'
import {wrapIntl} from '../../testUtils'

import {TableCalculationOptions} from '../table/calculation/tableCalculationOptions'

import {ColumnResizeProvider} from '../table/tableColumnResizeContext'

import Calculation from './calculation'

describe('components/calculations/Calculation', () => {
    const board = TestBlockFactory.createBoard()

    const card = TestBlockFactory.createCard(board)
    card.fields.properties.property_2 = 'Foo'
    card.fields.properties.property_3 = 'Bar'
    card.fields.properties.property_4 = 'Baz'

    const card2 = TestBlockFactory.createCard(board)
    card2.fields.properties.property_2 = 'Lorem'
    card2.fields.properties.property_3 = ''
    card2.fields.properties.property_4 = 'Baz'

    const Wrapper = (props: {children?: JSX.Element}) => {
        return wrapIntl(() =>
            <ColumnResizeProvider
                columnWidths={{}}
                onResizeColumn={vi.fn()}
            >
                {props.children}
            </ColumnResizeProvider>,
        )
    }

    test('should match snapshot - none', () => {
        const {container} = render(() =>
            <Wrapper>
                <Calculation
                    class={'fooClass'}
                    value={'none'}
                    menuOpen={false}
                    onMenuClose={() => {}}
                    onMenuOpen={() => {}}
                    onChange={() => {}}
                    cards={[card, card2]}
                    hovered={true}
                    property={{
                        id: 'property_2',
                        name: '',
                        type: 'text',
                        options: [],
                    }}
                    optionsComponent={TableCalculationOptions}
                />
            </Wrapper>,
        )

        expect(container).toMatchSnapshot()
    })

    test('should match snapshot - count', () => {
        const {container} = render(() =>
            <Wrapper>
                <Calculation
                    class={'fooClass'}
                    value={'count'}
                    menuOpen={false}
                    onMenuClose={() => {}}
                    onMenuOpen={() => {}}
                    onChange={() => {}}
                    cards={[card, card2]}
                    hovered={true}
                    property={{
                        id: 'property_2',
                        name: '',
                        type: 'text',
                        options: [],
                    }}
                    optionsComponent={TableCalculationOptions}
                />
            </Wrapper>,
        )

        expect(container).toMatchSnapshot()
    })

    test('should match snapshot - countValue', () => {
        const {container} = render(() =>
            <Wrapper>
                <Calculation
                    class={'fooClass'}
                    value={'countValue'}
                    menuOpen={false}
                    onMenuClose={() => {}}
                    onMenuOpen={() => {}}
                    onChange={() => {}}
                    cards={[card, card2]}
                    hovered={true}
                    property={{
                        id: 'property_3',
                        name: '',
                        type: 'text',
                        options: [],
                    }}
                    optionsComponent={TableCalculationOptions}
                />
            </Wrapper>,
        )

        expect(container).toMatchSnapshot()
    })

    test('should match snapshot - countUniqueValue', () => {
        const {container} = render(() =>
            <Wrapper>
                <Calculation
                    class={'fooClass'}
                    value={'countUniqueValue'}
                    menuOpen={false}
                    onMenuClose={() => {}}
                    onMenuOpen={() => {}}
                    onChange={() => {}}
                    cards={[card, card2]}
                    hovered={true}
                    property={{
                        id: 'property_4',
                        name: '',
                        type: 'text',
                        options: [],
                    }}
                    optionsComponent={TableCalculationOptions}
                />
            </Wrapper>,
        )

        expect(container).toMatchSnapshot()
    })

    test('should match snapshot - option change', () => {
        const onMenuOpen = vi.fn()
        const onMenuClose = vi.fn()
        const onChange = vi.fn()

        const {container} = render(() =>
            <Wrapper>
                <Calculation
                    class={'fooClass'}
                    value={'none'}
                    menuOpen={true}
                    onMenuClose={onMenuClose}
                    onMenuOpen={onMenuOpen}
                    onChange={onChange}
                    cards={[card, card2]}
                    hovered={true}
                    property={{
                        id: 'property_2',
                        name: '',
                        type: 'text',
                        options: [],
                    }}
                    optionsComponent={TableCalculationOptions}
                />
            </Wrapper>,
        )

        const countMenuOption = container.querySelectorAll('[role="option"]')[1]
        userEvent.click(countMenuOption as Element)
        expect(container).toMatchSnapshot()
        expect(onMenuOpen).not.toHaveBeenCalled()
        expect(onMenuClose).toHaveBeenCalled()
        expect(onChange).toHaveBeenCalled()
    })

    // The footer of a table is only readable if a total stands under the column
    // it counts, and the width it is given carries a unit — a bare number is
    // dropped as an invalid style and the whole row falls out of step with the
    // table above it.
    test('a total is as wide as the column it counts', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <ColumnResizeProvider
                    columnWidths={{property_2: 240}}
                    onResizeColumn={vi.fn()}
                >
                    <Calculation
                        class={'fooClass'}
                        value={'count'}
                        menuOpen={false}
                        onMenuClose={() => {}}
                        onMenuOpen={() => {}}
                        onChange={() => {}}
                        cards={[card, card2]}
                        hovered={false}
                        property={{
                            id: 'property_2',
                            name: '',
                            type: 'text',
                            options: [],
                        }}
                        optionsComponent={TableCalculationOptions}
                    />
                </ColumnResizeProvider>,
            ),
        )

        expect((container.querySelector('.Calculation') as HTMLElement).style.width).toBe('240px')
    })
})
