// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import type {JSX} from 'solid-js'

import {Constants} from '../constants'

import './label.scss'

type Props = {
    color?: string
    title?: string
    children: JSX.Element
    className?: string
}

// Switch is an on-off style switch / checkbox
function Label(props: Props): JSX.Element {
    let color = 'empty'
    if (props.color && props.color in Constants.menuColors) {
        color = props.color
    }
    return (
        <span
            class={`Label ${color} ${props.className ? props.className : ''}`}
            title={props.title}
        >
            {props.children}
        </span>
    )
}

export default Label
