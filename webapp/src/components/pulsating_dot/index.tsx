// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import type {JSX} from 'solid-js'

import './pulsating_dot.scss'
import {Coords} from '../tutorial_tour_tip/tutorial_tour_tip_backdrop'

type Props = {
    class?: string
    onClick?: (e: MouseEvent) => void
    coords?: Coords
}

const PulsatingDot = (props: Props): JSX.Element => {
    // The dot follows the punchout it points at, so its transform is read on
    // every change of coords rather than fixed at creation.
    const customStyles = () => (props.coords ? {transform: `translate(${props.coords.x}px, ${props.coords.y}px)`} : {})
    const effectiveClassName = () => {
        let name = 'pulsating_dot'
        if (props.onClick) {
            name += ' pulsating_dot-clickable'
        }
        if (props.class) {
            name += ' ' + props.class
        }
        return name
    }

    return (
        <span
            class={effectiveClassName()}
            onClick={props.onClick}
            style={customStyles()}
        />
    )
}

export default PulsatingDot
