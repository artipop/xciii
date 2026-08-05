// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {batch} from 'solid-js'
import {produce} from 'solid-js/store'

import {Board, BoardMember} from '../blocks/board'
import {IUser} from '../user'

import type {StoreContext} from './context'

import type {RootState} from './index'

export type BoardsState = {
    current: string
    loadingBoard: boolean
    linkToChannel: string
    boards: {[key: string]: Board}
    templates: {[key: string]: Board}
    membersInBoards: {[key: string]: {[key: string]: BoardMember}}
    myBoardMemberships: {[key: string]: BoardMember}
}

export const initialBoardsState = (): BoardsState => ({
    current: '',
    loadingBoard: false,
    linkToChannel: '',
    boards: {},
    templates: {},
    membersInBoards: {},
    myBoardMemberships: {},
})

const isDroppedMembership = (member: BoardMember): boolean =>
    !member.schemeAdmin && !member.schemeEditor && !member.schemeViewer && !member.schemeCommenter

// Shared by updateMembers and updateMembersEnsuringBoardsAndUsers, as the
// reducer used to be.
const applyMembersUpdate = (state: BoardsState, members: BoardMember[]) => {
    if (members.length === 0) {
        return
    }

    const boardId = members[0].boardId
    const boardMembers = state.membersInBoards[boardId] || {}
    state.membersInBoards[boardId] = boardMembers

    for (const member of members) {
        if (isDroppedMembership(member)) {
            delete boardMembers[member.userId]
        } else {
            boardMembers[member.userId] = member
        }
    }

    for (const member of members) {
        if (state.myBoardMemberships[member.boardId] && state.myBoardMemberships[member.boardId].userId === member.userId) {
            if (isDroppedMembership(member)) {
                delete state.myBoardMemberships[member.boardId]
            } else {
                state.myBoardMemberships[member.boardId] = member
            }
        }
    }
}

