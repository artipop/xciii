// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import type {JSX} from 'solid-js'

import './switch.scss'

type Props = {
    onChanged: (isOn: boolean) => void
    isOn: boolean
    readOnly?: boolean
    size?: string
}

// Switch is an on-off style switch / checkbox
function Switch(props: Props): JSX.Element {
    // Computed on read: a switch that never restyles when isOn flips is not a
    // switch.
    const classes = () => {
        const switchSize = `size--${props.size === 'medium' ? 'medium' : 'small'}`
        const switchIsOn = props.isOn ? ' on' : ''
        const switchIsReadonly = props.readOnly ? ' readonly' : ''
        return `Switch override-main ${switchSize}${switchIsOn}${switchIsReadonly}`
    }
    return (
        <div
            class={classes()}
            onClick={() => {
                if (!props.readOnly) {
                    props.onChanged(!props.isOn)
                }
            }}
        >
            <div class='octo-switch-inner'/>
        </div>
    )
}

export default Switch
