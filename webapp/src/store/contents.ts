// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {produce} from 'solid-js/store'

import {ContentBlock} from '../blocks/contentBlock'
import {Block} from '../blocks/block'

import {getCards, getTemplates} from './cards'

import type {StoreContext} from './context'

import type {RootState} from './index'

export type ContentsState = {
    contents: {[key: string]: ContentBlock}
    contentsByCard: {[key: string]: ContentBlock[]}
}

export const initialContentsState = (): ContentsState => ({contents: {}, contentsByCard: {}})

// Everything that is not a board, view or comment is card content. Full board
// (re)loads rebuild both maps from the block list.
export const contentsFromBlocks = (blocks: Block[]): ContentsState => {
    const next: ContentsState = {contents: {}, contentsByCard: {}}
    for (const block of blocks) {
        if (block.type !== 'board' && block.type !== 'view' && block.type !== 'comment') {
            next.contents[block.id] = block as ContentBlock
            next.contentsByCard[block.parentId] = next.contentsByCard[block.parentId] || []
            next.contentsByCard[block.parentId].push(block as ContentBlock)
            next.contentsByCard[block.parentId].sort((a, b) => a.createAt - b.createAt)
        }
    }
    return next
}

export const createContentsActions = ({setState}: StoreContext) => ({
    updateContents(contents: ContentBlock[]) {
        setState('contents', produce((state) => {
            for (const content of contents) {
                if (content.deleteAt === 0) {
                    let existsInParent = false
                    state.contents[content.id] = content
                    if (!state.contentsByCard[content.parentId]) {
                        state.contentsByCard[content.parentId] = [content]
                        return
                    }
                    for (let i = 0; i < state.contentsByCard[content.parentId].length; i++) {
                        if (state.contentsByCard[content.parentId][i].id === content.id) {
                            state.contentsByCard[content.parentId][i] = content
                            existsInParent = true
                            break
                        }
                    }
                    if (!existsInParent) {
                        state.contentsByCard[content.parentId].push(content)
                    }
                } else {
                    const parentId = state.contents[content.id]?.parentId
                    if (!state.contentsByCard[parentId]) {
                        delete state.contents[content.id]
                        return
                    }
                    for (let i = 0; i < state.contentsByCard[parentId].length; i++) {
                        if (state.contentsByCard[parentId][i].id === content.id) {
                            state.contentsByCard[parentId].splice(i, 1)
                        }
                    }
                    delete state.contents[content.id]
                }
            }
        }))
    },
    setContents(next: ContentsState) {
        setState('contents', next)
    },
})

export const getContentsById = (state: RootState): {[key: string]: ContentBlock} => state.contents.contents

export const getContents = (state: RootState): ContentBlock[] => Object.values(getContentsById(state))

export function getCardContents(cardId: string): (state: RootState) => Array<ContentBlock|ContentBlock[]> {
    return (state: RootState): Array<ContentBlock|ContentBlock[]> => {
        const contents = (state.contents?.contentsByCard && state.contents.contentsByCard[cardId]) || []
        const contentOrder = getCards(state)[cardId]?.fields?.contentOrder || getTemplates(state)[cardId]?.fields?.contentOrder
        const result: Array<ContentBlock|ContentBlock[]> = []
        if (!contents) {
            return []
        }
        if (contentOrder) {
            for (const contentId of contentOrder) {
                if (typeof contentId === 'string') {
                    const content = contents.find((c) => c.id === contentId)
                    if (content) {
                        result.push(content)
                    }
                } else if (typeof contentId === 'object' && contentId) {
                    const subResult: ContentBlock[] = []
                    for (const subContentId of contentId) {
                        if (typeof subContentId === 'string') {
                            const subContent = contents.find((c) => c.id === subContentId)
                            if (subContent) {
                                subResult.push(subContent)
                            }
                        }
                    }
                    result.push(subResult)
                }
            }
        }
        return result
    }
}

export function getLastCardContent(cardId: string): (state: RootState) => ContentBlock|undefined {
    return (state: RootState): ContentBlock|undefined => {
        const contents = state.contents?.contentsByCard && state.contents?.contentsByCard[cardId]
        return contents?.[contents?.length - 1]
    }
}
