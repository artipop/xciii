import {For, Show, createSignal, onMount} from 'solid-js'
import type {JSX} from 'solid-js'

import {useIntl, FormattedMessage} from '../../intl'

import Combobox from '../../widgets/combobox'
import type {ComboboxOption} from '../../combobox'

import {useAppSelector} from '../../store/hooks'
import {useRouteMatch} from '../../hooks/routerMatch'
import {getCurrentBoard, getCurrentBoardMembers} from '../../store/boards'
import {getMe, getBoardUsersList} from '../../store/users'

import {ClientConfig} from '../../config/clientConfig'
import {getClientConfig} from '../../store/clientConfig'

import {Utils, IDType} from '../../utils'
import Tooltip from '../../widgets/tooltip'
import mutator from '../../mutator'

import {ISharing} from '../../blocks/sharing'
import {BoardMember, MemberRole} from '../../blocks/board'

import client from '../../octoClient'
import Dialog from '../dialog'
import {IUser} from '../../user'
import Switch from '../../widgets/switch'
import Button from '../../widgets/buttons/button'
import {sendFlashMessage} from '../flashMessages'
import {Permission} from '../../constants'
import GuestBadge from '../../widgets/guestBadge'
import AdminBadge from '../../widgets/adminBadge/adminBadge'

import CompassIcon from '../../widgets/icons/compassIcon'
import IconButton from '../../widgets/buttons/iconButton'
import SearchIcon from '../../widgets/icons/search'

import BoardPermissionGate from '../permissions/boardPermissionGate'

import {useHasPermissions} from '../../hooks/permissions'

import TeamPermissionsRow from './teamPermissionsRow'
import UserPermissionsRow from './userPermissionsRow'

import './shareBoard.scss'

type Props = {
    onClose: () => void
    enableSharedBoards: boolean
}

function isLastAdmin(members: BoardMember[]) {
    let adminCount = 0
    for (const member of members) {
        if (member.schemeAdmin) {
            if (++adminCount > 1) {
                return false
            }
        }
    }
    return true
}

// A person as a row of the list.
const asShareOption = (user: IUser): ComboboxOption<IUser> => ({
    id: user.id,
    label: user.username,
    data: user,
})

