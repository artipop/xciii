import type {JSX} from 'solid-js'

import CompassIcon from './compassIcon'

import './delete.scss'

export default function DeleteIcon(): JSX.Element {
    return (
        <CompassIcon
            icon='trash-can-outline'
            class='DeleteIcon trash-can-outline'
        />
    )
}
