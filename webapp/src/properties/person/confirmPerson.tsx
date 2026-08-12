import {Show, createSignal} from 'solid-js'
import type {JSX} from 'solid-js'

import {useIntl} from '../../intl'

import {IUser} from '../../user'
import mutator from '../../mutator'
import {useAppSelector} from '../../store/hooks'
import {getBoardUsers, getMe} from '../../store/users'
import {BoardMember, BoardTypeOpen, MemberRole} from '../../blocks/board'

import {PropertyProps} from '../types'
import {useHasPermissions} from '../../hooks/permissions'
import {Permission} from '../../constants'
import ConfirmAddUserForNotifications from '../../components/confirmAddUserForNotifications'
import PersonSelector from '../../components/personSelector'

const ConfirmPerson = (props: PropertyProps): JSX.Element => {
    const [confirmAddUser, setConfirmAddUser] = createSignal<IUser|null>(null)
    const intl = useIntl()

    const boardUsersById = useAppSelector<{[key: string]: IUser}>(getBoardUsers)

    const me = useAppSelector<IUser|null>(getMe)

    const allowManageBoardRoles = useHasPermissions(() => props.board.teamId, () => props.board.id, [Permission.ManageBoardRoles])
    const allowAddUsers = () => !me()?.is_guest && (allowManageBoardRoles() || props.board.type === BoardTypeOpen)
    const changePropertyValue = (newValue: string | string[]) => mutator.changePropertyValue(props.board.id, props.card, props.propertyTemplate.id, newValue)
    const emptyDisplayValue = () => (props.showEmptyPlaceholder ? intl.formatMessage({id: 'PropertyValueElement.empty', defaultMessage: 'Empty'}) : '')

    const userIDs = (): string[] => {
        if (typeof props.propertyValue === 'string' && props.propertyValue !== '') {
            return [props.propertyValue as string]
        } else if (Array.isArray(props.propertyValue) && props.propertyValue.length > 0) {
            return props.propertyValue
        }
        return []
    }

    // Every action arrives as the list that is left, so only the newly chosen
    // need confirming; removing and clearing are just the list, written back.
    const onChange = (items: IUser[] | IUser | null) => {
        if (Array.isArray(items)) {
            const confirmedIds: string[] = []
            items.forEach((item) => {
                if (boardUsersById()[item.id]) {
                    confirmedIds.push(item.id)
                } else {
                    setConfirmAddUser(item)
                }
            })
            changePropertyValue(confirmedIds)
        } else if (!items) {
            changePropertyValue('')
        } else if (boardUsersById()[items.id]) {
            changePropertyValue(items.id)
        } else {
            setConfirmAddUser(items)
        }
    }

    const addUser = async (userId: string, role: string) => {
        const newRole = role || MemberRole.Viewer
        const newMember = {
            boardId: props.board.id,
            userId,
            roles: role,
            schemeAdmin: newRole === MemberRole.Admin,
            schemeEditor: newRole === MemberRole.Admin || newRole === MemberRole.Editor,
            schemeCommenter: newRole === MemberRole.Admin || newRole === MemberRole.Editor || newRole === MemberRole.Commenter,
            schemeViewer: newRole === MemberRole.Admin || newRole === MemberRole.Editor || newRole === MemberRole.Commenter || newRole === MemberRole.Viewer,
        } as BoardMember

        setConfirmAddUser(null)
        await mutator.createBoardMember(newMember)

        if (props.propertyTemplate.type === 'multiPerson') {
            await mutator.changePropertyValue(props.board.id, props.card, props.propertyTemplate.id, [...userIDs(), newMember.userId])
        } else {
            await mutator.changePropertyValue(props.board.id, props.card, props.propertyTemplate.id, newMember.userId)
        }
    }

    return (
        <>
            <Show when={confirmAddUser()}>
                <ConfirmAddUserForNotifications
                    allowManageBoardRoles={allowManageBoardRoles()}
                    minimumRole={props.board.minimumRole}
                    user={confirmAddUser()!}
                    onConfirm={addUser}
                    onClose={() => setConfirmAddUser(null)}
                />
            </Show>
            <PersonSelector
                userIDs={userIDs()}
                allowAddUsers={allowAddUsers()}
                isMulti={props.propertyTemplate.type === 'multiPerson'}
                readOnly={props.readOnly}
                emptyDisplayValue={emptyDisplayValue()}
                property={props.property}
                onChange={onChange}
            />
        </>
    )
}

export default ConfirmPerson
