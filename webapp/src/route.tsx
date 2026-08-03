// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Component, Show} from 'solid-js'
import {Navigate, Route, useParams} from '@solidjs/router'
import type {Params} from '@solidjs/router'

import {Utils} from './utils'
import {getLoggedIn} from './store/users'
import {useAppSelector} from './store/hooks'

type RouteProps = {
    path: string|string[]
    component: Component
    getOriginalPath?: (params: Params) => string
    loginRequired?: boolean
}

// The login guard react-router carried as a Route wrapper: render the page
// unless the session is known to be absent, then bounce to /error with the
// original path in `r` so login can come back.
function FBRoute(props: RouteProps) {
    const guarded: Component = () => {
        const loggedIn = useAppSelector(getLoggedIn)
        const params = useParams()

        const loginUrl = () => {
            if (props.getOriginalPath) {
                let redirectUrl = '/' + Utils.buildURL(props.getOriginalPath(params))
                if (redirectUrl.indexOf('//') === 0) {
                    redirectUrl = redirectUrl.slice(1)
                }
                return `/error?id=not-logged-in&r=${encodeURIComponent(redirectUrl)}`
            }
            return '/error?id=not-logged-in'
        }

        return (
            <Show
                when={!(props.loginRequired && loggedIn() === false)}
                fallback={<Navigate href={loginUrl()}/>}
            >
                {props.component({})}
            </Show>
        )
    }

    return (
        <Route
            path={props.path}
            component={props.loginRequired ? guarded : props.component}
        />
    )
}

export default FBRoute
