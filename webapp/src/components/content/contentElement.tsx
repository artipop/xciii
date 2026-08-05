// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {JSX} from 'solid-js'

import {ContentBlock} from '../../blocks/contentBlock'
import {Utils} from '../../utils'

import {useCardDetailContext} from '../cardDetail/cardDetailContext'

import {contentRegistry} from './contentRegistry'

// Need to require here to prevent the bundler from tree-shaking these away
import './textElement'
import './imageElement'
import './dividerElement'
import './checkboxElement'

type Props = {
    block: ContentBlock
    readonly: boolean
    cords: {x: number, y?: number, z?: number}
}

export default function ContentElement(props: Props): JSX.Element|null {
    const cardDetail = useCardDetailContext()

    const handler = contentRegistry.getHandler(props.block.type)

    const addElement = () => {
        if (!handler) {
            return
        }
        const index = props.cords.x + 1
        cardDetail.addBlock(handler, index, true)
    }

    const deleteElement = () => {
        const index = props.cords.x
        cardDetail.deleteBlock(props.block, index)
    }

    if (!handler) {
        Utils.logError(`ContentElement, unknown content type: ${props.block.type}`)
        return null
    }

    return handler.createComponent(props.block, props.readonly, addElement, deleteElement)
}
