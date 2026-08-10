// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show, createSignal} from 'solid-js'
import {A} from '@solidjs/router'

import {useIntl} from '../intl'
import Button from '../widgets/buttons/button'
import client from '../octoClient'
import './changePasswordPage.scss'
import {IUser} from '../user'
import {useAppSelector} from '../store/hooks'
import {getMe} from '../store/users'

const ChangePasswordPage = () => {
    const intl = useIntl()
    const [oldPassword, setOldPassword] = createSignal('')
    const [newPassword, setNewPassword] = createSignal('')
    const [errorMessage, setErrorMessage] = createSignal('')
    const [succeeded, setSucceeded] = createSignal(false)
    const user = useAppSelector<IUser|null>(getMe)

    const handleSubmit = async (userId: string): Promise<void> => {
        const response = await client.changePassword(userId, oldPassword(), newPassword())
        if (response.code === 200) {
            setOldPassword('')
            setNewPassword('')
            setErrorMessage('')
            setSucceeded(true)
        } else {
            setErrorMessage(intl.formatMessage({id: 'ChangePassword.failed', defaultMessage: 'Change password failed: {error}'}, {error: response.json?.error ?? ''}))
        }
    }

    return (
        <Show
            when={user()}
            fallback={
                <div class='ChangePasswordPage'>
                    <div class='title'>{intl.formatMessage({id: 'ChangePassword.changePassword', defaultMessage: 'Change Password'})}</div>
                    <A href='/login'>{intl.formatMessage({id: 'ChangePassword.login-first', defaultMessage: 'Log in first'})}</A>
                </div>
            }
        >
            <div class='ChangePasswordPage'>
                <div class='title'>{intl.formatMessage({id: 'ChangePassword.changePassword', defaultMessage: 'Change Password'})}</div>
                <form
                    onSubmit={(e: Event) => {
                        e.preventDefault()
                        handleSubmit(user()!.id)
                    }}
                >
                    <div class='oldPassword'>
                        <input
                            id='login-oldpassword'
                            type='password'
                            placeholder={intl.formatMessage({id: 'ChangePassword.current-placeholder', defaultMessage: 'Enter current password'})}
                            value={oldPassword()}
                            onInput={(e) => {
                                setOldPassword(e.target.value)
                                setErrorMessage('')
                            }}
                        />
                    </div>
                    <div class='newPassword'>
                        <input
                            id='login-newpassword'
                            type='password'
                            placeholder={intl.formatMessage({id: 'ChangePassword.new-placeholder', defaultMessage: 'Enter new password'})}
                            value={newPassword()}
                            onInput={(e) => {
                                setNewPassword(e.target.value)
                                setErrorMessage('')
                            }}
                        />
                    </div>
                    <Button
                        filled={true}
                        submit={true}
                    >
                        {intl.formatMessage({id: 'ChangePassword.changePassword-button', defaultMessage: 'Change password'})}
                    </Button>
                </form>
                <Show when={errorMessage()}>
                    <div class='error'>
                        {errorMessage()}
                    </div>
                </Show>
                <Show
                    when={succeeded()}
                    fallback={<A href='/'>{intl.formatMessage({id: 'ChangePassword.cancel', defaultMessage: 'Cancel'})}</A>}
                >
                    <A
                        class='succeeded'
                        href='/'
                    >{intl.formatMessage({id: 'ChangePassword.succeeded', defaultMessage: 'Password changed, click to continue.'})}</A>
                </Show>
            </div>
        </Show>
    )
}

export default ChangePasswordPage
