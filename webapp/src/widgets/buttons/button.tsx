// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import type {JSX} from 'solid-js'

import './button.scss'
import {Utils} from '../../utils'

type Props = {
    onClick?: (e: MouseEvent) => void
    onMouseOver?: (e: MouseEvent) => void
    onMouseLeave?: (e: MouseEvent) => void
    onBlur?: (e: FocusEvent) => void
    children?: JSX.Element
    title?: string
    icon?: JSX.Element
    filled?: boolean
    active?: boolean
    submit?: boolean
    emphasis?: string
    size?: string
    danger?: boolean
    class?: string
    rightIcon?: boolean
    disabled?: boolean
}

function Button(props: Props): JSX.Element {
    // A function, not an object: the class of a button that becomes active or
    // changes emphasis has to be recomputed, and only a call inside the JSX
    // re-runs when those props change.
    const classNames = (): Record<string, boolean> => ({
        Button: true,
        active: Boolean(props.active),
        filled: Boolean(props.filled),
        danger: Boolean(props.danger),
        [`emphasis--${props.emphasis}`]: Boolean(props.emphasis),
        [`size--${props.size}`]: Boolean(props.size),
        [`${props.class}`]: Boolean(props.class),
    })

    return (
        <button
            type={props.submit ? 'submit' : 'button'}
            onClick={props.onClick}
            onMouseOver={props.onMouseOver}
            onMouseLeave={props.onMouseLeave}
            class={Utils.generateClassName(classNames())}
            title={props.title}
            onBlur={props.onBlur}
            disabled={props?.disabled}
        >
            {!props.rightIcon && props.icon}
            <span>{props.children}</span>
            {props.rightIcon && props.icon}
        </button>
    )
}

export default Button
