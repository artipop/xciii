import type {JSX} from 'solid-js'

import Switch from '../switch'

import {MenuOptionProps} from './menuItem'

type SwitchOptionProps = MenuOptionProps & {
    isOn: boolean
    icon?: JSX.Element
    suppressItemClicked?: boolean
}

function SwitchOption(props: SwitchOptionProps): JSX.Element {
    return (
        <div
            class='MenuOption SwitchOption menu-option'
            role='button'
            aria-label={props.name}
            onClick={(e: MouseEvent) => {
                if (!props.suppressItemClicked) {
                    (e.target as HTMLElement).dispatchEvent(new Event('menuItemClicked'))
                }
                props.onClick(props.id)
                e.stopPropagation()
            }}
        >
            {props.icon ? <div class='menu-option__icon'>{props.icon}</div> : <div class='noicon'/>}
            <div class='menu-name'>{props.name}</div>
            <Switch
                isOn={props.isOn}
                onChanged={() => {}}
            />
        </div>
    )
}

export default SwitchOption
