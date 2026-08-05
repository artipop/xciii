// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show} from 'solid-js'
import type {JSX} from 'solid-js'

import {MenuOptionProps} from './menuItem'

type TextOptionProps = MenuOptionProps & {
    check?: boolean
    icon?: JSX.Element
    rightIcon?: JSX.Element
    class?: string
    subText?: string
    disabled?: boolean
}

function TextOption(props: TextOptionProps): JSX.Element {
    const classes = () => {
        let name = 'MenuOption TextOption menu-option'
        if (props.class) {
            name += ' ' + props.class
        }
        if (props.subText) {
            name += ' menu-option--with-subtext'
        }
        if (props.disabled) {
            name += ' menu-option--disabled'
        }
        return name
    }

    return (
        <div
            role='button'
            aria-label={props.name}
            class={classes()}
            onClick={(e: MouseEvent) => {
                (e.target as HTMLElement).dispatchEvent(new Event('menuItemClicked'))
                props.onClick(props.id)
                e.stopPropagation()
            }}
        >
            <div class={`${props.check ? 'd-flex menu-option__check' : 'd-flex'}`}>{props.icon ? <div class='menu-option__icon'>{props.icon}</div> : <div class='noicon'/>}</div>
            <div class='menu-option__content'>
                <div class='menu-name'>{props.name}</div>
                <Show when={props.subText}>
                    <div class='menu-subtext text-75 mt-1'>{props.subText}</div>
                </Show>
            </div>
            {props.rightIcon ?? <div class='noicon'/>}
        </div>
    )
}

export default TextOption
