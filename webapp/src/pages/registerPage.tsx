// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show, createSignal} from 'solid-js'
import {A, Navigate, useNavigate} from '@solidjs/router'

import {FormattedMessage, useIntl} from '../intl'

import {useAppSelector, useAppStore} from '../store/hooks'
import {getLoggedIn} from '../store/users'

import Button from '../widgets/buttons/button'
import client from '../octoClient'
import './registerPage.scss'

const RegisterPage = () => {
    const intl = useIntl()
    const [username, setUsername] = createSignal('')
    const [password, setPassword] = createSignal('')
    const [email, setEmail] = createSignal('')
    const [errorMessage, setErrorMessage] = createSignal('')
    const navigate = useNavigate()
    const {actions} = useAppStore()
    const loggedIn = useAppSelector<boolean|null>(getLoggedIn)

    const handleRegister = async (): Promise<void> => {
        const queryString = new URLSearchParams(window.location.search)
        const signupToken = queryString.get('t') || ''

        const response = await client.register(email(), username(), password(), signupToken)
        if (response.code === 200) {
            const logged = await client.login(username(), password())
            if (logged) {
                await actions.users.fetchMe()
                navigate('/')
            }
        } else if (response.code === 401) {
            setErrorMessage(intl.formatMessage({id: 'register.invalid-link', defaultMessage: 'Invalid registration link, please contact your administrator'}))
        } else {
            setErrorMessage(`${response.json?.error}`)
        }
    }

    return (
        <Show
            when={!loggedIn()}
            fallback={<Navigate href={'/'}/>}
        >
            <div class='RegisterPage'>
                <form
                    onSubmit={(e: Event) => {
                        e.preventDefault()
                        handleRegister()
                    }}
                >
                    <div class='title'>
                        <FormattedMessage
                            id='register.signup-title'
                            defaultMessage='Sign up for your account'
                        />
                    </div>
                    <div class='email'>
                        <input
                            id='login-email'
                            placeholder={intl.formatMessage({id: 'register.email-placeholder', defaultMessage: 'Enter email'})}
                            value={email()}
                            onInput={(e) => setEmail(e.target.value.trim())}
                        />
                    </div>
                    <div class='username'>
                        <input
                            id='login-username'
                            placeholder={intl.formatMessage({id: 'login.username-placeholder', defaultMessage: 'Enter username'})}
                            value={username()}
                            onInput={(e) => setUsername(e.target.value.trim())}
                        />
                    </div>
                    <div class='password'>
                        <input
                            id='login-password'
                            type='password'
                            placeholder={intl.formatMessage({id: 'login.password-placeholder', defaultMessage: 'Enter password'})}
                            value={password()}
                            onInput={(e) => setPassword(e.target.value)}
                        />
                    </div>
                    <Button
                        filled={true}
                        submit={true}
                    >
                        {intl.formatMessage({id: 'register.signup-button', defaultMessage: 'Register'})}
                    </Button>
                </form>
                <A href='/login'>
                    <FormattedMessage
                        id='register.login-button'
                        defaultMessage={'or log in if you already have an account'}
                    />
                </A>
                <Show when={errorMessage()}>
                    <div class='error'>
                        {errorMessage()}
                    </div>
                </Show>
            </div>
        </Show>
    )
}

export default RegisterPage
