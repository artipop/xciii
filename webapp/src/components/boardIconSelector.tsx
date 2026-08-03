// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show} from 'solid-js'
import type {Component} from 'solid-js'

import {BlockIcons} from '../blockIcons'
import {Board} from '../blocks/board'

import mutator from '../mutator'

import IconSelector from './iconSelector'

type Props = {
    board: Board
    size?: 's' | 'm' | 'l'
    readonly?: boolean
}

const BoardIconSelector: Component<Props> = (props) => {
    const onSelectEmoji = (emoji: string) => {
        mutator.changeBoardIcon(props.board.id, props.board.icon, emoji)
        document.body.click()
    }
    const onAddRandomIcon = () => mutator.changeBoardIcon(props.board.id, props.board.icon, BlockIcons.shared.randomIcon())
    const onRemoveIcon = () => mutator.changeBoardIcon(props.board.id, props.board.icon, '', 'remove board icon')

    const className = () => {
        let name = `octo-icon size-${props.size || 'm'}`
        if (props.readonly) {
            name += ' readonly'
        }
        return name
    }

    return (
        <Show when={props.board.icon}>
            <IconSelector
                readonly={props.readonly}
                iconElement={<div class={className()}><span>{props.board.icon}</span></div>}
                onAddRandomIcon={onAddRandomIcon}
                onSelectEmoji={onSelectEmoji}
                onRemoveIcon={onRemoveIcon}
            />
        </Show>
    )
}

export default BoardIconSelector
