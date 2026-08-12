import type {JSX} from 'solid-js'

import CompassIcon from './compassIcon'

import './options.scss'

export default function OptionsIcon(): JSX.Element {
    return (
        <CompassIcon
            icon='dots-horizontal'
            class='OptionsIcon'
        />
    )
}
