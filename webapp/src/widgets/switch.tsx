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
    const switchSize = `size--${props.size === 'medium' ? 'medium' : 'small'}`
    const switchIsOn = props.isOn ? ' on' : ''
    const switchIsReadonly = props.readOnly ? ' readonly' : ''
    const className = `Switch override-main ${switchSize}${switchIsOn}${switchIsReadonly}`
    return (
        <div
            class={className}
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
