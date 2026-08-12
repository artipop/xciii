import {Show, createSignal, onMount} from 'solid-js'
import type {JSX} from 'solid-js'

import {useIntl, FormattedMessage} from '../intl'

import Combobox from '../widgets/combobox'
import type {ComboboxOption} from '../combobox'

import {MemberRole} from '../blocks/board'

import {IUser} from '../user'

import {isAgentUsername, refreshRegisteredAgents} from './acp/agentRegistry'

import ConfirmationDialog from './confirmationDialogBox'

import './confirmAddUserForNotifications.scss'

type Props = {
    user: IUser
    minimumRole: MemberRole
    allowManageBoardRoles: boolean
    onConfirm: (userId: string, role: string) => void
    onClose: () => void
}

const ConfirmAddUserForNotifications = (props: Props): JSX.Element => {
    const intl = useIntl()

    // An agent is not a person being invited. It does not read the board, does
    // not get notified about it and has no use for a permission: what it can do
    // it does through our own API and MCP, under a grant that has nothing to do
    // with this membership. So it is not asked what to be — the question has no
    // answer that means anything — and it joins as an editor, because that is
    // what a thing that works cards is.
    const isAgent = () => isAgentUsername(props.user.username)
    onMount(() => {
        refreshRegisteredAgents()
    })

    const [chosenRole, setChosenRole] = createSignal<MemberRole>(props.minimumRole || MemberRole.Viewer)
    const newUserRole = () => (isAgent() ? MemberRole.Editor : chosenRole())

    const roleOptions = () => {
        const options = []

        // if allowed to manage board roles, only display roles higher than minimum
        if (props.allowManageBoardRoles) {
            if (props.minimumRole === MemberRole.Viewer || props.minimumRole === MemberRole.None) {
                options.push(
                    {id: MemberRole.Viewer, label: intl.formatMessage({id: 'BoardMember.schemeViewer', defaultMessage: 'Viewer'})},
                )
            }
            if (props.minimumRole === MemberRole.Viewer || props.minimumRole === MemberRole.None || props.minimumRole === MemberRole.Commenter) {
                options.push(
                    {id: MemberRole.Commenter, label: intl.formatMessage({id: 'BoardMember.schemeCommenter', defaultMessage: 'Commenter'})},
                )
            }
            options.push(
                {id: MemberRole.Editor, label: intl.formatMessage({id: 'BoardMember.schemeEditor', defaultMessage: 'Editor'})},
            )
            if (!props.user.is_guest) {
                options.push(
                    {id: MemberRole.Admin, label: intl.formatMessage({id: 'BoardMember.schemeAdmin', defaultMessage: 'Admin'})},
                )
            }
        } else {
            // if not admin, (ie. Editor/Commentor on Public board)
            // set to minimum board role, only option, read only.
            if (props.minimumRole === MemberRole.Viewer || props.minimumRole === MemberRole.None) {
                options.push(
                    {id: MemberRole.Viewer, label: intl.formatMessage({id: 'BoardMember.schemeViewer', defaultMessage: 'Viewer'})},
                )
            }
            if (props.minimumRole === MemberRole.Commenter) {
                options.push(
                    {id: MemberRole.Commenter, label: intl.formatMessage({id: 'BoardMember.schemeCommenter', defaultMessage: 'Commenter'})},
                )
            }
            if (props.minimumRole === MemberRole.Editor) {
                options.push(
                    {id: MemberRole.Editor, label: intl.formatMessage({id: 'BoardMember.schemeEditor', defaultMessage: 'Editor'})},
                )
            }
        }
        return options
    }

    const subText = (
        <div class='ConfirmAddUserForNotifications'>
            <Show
                when={isAgent()}
                fallback={
                    <p>
                        <FormattedMessage
                            id='person.add-user-to-board-warning'
                            defaultMessage='{username} is not a member of the board, and will not receive any notifications about it.'
                            values={{username: props.user.username}}
                        />
                    </p>
                }
            >
                <p>
                    <FormattedMessage
                        id='person.add-agent-to-board-warning'
                        defaultMessage='{username} is an agent on this machine and is not yet on this board.'
                        values={{username: props.user.username}}
                    />
                </p>
            </Show>
            <p>
                <FormattedMessage
                    id='person.add-user-to-board-question'
                    defaultMessage='Do you want to add {username} to the board?'
                    values={{username: props.user.username}}
                />
            </p>
            <Show when={!isAgent()}>
                <div class='permissions-title'>
                    <label>
                        <FormattedMessage
                            id='person.add-user-to-board-permissions'
                            defaultMessage='Permissions'
                        />
                    </label>
                </div>
                <Combobox
                    class='select'
                    classNamePrefix='select'
                    portalTarget={document.body}
                    isDisabled={!props.allowManageBoardRoles}
                    isSearchable={false}
                    options={roleOptions().map((o) => ({id: o.id, label: o.label, data: o}))}
                    onChange={(value) => {
                        if (props.allowManageBoardRoles) {
                            const role = (value as ComboboxOption<{id: MemberRole}> | null)?.data.id || props.minimumRole
                            setChosenRole(role)
                        }
                    }}
                    value={roleOptions().
                        filter((o) => o.id === newUserRole()).
                        map((o) => ({id: o.id, label: o.label, data: o}))[0] || null}
                />
            </Show>
        </div>
    )

    return (
        <ConfirmationDialog
            dialogBox={{
                heading: intl.formatMessage({id: 'person.add-user-to-board', defaultMessage: 'Add {username} to board'}, {username: props.user.username}),
                subText,
                confirmButtonText: intl.formatMessage({id: 'person.add-user-to-board-confirm-button', defaultMessage: 'Add to board'}),
                onConfirm: () => props.onConfirm(props.user.id, newUserRole()),
                onClose: props.onClose,
            }}
        />
    )
}

export default ConfirmAddUserForNotifications
