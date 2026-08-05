// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import type {JSX} from 'solid-js'

import './tooltip.scss'

type Props = {
    title: string
    children: JSX.Element
    placement?: 'top'|'left'|'right'|'bottom'
}

// Adds tooltip div over children elements, the popup will
// be positioned based on the specified placement
// Default position is 'top'
function Tooltip(props: Props): JSX.Element {
    const classes = () => `octo-tooltip tooltip-${props.placement || 'top'}`
    return (
        <div
            class={classes()}
            data-tooltip={props.title}
        >
            {props.children}
        </div>
    )
}

export default Tooltip
