// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {batch} from 'solid-js'
import {reconcile} from 'solid-js/store'

import {Subscription} from '../wsclient'
import {ErrorId} from '../errors'
import {Board} from '../blocks/board'
import {parseUserProps} from '../user'

import {viewsFromBlocks} from './views'
import {cardsFromBlocks} from './cards'
import {contentsFromBlocks} from './contents'
import {commentsFromBlocks} from './comments'
import {attachmentsFromBlocks} from './attachments'
import {defaultLimits} from './limits'

import type {StoreContext} from './context'

import type {RootState} from './index'

// The loaders that used to be thunks with a fan-out of extraReducers: one
// fetch, many domains. Each applies its whole result in a single batch so the
// UI never sees a half-loaded board.
export const createInitialLoadActions = (ctx: StoreContext) => {
    const {setState, deps} = ctx

    // Full board-content rebuild shared by initialReadOnlyLoad and
    // loadBoardData. reconcile keeps identity of unchanged blocks, so a reload
    // does not redraw every card.
    const applyBlocks = (blocks: Parameters<typeof viewsFromBlocks>[0]) => {
        const {cards, templates} = cardsFromBlocks(blocks)
        setState('views', 'views', reconcile(viewsFromBlocks(blocks)))
        setState('cards', 'cards', reconcile(cards))
        setState('cards', 'templates', reconcile(templates))
        setState('contents', reconcile(contentsFromBlocks(blocks)))
        setState('comments', reconcile(commentsFromBlocks(blocks)))
        setState('attachments', reconcile(attachmentsFromBlocks(blocks)))
    }

    return {
        async initialLoad() {
            try {
                const [me, myConfig, team, teams, boards, boardsMemberships, boardTemplates, limits] = await Promise.all([
                    deps.client.getMe(),
                    deps.client.getMyConfig(),
                    deps.client.getTeam(),
                    deps.client.getTeams(),
                    deps.client.getBoards(),
                    deps.client.getMyBoardMemberships(),
                    deps.client.getTeamTemplates(),
                    deps.client.getBoardsCloudLimits(),
                ])

                // if no me, normally user not logged in
                if (!me) {
                    throw new Error(ErrorId.NotLoggedIn)
                }

                // if no team, either bad id, or user doesn't have access
                if (!team) {
                    throw new Error(ErrorId.TeamUndefined)
                }

                batch(() => {
                    setState('teams', 'current', team)
                    setState('teams', 'allTeams', [...teams].sort((a, b) => (a.title < b.title ? -1 : 1)))

                    setState('boards', 'boards', boards.reduce((acc: {[key: string]: Board}, b: Board) => {
                        acc[b.id] = b
                        return acc
                    }, {}))
                    setState('boards', 'templates', boardTemplates.reduce((acc: {[key: string]: Board}, b: Board) => {
                        acc[b.id] = b
                        return acc
                    }, {}))
                    setState('boards', 'myBoardMemberships', boardsMemberships.reduce((acc: {[key: string]: typeof boardsMemberships[0]}, m) => {
                        acc[m.boardId] = m
                        return acc
                    }, {}))

                    setState('cards', 'limitTimestamp', limits?.card_limit_timestamp || 0)
                    setState('limits', 'limits', limits || defaultLimits)
                    if (myConfig) {
                        setState('users', 'myConfig', parseUserProps(myConfig))
                    }
                })

                return {team, teams, boards, boardsMemberships, boardTemplates, limits, myConfig}
            } catch (e) {
                setState('globalError', 'value', (e as Error).message || '')
                throw e
            }
        },

        async initialReadOnlyLoad(boardId: string) {
            try {
                const [board, blocks] = await Promise.all([
                    deps.client.getBoard(boardId),
                    deps.client.getAllBlocks(boardId),
                ])

                // if no board, read_token invalid
                if (!board) {
                    throw new Error(ErrorId.InvalidReadOnlyBoard)
                }

                batch(() => {
                    const boards: {[key: string]: Board} = {}
                    const templates: {[key: string]: Board} = {}
                    if (board.isTemplate) {
                        templates[board.id] = board
                    } else {
                        boards[board.id] = board
                    }
                    setState('boards', 'boards', reconcile(boards))
                    setState('boards', 'templates', reconcile(templates))
                    applyBlocks(blocks)
                })

                return {board, blocks}
            } catch (e) {
                setState('globalError', 'value', (e as Error).message || '')
                throw e
            }
        },

        async loadBoardData(boardID: string) {
            setState('boards', 'loadingBoard', true)
            try {
                const blocks = await deps.client.getAllBlocks(boardID)
                batch(() => {
                    applyBlocks(blocks)
                    setState('boards', 'loadingBoard', false)
                })
                return {blocks}
            } catch (e) {
                setState('boards', 'loadingBoard', false)
                throw e
            }
        },

        async loadBoards() {
            const boards = await deps.client.getBoards()
            setState('boards', 'boards', reconcile(boards.reduce((acc: {[key: string]: Board}, b: Board) => {
                acc[b.id] = b
                return acc
            }, {})))
            return {boards}
        },

        async loadMyBoardsMemberships() {
            const boardsMemberships = await deps.client.getMyBoardMemberships()
            setState('boards', 'myBoardMemberships', reconcile(boardsMemberships.reduce((acc: {[key: string]: typeof boardsMemberships[0]}, m) => {
                acc[m.boardId] = m
                return acc
            }, {})))
            return {boardsMemberships}
        },
    }
}

export const getUserBlockSubscriptions = (state: RootState): Subscription[] => state.users.blockSubscriptions

export const getUserBlockSubscriptionList = (state: RootState): Subscription[] => getUserBlockSubscriptions(state)
