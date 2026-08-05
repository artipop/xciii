// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Show} from 'solid-js'
import type {JSX} from 'solid-js'

import {useIntl} from '../../intl'

import MenuWrapper from '../../widgets/menuWrapper'
import Menu from '../../widgets/menu'

import CheckIcon from '../../widgets/icons/check'
import CompassIcon from '../../widgets/icons/compassIcon'

import {BoardMember, MemberRole} from '../../blocks/board'
import {IUser} from '../../user'
import {Utils} from '../../utils'
import {Permission} from '../../constants'
import GuestBadge from '../../widgets/guestBadge'
import AdminBadge from '../../widgets/adminBadge/adminBadge'
import {useAppSelector} from '../../store/hooks'
import {getCurrentBoard} from '../../store/boards'

import BoardPermissionGate from '../permissions/boardPermissionGate'

type Props = {
    user: IUser
    member: BoardMember
    isMe: boolean
    teammateNameDisplay: string
    onDeleteBoardMember: (member: BoardMember) => void
    onUpdateBoardMember: (member: BoardMember, permission: string) => void
}

const UserPermissionsRow = (props: Props): JSX.Element => {
    const intl = useIntl()
    const board = useAppSelector(getCurrentBoard)

    const roleState = () => {
        const member = props.member
        let currentRole = MemberRole.Viewer
        let displayRole = intl.formatMessage({id: 'BoardMember.schemeViewer', defaultMessage: 'Viewer'})
        if (member.schemeAdmin) {
            currentRole = MemberRole.Admin
            displayRole = intl.formatMessage({id: 'BoardMember.schemeAdmin', defaultMessage: 'Admin'})
        } else if (member.schemeEditor || member.minimumRole === MemberRole.Editor) {
            currentRole = MemberRole.Editor
            displayRole = intl.formatMessage({id: 'BoardMember.schemeEditor', defaultMessage: 'Editor'})
        } else if (member.schemeCommenter || member.minimumRole === MemberRole.Commenter) {
            currentRole = MemberRole.Commenter
            displayRole = intl.formatMessage({id: 'BoardMember.schemeCommenter', defaultMessage: 'Commenter'})
        }
        return {currentRole, displayRole}
    }

    let menuWrapperRef: HTMLDivElement | undefined

    return (
        <div
            class='user-item'
            ref={menuWrapperRef}
        >
            <div class='user-item__content'>
                <div class='ml-3'>
                    <strong>{Utils.getUserDisplayName(props.user, props.teammateNameDisplay)}</strong>
                    <strong class='ml-2 text-light'>{`@${props.user.username}`}</strong>
                    <Show when={props.isMe}>
                        <strong class='ml-2 text-light'>{intl.formatMessage({id: 'ShareBoard.userPermissionsYouText', defaultMessage: '(You)'})}</strong>
                    </Show>
                    <GuestBadge show={props.user.is_guest}/>
                    <AdminBadge permissions={props.user.permissions}/>
                </div>
            </div>
            <div>
                <BoardPermissionGate permissions={[Permission.ManageBoardRoles]}>
                    <MenuWrapper
                        menu={
                            <Menu
                                position='left'
                                parentRef={{current: menuWrapperRef ?? null}}
                            >
                                <Show when={board().minimumRole === MemberRole.Viewer || board().minimumRole === MemberRole.None}>
                                    <Menu.Text
                                        id={MemberRole.Viewer}
                                        check={true}
                                        icon={roleState().currentRole === MemberRole.Viewer ? <CheckIcon/> : <div class='empty-icon'/>}
                                        name={intl.formatMessage({id: 'BoardMember.schemeViewer', defaultMessage: 'Viewer'})}
                                        onClick={() => props.onUpdateBoardMember(props.member, MemberRole.Viewer)}
                                    />
                                </Show>
                                <Show when={!board().isTemplate && (board().minimumRole === MemberRole.None || board().minimumRole === MemberRole.Commenter || board().minimumRole === MemberRole.Viewer)}>
                                    <Menu.Text
                                        id={MemberRole.Commenter}
                                        check={true}
                                        icon={roleState().currentRole === MemberRole.Commenter ? <CheckIcon/> : <div class='empty-icon'/>}
                                        name={intl.formatMessage({id: 'BoardMember.schemeCommenter', defaultMessage: 'Commenter'})}
                                        onClick={() => props.onUpdateBoardMember(props.member, MemberRole.Commenter)}
                                    />
                                </Show>
                                <Menu.Text
                                    id={MemberRole.Editor}
                                    check={true}
                                    icon={roleState().currentRole === MemberRole.Editor ? <CheckIcon/> : <div class='empty-icon'/>}
                                    name={intl.formatMessage({id: 'BoardMember.schemeEditor', defaultMessage: 'Editor'})}
                                    onClick={() => props.onUpdateBoardMember(props.member, MemberRole.Editor)}
                                />
                                <Show when={props.user.is_guest !== true}>
                                    <Menu.Text
                                        id={MemberRole.Admin}
                                        check={true}
                                        icon={roleState().currentRole === MemberRole.Admin ? <CheckIcon/> : <div class='empty-icon'/>}
                                        name={intl.formatMessage({id: 'BoardMember.schemeAdmin', defaultMessage: 'Admin'})}
                                        onClick={() => props.onUpdateBoardMember(props.member, MemberRole.Admin)}
                                    />
                                </Show>
                                <Menu.Separator/>
                                <Menu.Text
                                    id='Remove'
                                    name={intl.formatMessage({id: 'ShareBoard.userPermissionsRemoveMemberText', defaultMessage: 'Remove member'})}
                                    onClick={() => props.onDeleteBoardMember(props.member)}
                                />
                            </Menu>
                        }
                    >
                        <button class='user-item__button'>
                            {roleState().displayRole}
                            <CompassIcon
                                icon='chevron-down'
                                class='CompassIcon'
                            />
                        </button>
                    </MenuWrapper>
                </BoardPermissionGate>
                <BoardPermissionGate
                    permissions={[Permission.ManageBoardRoles]}
                    invert={true}
                >
                    {roleState().displayRole}
                </BoardPermissionGate>
            </div>
        </div>
    )
}

export default UserPermissionsRow
