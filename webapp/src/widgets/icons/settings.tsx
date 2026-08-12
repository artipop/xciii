import type {JSX} from 'solid-js'

import CompassIcon from './compassIcon'

import './settings.scss'

export default function SettingsIcon(): JSX.Element {
    return (
        <CompassIcon
            icon='settings-outline'
            class='SettingsIcon'
        />
    )
}
