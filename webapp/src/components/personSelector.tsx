import {For, Show} from 'solid-js'
import type {JSX} from 'solid-js'

import {useIntl} from '../intl'

import Combobox, {type ComboboxAction, type ComboboxContext} from '../widgets/combobox'
import CompassIcon from '../widgets/icons/compassIcon'
import type {ComboboxItem, ComboboxOption} from '../combobox'
import {IUser} from '../user'
import {Utils} from '../utils'
import {useAppSelector} from '../store/hooks'
import {getBoardUsers, getBoardUsersList, getMe} from '../store/users'

import {ClientConfig} from '../config/clientConfig'
import {getClientConfig} from '../store/clientConfig'
import client from '../octoClient'

import GuestBadge from '../widgets/guestBadge'
import {PropertyType} from '../properties/types'

import './personSelector.scss'

const imageURLForUser = (window as any).Components?.imageURLForUser

type Props = {
    readOnly: boolean
    userIDs: string[]
    allowAddUsers: boolean
    property?: PropertyType
    emptyDisplayValue: string
    isMulti: boolean
    closeMenuOnSelect?: boolean
    showMe?: boolean

    // What the cross beside the chosen person answers to. Passed in rather than
    // translated here, so this stays a component with no messages of its own.
    clearLabel?: string

    // On `remove` the list already excludes the person removed, so every action
    // is answered by reading the list rather than by the action's own payload.
    onChange: (items: IUser[] | IUser | null, action: ComboboxAction) => void
}

const asOption = (user: IUser): ComboboxOption<IUser> => ({id: user.id, label: user.username, data: user})

const PersonSelector = (props: Props): JSX.Element => {
    const closeMenuOnSelect = () => props.closeMenuOnSelect ?? true
    const showMe = () => props.showMe ?? false

    const clientConfig = useAppSelector<ClientConfig>(getClientConfig)
    const intl = useIntl()

    const boardUsersById = useAppSelector<{[key: string]: IUser}>(getBoardUsers)
    const boardUsers = useAppSelector<IUser[]>(getBoardUsersList)
    const me = useAppSelector<IUser|null>(getMe)

    // The chosen person carries the way to take them off, right beside their
    // name. It used to be the widget's own clear button, which sits at the far
    // end of the control — and on a card that control was the whole width of
    // the property row, so the ✕ for «клаус» stood 360px away from the word
    // «клаус», over nothing. Every other value on a card is a chip with its own
    // cross (the select property's), and this is that.
    const formatOptionLabel = (user: IUser, context?: ComboboxContext): JSX.Element => {
        if (!user) {
            return <div/>
        }
        let profileImg
        if (imageURLForUser) {
            profileImg = imageURLForUser(user.id)
        }

        return (
            <div
                class={props.isMulti ? 'MultiPerson-item' : 'Person-item'}
            >
                <Show when={profileImg}>
                    <img
                        alt='Person-avatar'
                        src={profileImg}
                    />
                </Show>
                {Utils.getUserDisplayName(user, clientConfig().teammateNameDisplay)}
                <GuestBadge show={Boolean(user?.is_guest)}/>

                {/* Only the single-person field: a multi one is a row of chips
                    and the widget already draws a cross on each of them. */}
                <Show when={context === 'value' && !props.isMulti && !props.readOnly}>
                    <button
                        type='button'
                        class='Person-clear'
                        aria-label={props.clearLabel}
                        title={props.clearLabel}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) => {
                            event.stopPropagation()
                            props.onChange(null, 'clear')
                        }}
                    >
                        <CompassIcon icon='close'/>
                    </button>
                </Show>
            </div>
        )
    }

    const users = (): IUser[] => {
        if (Object.keys(boardUsersById()).length > 0) {
            return props.userIDs.map((id) => boardUsersById()[id])
        }
        return []
    }

    const loadOptions = async (value: string): Promise<Array<ComboboxItem<IUser>>> => {
        if (!props.allowAddUsers) {
            const returnUsers: IUser[] = []
            const currentMe = me()
            if (showMe() && currentMe) {
                returnUsers.push({
                    id: currentMe.id,
                    username: intl.formatMessage({id: 'PersonProperty.me', defaultMessage: 'Me'}),
                    email: '',
                    nickname: '',
                    firstname: '',
                    lastname: '',
                    props: {},
                    create_at: currentMe.create_at,
                    update_at: currentMe.update_at,
                    is_bot: false,
                    is_guest: currentMe.is_guest,
                    roles: currentMe.roles,
                })
                returnUsers.push(...boardUsers().filter((u) => u.id !== currentMe.id))
            } else {
                returnUsers.push(...boardUsers())
            }
            if (value) {
                return returnUsers.filter((u) => {
                    return u.username.toLowerCase().includes(value.toLowerCase()) ||
                        u.lastname.toLowerCase().includes(value.toLowerCase()) ||
                        u.firstname.toLowerCase().includes(value.toLowerCase()) ||
                        u.nickname.toLowerCase().includes(value.toLowerCase())
                }).map(asOption)
            }
            return returnUsers.map(asOption)
        }
        const excludeBots = true
        const allUsers = await client.searchTeamUsers(value, excludeBots)
        const usersInsideBoard: IUser[] = []
        const usersOutsideBoard: IUser[] = []
        for (const u of allUsers) {
            if (boardUsersById()[u.id]) {
                usersInsideBoard.push(u)
            } else {
                usersOutsideBoard.push(u)
            }
        }
        return [
            {label: intl.formatMessage({id: 'PersonProperty.board-members', defaultMessage: 'Board members'}), options: usersInsideBoard.map(asOption)},
            {label: intl.formatMessage({id: 'PersonProperty.non-board-members', defaultMessage: 'Not board members'}), options: usersOutsideBoard.map(asOption)},
        ].filter((group) => group.options.length > 0)
    }

    const primaryClass = () => (props.isMulti ? 'MultiPerson' : 'Person')
    const secondaryClass = () => (props.property ? ` ${props.property.valueClassName(props.readOnly)}` : '')

    return (
        <Show
            when={!props.readOnly}
            fallback={
                <div class={`${primaryClass()}${secondaryClass()}`}>
                    <For each={users()}>
                        {(user) => formatOptionLabel(user)}
                    </For>
                </div>
            }
        >
            <Combobox
                loadOptions={loadOptions}
                isMulti={props.isMulti}

                // The values carry their own crosses (above), so the widget
                // draws none of its own — one at the end of the control and one
                // on the value would be two answers to "how do I take this
                // off".
                isClearable={false}
                closeMenuOnSelect={closeMenuOnSelect()}
                class={`${primaryClass()}${secondaryClass()}`}
                classNamePrefix={'react-select'}
                renderOption={(option, context) => formatOptionLabel(option.data, context)}
                placeholder={props.emptyDisplayValue}
                value={users().filter(Boolean).map(asOption)}
                onChange={(value, action) => {
                    if (Array.isArray(value)) {
                        props.onChange(value.map((option) => option.data), action)
                    } else {
                        props.onChange(value ? value.data : null, action)
                    }
                }}
            />
        </Show>
    )
}

export default PersonSelector
