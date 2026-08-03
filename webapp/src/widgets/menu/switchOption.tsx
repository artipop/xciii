// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import type {JSX} from 'solid-js'

import Switch from '../switch'

import {MenuOptionProps} from './menuItem'

type SwitchOptionProps = MenuOptionProps & {
    isOn: boolean
    icon?: JSX.Element
    suppressItemClicked?: boolean
}

function SwitchOption(props: SwitchOptionProps): JSX.Element {
    const {name, icon, isOn, suppressItemClicked} = props

    return (
        <div
            class='MenuOption SwitchOption menu-option'
            role='button'
            aria-label={name}
            onClick={(e: MouseEvent) => {
                if (!suppressItemClicked) {
                    (e.target as HTMLElement).dispatchEvent(new Event('menuItemClicked'))
                }
                props.onClick(props.id)
                e.stopPropagation()
            }}
        >
            {icon ? <div class='menu-option__icon'>{icon}</div> : <div class='noicon'/>}
            <div class='menu-name'>{name}</div>
            <Switch
                isOn={isOn}
                onChanged={() => {}}
            />
        </div>
    )
}

export default SwitchOption
