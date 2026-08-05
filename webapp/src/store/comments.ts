// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {produce} from 'solid-js/store'

import {CommentBlock} from '../blocks/commentBlock'
import {Block} from '../blocks/block'

import type {StoreContext} from './context'

import type {RootState} from './index'

export type CommentsState = {
    comments: {[key: string]: CommentBlock}
    commentsByCard: {[key: string]: CommentBlock[]}
}

export const initialCommentsState = (): CommentsState => ({comments: {}, commentsByCard: {}})

// Full board (re)loads rebuild both maps from the block list.
export const commentsFromBlocks = (blocks: Block[]): CommentsState => {
    const next: CommentsState = {comments: {}, commentsByCard: {}}
    for (const block of blocks) {
        if (block.type === 'comment') {
            next.comments[block.id] = block as CommentBlock
            next.commentsByCard[block.parentId] = next.commentsByCard[block.parentId] || []
            next.commentsByCard[block.parentId].push(block as CommentBlock)
        }
    }
    Object.values(next.commentsByCard).forEach((comment) => comment.sort((a, b) => a.createAt - b.createAt))
    return next
}

export const createCommentsActions = ({setState}: StoreContext) => ({
    updateComments(comments: CommentBlock[]) {
        setState('comments', produce((state) => {
            for (const comment of comments) {
                if (comment.deleteAt === 0) {
                    state.comments[comment.id] = comment
                    if (!state.commentsByCard[comment.parentId]) {
                        state.commentsByCard[comment.parentId] = [comment]
                        return
                    }
                    let updated = false
                    for (let i = 0; i < state.commentsByCard[comment.parentId].length; i++) {
                        if (state.commentsByCard[comment.parentId][i].id === comment.id) {
                            state.commentsByCard[comment.parentId][i] = comment
                            updated = true
                            break
                        }
                    }
                    if (updated) {
                        return
                    }
                    state.commentsByCard[comment.parentId].push(comment)
                } else {
                    const parentId = state.comments[comment.id]?.parentId
                    if (!state.commentsByCard[parentId]) {
                        delete state.comments[comment.id]
                        return
                    }
                    for (let i = 0; i < state.commentsByCard[parentId].length; i++) {
                        if (state.commentsByCard[parentId][i].id === comment.id) {
                            state.commentsByCard[parentId].splice(i, 1)
                        }
                    }
                    delete state.comments[comment.id]
                }
            }
        }))
    },
    setComments(next: CommentsState) {
        setState('comments', next)
    },
})

export function getCardComments(cardId: string): (state: RootState) => CommentBlock[] {
    return (state: RootState): CommentBlock[] => {
        return (state.comments?.commentsByCard && state.comments.commentsByCard[cardId]) || []
    }
}

export function getLastCardComment(cardId: string): (state: RootState) => CommentBlock|undefined {
    return (state: RootState): CommentBlock|undefined => {
        const comments = state.comments?.commentsByCard && state.comments.commentsByCard[cardId]
        return comments?.[comments?.length - 1]
    }
}

export const getLastCommentByCard = (state: RootState): {[key: string]: CommentBlock} => {
    const commentsByCard = state.comments?.commentsByCard || null
    const lastCommentByCard: {[key: string]: CommentBlock} = {}
    Object.keys(commentsByCard || {}).forEach((cardId) => {
        if (commentsByCard && commentsByCard[cardId]) {
            const comments = commentsByCard[cardId]
            lastCommentByCard[cardId] = comments?.[comments?.length - 1]
        }
    })
    return lastCommentByCard
}
