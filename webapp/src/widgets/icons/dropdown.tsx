import type {JSX} from 'solid-js'

import CompassIcon from './compassIcon'

import './dropdown.scss'

export default function DropdownIcon(): JSX.Element {
    return (
        <CompassIcon
            icon='chevron-down'
            class='DropdownIcon'
        />
    )
}
