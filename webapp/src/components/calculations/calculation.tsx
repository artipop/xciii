import type {JSX} from 'solid-js'

import {useIntl} from '../../intl'

import {Card} from '../../blocks/card'

import {IPropertyTemplate} from '../../blocks/board'

import ChevronUp from '../../widgets/icons/chevronUp'

import {useColumnResize} from '../table/tableColumnResizeContext'

import {Constants} from '../../constants'

import {CommonCalculationOptionProps, Options, optionDisplayNameString} from './options'

import Calculations from './calculations'

import './calculation.scss'

type Props = {
    class: string
    value: string
    menuOpen: boolean
    onMenuClose: () => void
    onMenuOpen: () => void
    onChange: (value: string) => void
    cards: readonly Card[]
    property: IPropertyTemplate
    hovered: boolean
    optionsComponent: React.ComponentType<CommonCalculationOptionProps>
}

const Calculation = (props: Props): JSX.Element => {
    // Accessors: picking another calculation from the menu changes props.value,
    // and the label and the class both have to follow it.
    const value = () => props.value || Options.none.value
    const valueOption = () => Options[value()]
    const intl = useIntl()
    const columnResize = useColumnResize()

    // The unit is not optional the way it was in React, which appended `px` to a
    // bare number itself. Solid writes a style object through setProperty, and
    // setProperty drops `280` as an invalid width — which left every cell of the
    // footer sized by its own content, so a total sat well left of the column it
    // counts while the rest of the table lined up.
    const cellWidth = () => `${columnResize.width(props.property.id)}px`

    const option = () => (
        <props.optionsComponent
            value={value()}
            menuOpen={props.menuOpen}
            onClose={props.onMenuClose}
            onChange={props.onChange}
            property={props.property}
        />
    )

    return (

        // tabindex is needed to make onBlur work on div.
        // See this for more details-
        // https://stackoverflow.com/questions/47308081/onblur-event-is-not-firing
        <div
            class={`Calculation ${value()} ${props.class} ${props.menuOpen ? 'menuOpen' : ''} ${props.hovered ? 'hovered' : ''}`}
            onClick={() => (props.menuOpen ? props.onMenuClose() : props.onMenuOpen())}
            tabIndex={0}
            onBlur={props.onMenuClose}
            style={{width: cellWidth()}}
            ref={(ref) => columnResize.updateRef(Constants.tableCalculationId, props.property.id, ref)}
        >
            {
                props.menuOpen && (
                    <div>
                        {option()}
                    </div>
                )
            }

            <span class='calculationLabel'>
                {optionDisplayNameString(valueOption()!, intl)}
            </span>

            {
                value() === Options.none.value &&
                <ChevronUp/>
            }

            {
                value() !== Options.none.value &&
                <span class='calculationValue'>
                    {Calculations[value()] ? Calculations[value()](props.cards, props.property, intl) : ''}
                </span>
            }

        </div>
    )
}

export default Calculation
