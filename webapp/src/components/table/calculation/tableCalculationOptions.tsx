import type {JSX} from 'solid-js'

import {CalculationOptions, CommonCalculationOptionProps, optionsByType} from '../../calculations/options'

export const TableCalculationOptions = (props: CommonCalculationOptionProps): JSX.Element => {
    // Read on use: a column whose property type changes offers a different set.
    const options = () => {
        const all = [...optionsByType.get('common')!]
        if (props.property && optionsByType.get(props.property.type)) {
            all.push(...optionsByType.get(props.property.type)!)
        }
        return all
    }

    return (
        <CalculationOptions
            value={props.value}
            menuOpen={props.menuOpen}
            onClose={props.onClose}
            onChange={props.onChange}
            property={props.property}
            options={options()}
        />
    )
}
