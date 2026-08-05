// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {createContext, createSignal, useContext} from 'solid-js'
import type {JSX, ParentComponent} from 'solid-js'

import {useIntl} from '../../intl'

import {Block} from '../../blocks/block'
import {Card} from '../../blocks/card'
import {ContentHandler} from '../content/contentRegistry'
import octoClient from '../../octoClient'
import mutator from '../../mutator'

export type AddedBlock = {
    id: string
    autoAdded: boolean
}

export type CardDetailContextType = {
    card: Card
    lastAddedBlock: AddedBlock
    addBlock: (handler: ContentHandler, index: number, auto: boolean) => void
    deleteBlock: (block: Block, index: number) => void
}

export const CardDetailContext = createContext<CardDetailContextType | null>(null)

export function useCardDetailContext(): CardDetailContextType {
    const cardDetailContext = useContext(CardDetailContext)
    if (!cardDetailContext) {
        throw new Error('CardDetailContext is not available!')
    }
    return cardDetailContext
}

type CardDetailProps = {
    card: Card
}

export const CardDetailProvider: ParentComponent<CardDetailProps> = (props): JSX.Element => {
    const intl = useIntl()
    const [lastAddedBlock, setLastAddedBlock] = createSignal<AddedBlock>({
        id: '',
        autoAdded: false,
    })
    const addBlock = async (handler: ContentHandler, index: number, auto: boolean) => {
        const card = props.card
        const block = await handler.createBlock(card.boardId, intl)
        block.parentId = card.id
        block.boardId = card.boardId
        const typeName = handler.getDisplayText(intl)
        const description = intl.formatMessage({id: 'ContentBlock.addElement', defaultMessage: 'add {type}'}, {type: typeName})
        await mutator.performAsUndoGroup(async () => {
            const afterRedo = async (newBlock: Block) => {
                const contentOrder = card.fields.contentOrder.slice()
                contentOrder.splice(index, 0, newBlock.id)
                await octoClient.patchBlock(card.boardId, card.id, {updatedFields: {contentOrder}})
            }

            const beforeUndo = async () => {
                const contentOrder = card.fields.contentOrder.slice()
                await octoClient.patchBlock(card.boardId, card.id, {updatedFields: {contentOrder}})
            }

            const insertedBlock = await mutator.insertBlock(block.boardId, block, description, afterRedo, beforeUndo)
            setLastAddedBlock({id: insertedBlock.id, autoAdded: auto})
        })
    }

    const deleteBlock = async (block: Block, index: number) => {
        const card = props.card
        const contentOrder = card.fields.contentOrder.slice()
        contentOrder.splice(index, 1)
        const description = intl.formatMessage({id: 'ContentBlock.DeleteAction', defaultMessage: 'delete'})
        await mutator.performAsUndoGroup(async () => {
            await mutator.deleteBlock(block, description)
            await mutator.changeCardContentOrder(card.boardId, card.id, card.fields.contentOrder, contentOrder, description)
        })
    }

    // Live getters: consumers read card and lastAddedBlock through the context
    // object, and both must follow the store and the signal.
    const contextValue: CardDetailContextType = {
        get card() {
            return props.card
        },
        get lastAddedBlock() {
            return lastAddedBlock()
        },
        addBlock,
        deleteBlock,
    }

    return (
        <CardDetailContext.Provider value={contextValue}>
            {props.children}
        </CardDetailContext.Provider>
    )
}
