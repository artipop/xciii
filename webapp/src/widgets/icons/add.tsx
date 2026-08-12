import type {JSX} from 'solid-js'

import CompassIcon from './compassIcon'

import './add.scss'

export default function AddIcon(): JSX.Element {
    return (
        <CompassIcon
            icon='plus'
            class='AddIcon'
        />
    )
}