export default function ShareBoardDialog(props: Props): JSX.Element {
    const [wasCopiedPublic, setWasCopiedPublic] = createSignal(false)
    const [wasCopiedInternal, setWasCopiedInternal] = createSignal(false)
    const [sharing, setSharing] = createSignal<ISharing|undefined>(undefined)
    const [selectedUser, setSelectedUser] = createSignal<IUser|null>(null)
    const clientConfig = useAppSelector<ClientConfig>(getClientConfig)

    // members of the current board
    const members = useAppSelector<{[key: string]: BoardMember}>(getCurrentBoardMembers)
    const board = useAppSelector(getCurrentBoard)
    const boardId = () => board().id
    const boardUsers = useAppSelector<IUser[]>(getBoardUsersList)
    const me = useAppSelector<IUser|null>(getMe)

    const [publish, setPublish] = createSignal(false)

    const intl = useIntl()
    const match = useRouteMatch()

    const hasSharePermissions = useHasPermissions(() => board().teamId, boardId, [Permission.ShareBoard])

    const loadData = async () => {
        if (hasSharePermissions()) {
            const newSharing = await client.getSharing(boardId())
            setSharing(newSharing)
            setWasCopiedPublic(false)
        }
    }

    const createSharingInfo = () => {
        const newSharing: ISharing = {
            id: boardId(),
            enabled: true,
            token: Utils.createGuid(IDType.Token),
        }
        return newSharing
    }

    const onShareChanged = async (isOn: boolean) => {
        const newSharing: ISharing = sharing() || createSharingInfo()
        newSharing.id = boardId()
        newSharing.enabled = isOn
        await client.setSharing(boardId(), newSharing)
        await loadData()
    }

    const onRegenerateToken = async () => {
        // eslint-disable-next-line no-alert
        const accept = window.confirm(intl.formatMessage({id: 'ShareBoard.confirmRegenerateToken', defaultMessage: 'This will invalidate previously shared links. Continue?'}))
        if (accept) {
            const newSharing: ISharing = sharing() || createSharingInfo()
            newSharing.token = Utils.createGuid(IDType.Token)
            await client.setSharing(boardId(), newSharing)
            await loadData()

            const description = intl.formatMessage({id: 'ShareBoard.tokenRegenrated', defaultMessage: 'Token regenerated'})
            sendFlashMessage({content: description, severity: 'low'})
        }
    }

    const addUser = (user: IUser) => {
        const minimumRole = board().minimumRole || MemberRole.Viewer
        const newMember = {
            boardId: boardId(),
            userId: user.id,
            roles: minimumRole,
            schemeEditor: minimumRole === MemberRole.Editor,
            schemeCommenter: minimumRole === MemberRole.Editor || minimumRole === MemberRole.Commenter,
            schemeViewer: minimumRole === MemberRole.Editor || minimumRole === MemberRole.Commenter || minimumRole === MemberRole.Viewer,
        } as BoardMember
        mutator.createBoardMember(newMember)
    }

    const onUpdateBoardMember = (member: BoardMember, newPermission: string) => {
        if (member.userId === me()?.id && isLastAdmin(Object.values(members()))) {
            sendFlashMessage({content: intl.formatMessage({id: 'shareBoard.lastAdmin', defaultMessage: 'Boards must have at least one Administrator'}), severity: 'low'})
            return
        }

        const newMember = {
            boardId: member.boardId,
            userId: member.userId,
            roles: member.roles,
        } as BoardMember

        switch (newPermission) {
        case MemberRole.Admin:
            if (member.schemeAdmin) {
                return
            }
            newMember.schemeAdmin = true
            newMember.schemeEditor = true
            break
        case MemberRole.Editor:
            if (!member.schemeAdmin && member.schemeEditor) {
                return
            }
            newMember.schemeAdmin = false
            newMember.schemeEditor = true
            break
        case MemberRole.Commenter:
            if (!member.schemeAdmin && !member.schemeEditor && member.schemeCommenter) {
                return
            }
            newMember.schemeAdmin = false
            newMember.schemeEditor = false
            newMember.schemeCommenter = true
            break
        case MemberRole.Viewer:
            if (!member.schemeAdmin && !member.schemeEditor && !member.schemeCommenter && member.schemeViewer) {
                return
            }
            newMember.schemeAdmin = false
            newMember.schemeEditor = false
            newMember.schemeCommenter = false
            newMember.schemeViewer = true
            break
        default:
            return
        }

        mutator.updateBoardMember(newMember, member)
    }

    const onDeleteBoardMember = (member: BoardMember) => {
        if (member.userId === me()?.id && isLastAdmin(Object.values(members()))) {
            sendFlashMessage({content: intl.formatMessage({id: 'shareBoard.lastAdmin', defaultMessage: 'Boards must have at least one Administrator'}), severity: 'low'})
            return
        }
        mutator.deleteBoardMember(member)
    }

    onMount(() => {
        loadData()
    })

    const isSharing = () => Boolean(sharing() && sharing()!.id === boardId() && sharing()!.enabled)
    const readToken = () => ((sharing() && isSharing()) ? sharing()!.token : '')

    const urls = () => {
        const shareUrl = new URL(window.location.toString())
        shareUrl.searchParams.set('r', readToken())
        const boardUrl = new URL(window.location.toString())

        const params = match().params
        if (params.teamId) {
            const newPath = Utils.generatePath('/team/:teamId/shared/:boardId/:viewId', {
                boardId: params.boardId,
                viewId: params.viewId,
                teamId: params.teamId,
            })
            shareUrl.pathname = Utils.buildURL(newPath)

            const boardPath = Utils.generatePath('/team/:teamId/:boardId/:viewId', {
                boardId: params.boardId,
                viewId: params.viewId,
                teamId: params.teamId,
            })
            boardUrl.pathname = Utils.getBaseURL() + boardPath
        } else {
            const newPath = Utils.generatePath('/shared/:boardId/:viewId', {
                boardId: params.boardId,
                viewId: params.viewId,
            })
            shareUrl.pathname = Utils.buildURL(newPath)
            boardUrl.pathname = Utils.buildURL(
                Utils.generatePath(':boardId/:viewId', {
                    boardId: params.boardId,
                    viewId: params.viewId,
                },
                ))
        }
        return {shareUrl, boardUrl}
    }

    const shareBoardTitle = (
        <FormattedMessage
            id={'ShareBoard.Title'}
            defaultMessage={'Share Board'}
        />
    )

    const shareTemplateTitle = (
        <FormattedMessage
            id={'ShareTemplate.Title'}
            defaultMessage={'Share Template'}
        />
    )

    // Somebody already an explicit member of the board is not offered again.
    const loadShareOptions = async (query: string) => {
        const users = await client.searchTeamUsers(query) || []
        return users.
            filter((user) => (members()[user.id] ? members()[user.id].synthetic : true)).
            map(asShareOption)
    }

    const formatOptionLabel = (user: IUser) => (
        <div class='user-item'>
            <div class='ml-3'>
                <strong>{Utils.getUserDisplayName(user, clientConfig().teammateNameDisplay)}</strong>
                <strong class='ml-2 text-light'>{`@${user.username}`}</strong>
                <GuestBadge show={Boolean(user?.is_guest)}/>
                <AdminBadge permissions={user.permissions}/>
            </div>
        </div>
    )

    return (
        <Dialog
            onClose={props.onClose}
            title={board().isTemplate ? shareTemplateTitle : shareBoardTitle}
            class='ShareBoardDialog'
        >
            <BoardPermissionGate permissions={[Permission.ManageBoardRoles]}>
                <div class='share-input__container'>
                    <div class='share-input'>
                        <SearchIcon/>
                        <Combobox
                            value={selectedUser() ? asShareOption(selectedUser()!) : null}
                            class={'userSearchInput'}
                            classNamePrefix={'userSearchInput'}
                            loadOptions={loadShareOptions}
                            renderOption={(option) => formatOptionLabel(option.data)}
                            placeholder={intl.formatMessage({id: 'ShareTemplate.searchPlaceholder', defaultMessage: 'Search for people'})}
                            onChange={(value) => {
                                const chosen = (value as ComboboxOption<IUser> | null)?.data
                                if (chosen) {
                                    addUser(chosen)
                                    setSelectedUser(null)
                                }
                            }}
                        />
                    </div>
                </div>
            </BoardPermissionGate>
            <div class='user-items'>
                <TeamPermissionsRow/>

                <For each={boardUsers()}>
                    {(user) => (
                        <Show when={members()[user.id] && !members()[user.id].synthetic}>
                            <UserPermissionsRow
                                user={user}
                                member={members()[user.id]}
                                teammateNameDisplay={me()?.props?.teammateNameDisplay || clientConfig().teammateNameDisplay}
                                onDeleteBoardMember={onDeleteBoardMember}
                                onUpdateBoardMember={onUpdateBoardMember}
                                isMe={user.id === me()?.id}
                            />
                        </Show>
                    )}
                </For>
            </div>

            <Show when={props.enableSharedBoards && !board().isTemplate}>
                <div class='tabs-container'>
                    <button
                        onClick={() => setPublish(false)}
                        class={`tab-item ${!publish() && 'tab-item--active'}`}
                    >
                        <FormattedMessage
                            id='share-board.share'
                            defaultMessage='Share'
                        />
                    </button>
                    <BoardPermissionGate permissions={[Permission.ShareBoard]}>
                        <button
                            onClick={() => setPublish(true)}
                            class={`tab-item ${publish() && 'tab-item--active'}`}
                        >
                            <FormattedMessage
                                id='share-board.publish'
                                defaultMessage='Publish'
                            />
                        </button>
                    </BoardPermissionGate>
                </div>
            </Show>
            <Show when={props.enableSharedBoards && publish() && !board().isTemplate}>
                <BoardPermissionGate permissions={[Permission.ShareBoard]}>
                    <div class='tabs-content'>
                        <div>
                            <div class='d-flex justify-content-between'>
                                <div class='d-flex flex-column'>
                                    <div class='text-heading2'>{intl.formatMessage({id: 'ShareBoard.PublishTitle', defaultMessage: 'Publish to the web'})}</div>
                                    <div class='text-light'>{intl.formatMessage({id: 'ShareBoard.PublishDescription', defaultMessage: 'Publish and share a read-only link with everyone on the web.'})}</div>
                                </div>
                                <div>
                                    <Switch
                                        isOn={isSharing()}
                                        size='medium'
                                        onChanged={onShareChanged}
                                    />
                                </div>
                            </div>
                        </div>
                        <Show when={isSharing()}>
                            <div class='d-flex justify-content-between tabs-inputs'>
                                <div class='d-flex input-container'>
                                    <a
                                        class='shareUrl'
                                        href={urls().shareUrl.toString()}
                                        target='_blank'
                                        rel='noreferrer'
                                    >
                                        {urls().shareUrl.toString()}
                                    </a>
                                    <Tooltip
                                        title={intl.formatMessage({id: 'ShareBoard.regenerate', defaultMessage: 'Regenerate token'})}
                                    >
                                        <IconButton
                                            size='small'
                                            onClick={onRegenerateToken}
                                            icon={
                                                <CompassIcon
                                                    icon='refresh'
                                                />}
                                            title={intl.formatMessage({id: 'ShareBoard.regenerate', defaultMessage: 'Regenerate token'})}
                                        />
                                    </Tooltip>
                                </div>
                                <Button
                                    emphasis='secondary'
                                    size='medium'
                                    title={intl.formatMessage({id: 'ShareBoard.copy-link-title', defaultMessage: 'Copy public link'})}
                                    icon={
                                        <CompassIcon
                                            icon='content-copy'
                                            class='CompassIcon'
                                        />
                                    }
                                    onClick={() => {
                                        Utils.copyTextToClipboard(urls().shareUrl.toString())
                                        setWasCopiedPublic(true)
                                        setWasCopiedInternal(false)
                                    }}
                                >
                                    <Show
                                        when={wasCopiedPublic()}
                                        fallback={
                                            <FormattedMessage
                                                id='ShareBoard.copyLink'
                                                defaultMessage='Copy link'
                                            />
                                        }
                                    >
                                        <FormattedMessage
                                            id='ShareBoard.copiedLink'
                                            defaultMessage='Copied!'
                                        />
                                    </Show>
                                </Button>
                            </div>
                        </Show>
                    </div>
                </BoardPermissionGate>
            </Show>

            <Show when={!publish() && !board().isTemplate}>
                <div class='tabs-content'>
                    <div>
                        <div class='d-flex justify-content-between'>
                            <div class='d-flex flex-column'>
                                <div class='text-heading2'>{intl.formatMessage({id: 'ShareBoard.ShareInternal', defaultMessage: 'Share internally'})}</div>
                                <div class='text-light'>{intl.formatMessage({id: 'ShareBoard.ShareInternalDescription', defaultMessage: 'Users who have permissions will be able to use this link.'})}</div>
                            </div>
                        </div>
                    </div>
                    <div class='d-flex justify-content-between tabs-inputs'>
                        <div class='d-flex input-container'>
                            <a
                                class='shareUrl'
                                href={urls().boardUrl.toString()}
                                target='_blank'
                                rel='noreferrer'
                            >
                                {urls().boardUrl.toString()}
                            </a>
                        </div>
                        <Button
                            emphasis='secondary'
                            size='medium'
                            title={intl.formatMessage({id: 'ShareBoard.copyLink', defaultMessage: 'Copy link'})}
                            onClick={() => {
                                Utils.copyTextToClipboard(urls().boardUrl.toString())
                                setWasCopiedPublic(false)
                                setWasCopiedInternal(true)
                            }}
                            icon={
                                <CompassIcon
                                    icon='content-copy'
                                    class='CompassIcon'
                                />
                            }
                        >
                            <Show
                                when={wasCopiedInternal()}
                                fallback={
                                    <FormattedMessage
                                        id='ShareBoard.copyLink'
                                        defaultMessage='Copy link'
                                    />
                                }
                            >
                                <FormattedMessage
                                    id='ShareBoard.copiedLink'
                                    defaultMessage='Copied!'
                                />
                            </Show>
                        </Button>
                    </div>
                </div>
            </Show>
        </Dialog>
    )
}
