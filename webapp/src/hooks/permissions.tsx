// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Accessor} from 'solid-js'

import {useAppSelector} from '../store/hooks'
import {getMyBoardMembership, getCurrentBoardId, getBoard} from '../store/boards'
import {getCurrentTeam} from '../store/teams'
import {Permission} from '../constants'
import {MemberRole} from '../blocks/board'

type MaybeAccessor = string | Accessor<string>
const read = (v: MaybeAccessor): string => (typeof v === 'function' ? v() : v)

// Under React these returned booleans recomputed per render; here they return
// accessors, and the ids may be accessors too, so a permission revoked over
// the WebSocket — or a board switch — disables the UI it guards.
export const useHasPermissions = (teamId: MaybeAccessor, boardId: MaybeAccessor, permissions: Permission[]): Accessor<boolean> => {
    const member = useAppSelector((state) => (read(boardId) && read(teamId) ? getMyBoardMembership(read(boardId))(state) : null))
    const board = useAppSelector((state) => (read(boardId) && read(teamId) ? getBoard(read(boardId))(state) : null))

    return () => {
        if (!(read(boardId) && read(teamId))) {
            return false
        }

        const currentBoard = board()
        const currentMember = member()
        if (!currentBoard || !currentMember) {
            return false
        }

        const adminPermissions = [Permission.ManageBoardType, Permission.DeleteBoard, Permission.ShareBoard, Permission.ManageBoardRoles, Permission.DeleteOthersComments]
        const editorPermissions = [Permission.ManageBoardCards, Permission.ManageBoardProperties]
        const commenterPermissions = [Permission.CommentBoardCards]
        const viewerPermissions = [Permission.ViewBoard]

        for (const permission of permissions) {
            if (adminPermissions.includes(permission) && currentMember.schemeAdmin) {
                return true
            }
            if (editorPermissions.includes(permission) && (currentMember.schemeAdmin || currentMember.schemeEditor || currentBoard.minimumRole === MemberRole.Editor)) {
                return true
            }
            if (commenterPermissions.includes(permission) && (currentMember.schemeAdmin || currentMember.schemeEditor || currentMember.schemeCommenter || currentBoard.minimumRole === MemberRole.Commenter || currentBoard.minimumRole === MemberRole.Editor)) {
                return true
            }
            if (viewerPermissions.includes(permission) && (currentMember.schemeAdmin || currentMember.schemeEditor || currentMember.schemeCommenter || currentMember.schemeViewer || currentBoard.minimumRole === MemberRole.Viewer || currentBoard.minimumRole === MemberRole.Commenter || currentBoard.minimumRole === MemberRole.Editor)) {
                return true
            }
        }
        return false
    }
}

export const useHasCurrentTeamPermissions = (boardId: MaybeAccessor, permissions: Permission[]): Accessor<boolean> => {
    const currentTeam = useAppSelector(getCurrentTeam)
    return useHasPermissions(() => currentTeam()?.id || '', boardId, permissions)
}

export const useHasCurrentBoardPermissions = (permissions: Permission[]): Accessor<boolean> => {
    const currentBoardId = useAppSelector(getCurrentBoardId)

    return useHasCurrentTeamPermissions(() => currentBoardId() || '', permissions)
}
