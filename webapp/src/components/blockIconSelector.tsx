// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show} from 'solid-js'

import {BlockIcons} from '../blockIcons'
import {Card} from '../blocks/card'
import mutator from '../mutator'

import IconSelector from './iconSelector'

type Props = {
    block: Card
    size?: 's' | 'm' | 'l'
    readonly?: boolean
}

const BlockIconSelector = (props: Props) => {
    const onSelectEmoji = (emoji: string) => {
        mutator.changeBlockIcon(props.block.boardId, props.block.id, props.block.fields.icon, emoji)
        document.body.click()
    }
    const onAddRandomIcon = () => mutator.changeBlockIcon(props.block.boardId, props.block.id, props.block.fields.icon, BlockIcons.shared.randomIcon())
    const onRemoveIcon = () => mutator.changeBlockIcon(props.block.boardId, props.block.id, props.block.fields.icon, '', 'remove icon')

    // Setting an icon on a card that had none has to make the selector appear,
    // and removing it has to make it go away.
    const className = () => `octo-icon size-${props.size || 'm'}${props.readonly ? ' readonly' : ''}`
    const iconElement = () => <div class={className()}><span>{props.block.fields.icon}</span></div>

    return (
        <Show when={props.block.fields.icon}>
            <IconSelector
                readonly={props.readonly}
                iconElement={iconElement()}
                onAddRandomIcon={onAddRandomIcon}
                onSelectEmoji={onSelectEmoji}
                onRemoveIcon={onRemoveIcon}
            />
        </Show>
    )
}

export default BlockIconSelector
