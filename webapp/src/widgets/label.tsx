import type {JSX} from 'solid-js'

import {Constants} from '../constants'

import './label.scss'

type Props = {
    color?: string
    title?: string
    children: JSX.Element
    class?: string
}

// Switch is an on-off style switch / checkbox
function Label(props: Props): JSX.Element {
    const color = () => (props.color && props.color in Constants.menuColors ? props.color : 'empty')
    return (
        <span
            class={`Label ${color()} ${props.class ? props.class : ''}`}
            title={props.title}
        >
            {props.children}
        </span>
    )
}

export default Label
