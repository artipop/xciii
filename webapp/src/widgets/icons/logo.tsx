import type {JSX} from 'solid-js'

import './logo.scss'
import CompassIcon from './compassIcon'

export default function LogoIcon(): JSX.Element {
    return (
        <CompassIcon
            icon='product-boards'
            class='boards-rhs-icon'
        />
    )
}
