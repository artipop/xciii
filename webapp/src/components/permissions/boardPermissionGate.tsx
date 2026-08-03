// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Show} from 'solid-js'
import type {JSX, ParentComponent} from 'solid-js'

import {useAppSelector} from '../../store/hooks'
import {getCurrentBoardId} from '../../store/boards'
import {getCurrentTeam} from '../../store/teams'
import {Permission} from '../../constants'
import {useHasPermissions} from '../../hooks/permissions'

type Props = {
    boardId?: string
    teamId?: string
    permissions: Permission[]
    invert?: boolean
}

const BoardPermissionGate: ParentComponent<Props> = (props): JSX.Element => {
    const currentTeam = useAppSelector(getCurrentTeam)
    const currentBoardId = useAppSelector(getCurrentBoardId)

    const boardId = () => props.boardId || currentBoardId() || ''
    const teamId = () => props.teamId || currentTeam()?.id || ''

    const allowed = useHasPermissions(teamId, boardId, props.permissions)

    return (
        <Show when={props.invert ? !allowed() : allowed()}>
            {props.children}
        </Show>
    )
}

export default BoardPermissionGate
