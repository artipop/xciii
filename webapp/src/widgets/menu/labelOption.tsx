import type {JSX} from 'solid-js'

import './labelOption.scss'

type LabelOptionProps = {
    icon?: string
    children: JSX.Element
}

function LabelOption(props: LabelOptionProps): JSX.Element {
    return (
        <div class='MenuOption LabelOption menu-option'>
            {props.icon ?? <div class='noicon'/>}
            <div class='menu-name'>{props.children}</div>
            <div class='noicon'/>
        </div>
    )
}

export default LabelOption
