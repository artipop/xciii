// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import type {JSX} from 'solid-js'

import {MenuOptionProps} from './menuItem'

type TextOptionProps = MenuOptionProps & {
    check?: boolean
    icon?: JSX.Element
    rightIcon?: JSX.Element
    className?: string
    subText?: string
    disabled?: boolean
}

function TextOption(props: TextOptionProps): JSX.Element {
    const {name, icon, rightIcon, check, subText, disabled} = props
    let className = 'MenuOption TextOption menu-option'
    if (props.className) {
        className += ' ' + props.className
    }
    if (subText) {
        className += ' menu-option--with-subtext'
    }
    if (disabled) {
        className += ' menu-option--disabled'
    }

    return (
        <div
            role='button'
            aria-label={name}
            class={className}
            onClick={(e: MouseEvent) => {
                (e.target as HTMLElement).dispatchEvent(new Event('menuItemClicked'))
                props.onClick(props.id)
                e.stopPropagation()
            }}
        >
            <div class={`${check ? 'd-flex menu-option__check' : 'd-flex'}`}>{icon ? <div class='menu-option__icon'>{icon}</div> : <div class='noicon'/>}</div>
            <div class='menu-option__content'>
                <div class='menu-name'>{name}</div>
                {subText && <div class='menu-subtext text-75 mt-1'>{subText}</div>}
            </div>
            {rightIcon ?? <div class='noicon'/>}
        </div>
    )
}

export default TextOption
