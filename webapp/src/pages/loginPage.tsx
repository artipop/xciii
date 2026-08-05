// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show, createSignal} from 'solid-js'
import {A, Navigate, useLocation, useNavigate} from '@solidjs/router'

import {FormattedMessage} from '../intl'

import {useAppSelector, useAppStore} from '../store/hooks'
import {getLoggedIn} from '../store/users'

import Button from '../widgets/buttons/button'
import client from '../octoClient'
import './loginPage.scss'

const LoginPage = () => {
    const [username, setUsername] = createSignal('')
    const [password, setPassword] = createSignal('')
    const [errorMessage, setErrorMessage] = createSignal('')
    const {actions} = useAppStore()
    const loggedIn = useAppSelector<boolean|null>(getLoggedIn)
    const queryParams = new URLSearchParams(useLocation().search)
    const navigate = useNavigate()

    const handleLogin = async (): Promise<void> => {
        const logged = await client.login(username(), password())
        if (logged) {
            await actions.users.fetchMe()
            if (queryParams) {
                navigate(queryParams.get('r') || '/')
            } else {
                navigate('/')
            }
        } else {
            setErrorMessage('Login failed')
        }
    }

    return (
        <Show
            when={!loggedIn()}
            fallback={<Navigate href={'/'}/>}
        >
            <div class='LoginPage'>
                <form
                    onSubmit={(e: Event) => {
                        e.preventDefault()
                        handleLogin()
                    }}
                >
                    <div class='title'>
                        <FormattedMessage
                            id='login.log-in-title'
                            defaultMessage='Log in'
                        />
                    </div>
                    <div class='username'>
                        <input
                            id='login-username'
                            placeholder={'Enter username'}
                            value={username()}
                            onInput={(e) => {
                                setUsername(e.target.value)
                                setErrorMessage('')
                            }}
                        />
                    </div>
                    <div class='password'>
                        <input
                            id='login-password'
                            type='password'
                            placeholder={'Enter password'}
                            value={password()}
                            onInput={(e) => {
                                setPassword(e.target.value)
                                setErrorMessage('')
                            }}
                        />
                    </div>
                    <Button
                        filled={true}
                        submit={true}
                    >
                        <FormattedMessage
                            id='login.log-in-button'
                            defaultMessage='Log in'
                        />
                    </Button>
                </form>
                <A href='/register'>
                    <FormattedMessage
                        id='login.register-button'
                        defaultMessage={'or create an account if you don\'t have one'}
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

export default LoginPage
