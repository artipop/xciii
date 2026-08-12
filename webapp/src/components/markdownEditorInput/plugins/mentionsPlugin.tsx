import {Show, createSignal, onCleanup, onMount} from 'solid-js'
import type {JSX} from 'solid-js'

import {$createTextNode, $getSelection, $isRangeSelection, LexicalEditor, TextNode} from 'lexical'

import debounce from 'lodash/debounce'

import {useAppSelector} from '../../../store/hooks'
import {IUser} from '../../../user'
import {getBoardUsersList, getMe} from '../../../store/users'
import {useHasPermissions} from '../../../hooks/permissions'
import {Permission} from '../../../constants'
import {BoardMember, BoardTypeOpen, MemberRole} from '../../../blocks/board'
import mutator from '../../../mutator'
import ConfirmAddUserForNotifications from '../../confirmAddUserForNotifications'
import RootPortal from '../../rootPortal'
import {getCurrentBoard} from '../../../store/boards'
import octoClient from '../../../octoClient'
import {Utils} from '../../../utils'
import {ClientConfig} from '../../../config/clientConfig'
import {getClientConfig} from '../../../store/clientConfig'

import Entry, {MentionUser} from '../entryComponent/entryComponent'

import {TypeaheadMenu, basicTypeaheadTriggerMatch} from './typeahead'

const imageURLForUser = (window as any).Components?.imageURLForUser

// @-mention typeahead. Reproduces the original draft-js mention flow: searches
// team/board users, inserts the picked mention as plain `@username ` text (which
// is what the plain-text editor stores), and offers to add a non-member to the
// board via ConfirmAddUserForNotifications.
type Props = {
    editor: LexicalEditor

    // Guards the editor's blur-save while the confirm dialog holds focus.
    suppressBlur: {current: boolean}
}

const MentionsPlugin = (props: Props): JSX.Element => {
    const boardUsers = useAppSelector<IUser[]>(getBoardUsersList)
    const board = useAppSelector(getCurrentBoard)
    const clientConfig = useAppSelector<ClientConfig>(getClientConfig)
    const me = useAppSelector<IUser|null>(getMe)
    const allowManageBoardRoles = useHasPermissions(() => board().teamId, () => board().id, [Permission.ManageBoardRoles])

    const [suggestions, setSuggestions] = createSignal<MentionUser[]>([])
    const [confirmAddUser, setConfirmAddUserState] = createSignal<IUser|null>(null)

    const setConfirmAddUser = (user: IUser|null) => {
        props.suppressBlur.current = Boolean(user)
        setConfirmAddUserState(user)
    }

    const triggerFn = basicTypeaheadTriggerMatch('@', {minLength: 0})

    const loadSuggestions = async (term: string) => {
        let users: IUser[]

        if (!me()?.is_guest && (allowManageBoardRoles() || (board() && board().type === BoardTypeOpen))) {
            const excludeBots = true
            users = await octoClient.searchTeamUsers(term, excludeBots)
        } else {
            users = boardUsers().
                filter((user) => {
                    if (!term) {
                        return true
                    }
                    return Utils.getUserDisplayName(user, clientConfig().teammateNameDisplay).includes(term)
                }).
                slice(0, 10)
        }

        const mentions: MentionUser[] = users.map(
            (user: IUser): MentionUser => ({
                name: user.username,
                avatar: `${imageURLForUser ? imageURLForUser(user.id) : ''}`,
                is_bot: user.is_bot,
                is_guest: user.is_guest,
                displayName: Utils.getUserDisplayName(user, clientConfig().teammateNameDisplay),
                isBoardMember: Boolean(boardUsers().find((u) => u.id === user.id)),
                user,
            }))
        setSuggestions(mentions)
    }

    const debouncedLoadSuggestions = debounce(loadSuggestions, 200)
    onCleanup(() => debouncedLoadSuggestions.cancel())

    onMount(() => {
        // Prime with the first users (empty search returns first 10 alphabetically).
        loadSuggestions('')
    })

    const addUser = async (userId: string, role: string) => {
        const newRole = role || MemberRole.Viewer
        const newMember = {
            boardId: board().id,
            userId,
            roles: role,
            schemeAdmin: newRole === MemberRole.Admin,
            schemeEditor: newRole === MemberRole.Admin || newRole === MemberRole.Editor,
            schemeCommenter: newRole === MemberRole.Admin || newRole === MemberRole.Editor || newRole === MemberRole.Commenter,
            schemeViewer: newRole === MemberRole.Admin || newRole === MemberRole.Editor || newRole === MemberRole.Commenter || newRole === MemberRole.Viewer,
        } as BoardMember

        setConfirmAddUser(null)
        props.editor.focus()
        await mutator.createBoardMember(newMember)
    }

    const onSelectOption = (
        selected: MentionUser,
        nodeToReplace: TextNode | null,
        closeMenu: () => void,
    ) => {
        // Already inside editor.update() — the menu runs the selection there.
        const mentionText = `@${selected.name} `
        const newNode = $createTextNode(mentionText)
        if (nodeToReplace && nodeToReplace.isAttached()) {
            nodeToReplace.replace(newNode)
            newNode.selectNext(0, 0)
        } else {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
                selection.insertText(mentionText)
            }
        }
        closeMenu()

        if (!selected.isBoardMember) {
            setConfirmAddUser(selected.user as IUser)
        }
    }

    return (
        <>
            <TypeaheadMenu<MentionUser>
                editor={props.editor}
                options={suggestions()}
                triggerFn={triggerFn}
                class='MarkdownEditorInput--mentions'
                onQueryChange={(query) => debouncedLoadSuggestions(query || '')}
                onSelectOption={onSelectOption}
                itemRender={(mention, isSelected, select, highlight) => (
                    <Entry
                        mention={mention}
                        isSelected={isSelected()}
                        onClick={select}
                        onMouseEnter={highlight}
                    />
                )}
            />
            <Show when={confirmAddUser()}>
                <RootPortal>
                    <ConfirmAddUserForNotifications
                        allowManageBoardRoles={allowManageBoardRoles()}
                        minimumRole={board().minimumRole}
                        user={confirmAddUser()!}
                        onConfirm={addUser}
                        onClose={() => {
                            setConfirmAddUser(null)
                            props.editor.focus()
                        }}
                    />
                </RootPortal>
            </Show>
        </>
    )
}

export default MentionsPlugin
