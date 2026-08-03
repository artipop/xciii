// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Show, createSignal} from 'solid-js'
import type {JSX} from 'solid-js'

import {useIntl} from '../../intl'

import MenuWrapper from '../../widgets/menuWrapper'
import Menu from '../../widgets/menu'

import CheckIcon from '../../widgets/icons/check'
import CompassIcon from '../../widgets/icons/compassIcon'

import {Board, createBoard, BoardTypeOpen, BoardTypePrivate, MemberRole, type BoardTypes} from '../../blocks/board'
import {useAppSelector} from '../../store/hooks'
import {getCurrentTeam} from '../../store/teams'
import {getCurrentBoard} from '../../store/boards'
import {Permission} from '../../constants'

import BoardPermissionGate from '../permissions/boardPermissionGate'
import ConfirmationDialogBox from '../confirmationDialogBox'

import mutator from '../../mutator'

async function updateBoardType(board: Board, newType: BoardTypes, newMinimumRole: MemberRole) {
    if (board.type === newType && board.minimumRole === newMinimumRole) {
        return
    }

    const newBoard = createBoard(board)
    newBoard.type = newType
    newBoard.minimumRole = newMinimumRole

    await mutator.updateBoard(newBoard, board, 'update board type')
}

const TeamPermissionsRow = (): JSX.Element => {
    const intl = useIntl()
    const team = useAppSelector(getCurrentTeam)
    const board = useAppSelector(getCurrentBoard)
    const [changeRoleConfirmation, setChangeRoleConfirmation] = createSignal<MemberRole|null>(null)

    const onChangeRole = async () => {
        const confirmation = changeRoleConfirmation()
        if (confirmation !== null) {
            await updateBoardType(board(), BoardTypeOpen, confirmation)
            setChangeRoleConfirmation(null)
        }
    }

    const currentRoleName = () => {
        const currentBoard = board()
        if (currentBoard.type === BoardTypeOpen) {
            if (currentBoard.minimumRole === MemberRole.Editor) {
                if (currentBoard.isTemplate) {
                    return intl.formatMessage({id: 'BoardMember.schemeViewer', defaultMessage: 'Viewer'})
                }
                return intl.formatMessage({id: 'BoardMember.schemeEditor', defaultMessage: 'Editor'})
            } else if (currentBoard.minimumRole === MemberRole.Commenter) {
                return intl.formatMessage({id: 'BoardMember.schemeCommenter', defaultMessage: 'Commenter'})
            } else if (currentBoard.minimumRole === MemberRole.Viewer) {
                return intl.formatMessage({id: 'BoardMember.schemeViewer', defaultMessage: 'Viewer'})
            }
            return intl.formatMessage({id: 'BoardMember.schemeEditor', defaultMessage: 'Editor'})
        }
        return intl.formatMessage({id: 'BoardMember.schemeNone', defaultMessage: 'None'})
    }

    const confirmationDialog = () => (
        <ConfirmationDialogBox
            dialogBox={{
                heading: intl.formatMessage({
                    id: 'shareBoard.confirm-change-team-role.title',
                    defaultMessage: 'Change minimum board role',
                }),
                subText: intl.formatMessage({
                    id: 'shareBoard.confirm-change-team-role.body',
                    defaultMessage: 'Everyone on this board with a lower permission than the "{role}" role will <b>now be promoted to {role}</b>. Are you sure you want to change the minimum role for the board?',
                }, {
                    b: (...chunks: unknown[]) => <b>{chunks as never}</b>,
                    role: changeRoleConfirmation() === MemberRole.Editor ? intl.formatMessage({id: 'BoardMember.schemeEditor', defaultMessage: 'Editor'}) : intl.formatMessage({id: 'BoardMember.schemeCommenter', defaultMessage: 'Commenter'}),
                }) as never,
                confirmButtonText: intl.formatMessage({
                    id: 'shareBoard.confirm-change-team-role.confirmBtnText',
                    defaultMessage: 'Change minimum board role',
                }),
                onConfirm: onChangeRole,
                onClose: () => setChangeRoleConfirmation(null),
            }}
        />
    )

    return (
        <div class='user-item'>
            <Show when={changeRoleConfirmation()}>
                {confirmationDialog()}
            </Show>
            <div class='user-item__content'>
                <div class='ml-3'><strong>{intl.formatMessage({id: 'ShareBoard.teamPermissionsText', defaultMessage: 'Everyone at {teamName} Team'}, {teamName: team()?.title})}</strong></div>
            </div>
            <div>
                <BoardPermissionGate permissions={[Permission.ManageBoardType]}>
                    <MenuWrapper
                        menu={
                            <Menu position='left'>
                                <Show when={!board().isTemplate}>
                                    <Menu.Text
                                        id={MemberRole.Editor}
                                        check={board().minimumRole === undefined || board().minimumRole === MemberRole.Editor}
                                        icon={board().type === BoardTypeOpen && board().minimumRole === MemberRole.Editor ? <CheckIcon/> : <div class='empty-icon'/>}
                                        name={intl.formatMessage({id: 'BoardMember.schemeEditor', defaultMessage: 'Editor'})}
                                        onClick={() => setChangeRoleConfirmation(MemberRole.Editor)}
                                    />
                                    <Menu.Text
                                        id={MemberRole.Commenter}
                                        check={board().minimumRole === MemberRole.Commenter}
                                        icon={board().type === BoardTypeOpen && board().minimumRole === MemberRole.Commenter ? <CheckIcon/> : <div class='empty-icon'/>}
                                        name={intl.formatMessage({id: 'BoardMember.schemeCommenter', defaultMessage: 'Commenter'})}
                                        onClick={() => setChangeRoleConfirmation(MemberRole.Commenter)}
                                    />
                                </Show>
                                <Menu.Text
                                    id={MemberRole.Viewer}
                                    check={board().minimumRole === MemberRole.Viewer}
                                    icon={board().type === BoardTypeOpen && board().minimumRole === MemberRole.Viewer ? <CheckIcon/> : <div class='empty-icon'/>}
                                    name={intl.formatMessage({id: 'BoardMember.schemeViewer', defaultMessage: 'Viewer'})}
                                    onClick={() => updateBoardType(board(), BoardTypeOpen, MemberRole.Viewer)}
                                />
                                <Menu.Text
                                    id={MemberRole.None}
                                    check={true}
                                    icon={board().type === BoardTypePrivate ? <CheckIcon/> : <div class='empty-icon'/>}
                                    name={intl.formatMessage({id: 'BoardMember.schemeNone', defaultMessage: 'None'})}
                                    onClick={() => updateBoardType(board(), BoardTypePrivate, MemberRole.None)}
                                />
                            </Menu>
                        }
                    >
                        <button class='user-item__button'>
                            {currentRoleName()}
                            <CompassIcon
                                icon='chevron-down'
                                className='CompassIcon'
                            />
                        </button>
                    </MenuWrapper>
                </BoardPermissionGate>
                <BoardPermissionGate
                    permissions={[Permission.ManageBoardType]}
                    invert={true}
                >
                    <span>{currentRoleName()}</span>
                </BoardPermissionGate>
            </div>
        </div>
    )
}

export default TeamPermissionsRow