export const createBoardsActions = (ctx: StoreContext) => {
    const {state, setState, deps} = ctx

    const actions = {
        setCurrent(boardId: string) {
            setState('boards', 'current', boardId)
        },
        setLinkToChannel(channelId: string) {
            setState('boards', 'linkToChannel', channelId)
        },
        setLoadingBoard(loading: boolean) {
            setState('boards', 'loadingBoard', loading)
        },
        updateBoards(boards: Board[]) {
            setState('boards', produce((s) => {
                for (const board of boards) {
                    if (board.deleteAt !== 0) {
                        delete s.boards[board.id]
                        delete s.templates[board.id]
                    } else if (board.isTemplate) {
                        s.templates[board.id] = board
                    } else {
                        s.boards[board.id] = board
                    }
                }
            }))
        },
        updateMembers(members: BoardMember[]) {
            setState('boards', produce((s) => applyMembersUpdate(s, members)))
        },
        addMyBoardMemberships(members: BoardMember[]) {
            setState('boards', 'myBoardMemberships', produce((memberships) => {
                members.forEach((member) => {
                    if (isDroppedMembership(member)) {
                        delete memberships[member.boardId]
                    } else {
                        memberships[member.boardId] = member
                    }
                })
            }))
        },

        // The full-load slices of this domain, called by the cross-domain
        // loaders in initialLoad.ts.
        setBoardsAndTemplates(boards: Board[], templates: Board[]) {
            batch(() => {
                setState('boards', 'boards', boards.reduce((acc: {[key: string]: Board}, b) => {
                    acc[b.id] = b
                    return acc
                }, {}))
                setState('boards', 'templates', templates.reduce((acc: {[key: string]: Board}, b) => {
                    acc[b.id] = b
                    return acc
                }, {}))
            })
        },
        setMyBoardMemberships(members: BoardMember[]) {
            setState('boards', 'myBoardMemberships', members.reduce((acc: {[key: string]: BoardMember}, m) => {
                acc[m.boardId] = m
                return acc
            }, {}))
        },
        async fetchBoardMembers({teamId, boardId}: {teamId: string, boardId: string}, setBoardUsers: (users: IUser[]) => void): Promise<void> {
            const members = await deps.client.getBoardMembers(teamId, boardId)
            const userIDs = members.map((member) => member.userId)

            const usersData = await deps.client.getTeamUsersList(userIDs, teamId)
            setBoardUsers(usersData)

            if (members.length === 0) {
                return
            }

            // all members should belong to the same boardId, so we
            // get it from the first one
            const membersBoardId = members[0].boardId
            const boardMembersMap = members.reduce((acc: {[key: string]: BoardMember}, val: BoardMember) => {
                acc[val.userId] = val
                return acc
            }, {})
            setState('boards', 'membersInBoards', membersBoardId, boardMembersMap)
        },
        async updateMembersEnsuringBoardsAndUsers(
            members: BoardMember[],
            userActions: {addBoardUsers: (users: IUser[]) => void, removeBoardUsersById: (ids: string[]) => void},
        ): Promise<void> {
            const me = state.users.me
            if (me) {
                // ensure the boards for the new memberships get loaded or removed
                const boards = state.boards.boards
                const myMemberships = members.filter((m) => m.userId === me.id)
                const boardsToUpdate: Board[] = []
                /* eslint-disable no-await-in-loop */
                for (const member of myMemberships) {
                    if (isDroppedMembership(member)) {
                        boardsToUpdate.push({id: member.boardId, deleteAt: 1} as Board)
                        continue
                    }

                    if (boards[member.boardId]) {
                        continue
                    }

                    const board = await deps.client.getBoard(member.boardId)
                    if (board) {
                        boardsToUpdate.push(board)
                    }
                }
                /* eslint-enable no-await-in-loop */

                actions.updateBoards(boardsToUpdate)
            }

            // ensure the users for the new memberships get loaded
            const boardUsers = state.users.boardUsers
            members.forEach(async (m) => {
                if (isDroppedMembership(m)) {
                    userActions.removeBoardUsersById([m.userId])
                    return
                }
                if (boardUsers[m.userId]) {
                    return
                }

                const board = await deps.client.getBoard(m.boardId)
                if (board) {
                    const user = await deps.client.getTeamUsersList([m.userId], board.teamId)
                    if (user) {
                        userActions.addBoardUsers(user)
                    }
                }
            })

            actions.updateMembers(members)
        },
    }
    return actions
}

export const getBoards = (state: RootState): {[key: string]: Board} => state.boards?.boards || {}

export const getMySortedBoards = (state: RootState): Board[] => {
    const myBoardMemberships = state.boards?.myBoardMemberships || {}
    return Object.values(getBoards(state)).filter((b) => myBoardMemberships[b.id]).
        sort((a, b) => a.title.localeCompare(b.title))
}

export const getTemplates = (state: RootState): {[key: string]: Board} => state.boards.templates

export const getSortedTemplates = (state: RootState): Board[] =>
    Object.values(getTemplates(state)).sort((a, b) => a.title.localeCompare(b.title))

export function getBoard(boardId: string): (state: RootState) => Board|null {
    return (state: RootState): Board|null => {
        if (state.boards.boards && state.boards.boards[boardId]) {
            return state.boards.boards[boardId]
        } else if (state.boards.templates && state.boards.templates[boardId]) {
            return state.boards.templates[boardId]
        }
        return null
    }
}

export const isLoadingBoard = (state: RootState): boolean => state.boards.loadingBoard

export const getCurrentBoardId = (state: RootState): string => state.boards.current || ''

export const getCurrentBoard = (state: RootState): Board => {
    const boardId = getCurrentBoardId(state)
    return getBoards(state)[boardId] || getTemplates(state)[boardId]
}

export const getCurrentBoardMembers = (state: RootState): {[key: string]: BoardMember} => {
    return state.boards.membersInBoards[state.boards.current] || {}
}

export function getMyBoardMembership(boardId: string): (state: RootState) => BoardMember|null {
    return (state: RootState): BoardMember|null => {
        return state.boards.myBoardMemberships[boardId] || null
    }
}

export const getCurrentLinkToChannel = (state: RootState): string => state.boards.linkToChannel
