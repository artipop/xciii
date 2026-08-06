// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Component, Suspense, createEffect, lazy, onMount} from 'solid-js'
import {Router, useLocation, useNavigate, useParams} from '@solidjs/router'
import type {JSX} from 'solid-js'

import BoardPage from './pages/boardPage/boardPage'
import ChangePasswordPage from './pages/changePasswordPage'
import ErrorPage from './pages/errorPage'
import LoginPage from './pages/loginPage'
import RegisterPage from './pages/registerPage'
import {Utils} from './utils'
import octoClient from './octoClient'
import {getGlobalError} from './store/globalError'
import {useAppSelector, useAppStore} from './store/hooks'
import FBRoute from './route'

// The desktop app's terminal window: the agent's own CLI on a card, drawn by
// xterm.js. Its own route so the window is just a URL — and lazily loaded so a
// browser build, which cannot open one, never pays for the emulator.
const TerminalPage = lazy(() => import('./components/acp/terminalPage'))

// The board on a phone: what is waiting for a person, and the terminals it is
// waiting in. Lazy for the same reason — a desktop window never opens these,
// and a browser build should not carry them.
const MobilePage = lazy(() => import('./pages/mobile/mobilePage'))

const UUID_REGEX = new RegExp(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/)

// The pre-teams URL scheme survives in bookmarks: resolve the board, then
// swap /workspace/:workspaceId for /team/:teamId in place.
const workspaceToTeamRedirect = (shared: boolean): Component => () => {
    const params = useParams()
    const location = useLocation()
    const navigate = useNavigate()
    onMount(() => {
        if (!params.boardId) {
            return
        }
        octoClient.getBoard(params.boardId).then((board) => {
            if (board) {
                const parts = [`/team/${board.teamId}`]
                if (shared) {
                    parts.push('/shared')
                }
                for (const segment of [board.id, params.viewId, params.cardId]) {
                    if (segment) {
                        parts.push(`/${segment}`)
                    }
                }
                navigate(parts.join('') + location.search, {replace: true})
            }
        })
    })
    return null
}

const GlobalErrorRedirect: Component = () => {
    const {actions} = useAppStore()
    const globalError = useAppSelector<string>(getGlobalError)
    const navigate = useNavigate()

    createEffect(() => {
        const error = globalError()
        if (error) {
            actions.globalError.setGlobalError('')
            navigate(`/error?id=${error}`, {replace: true})
        }
    })

    return null
}

const rootLayout = (props: {children?: JSX.Element}) => (
    <>
        <GlobalErrorRedirect/>
        {props.children}
    </>
)

const AppRouter: Component = () => {
    return (
        <Router
            base={Utils.getFrontendBaseURL()}
            root={rootLayout}
        >
            <FBRoute
                path='/error'
                component={ErrorPage}
            />
            <FBRoute
                path='/login'
                component={LoginPage}
            />
            <FBRoute
                path='/register'
                component={RegisterPage}
            />
            <FBRoute
                path='/change_password'
                component={ChangePasswordPage}
            />

            <FBRoute
                path='/acp/terminal/:terminalId'
                component={() => (
                    <Suspense fallback={null}>
                        <TerminalPage/>
                    </Suspense>
                )}
            />

            <FBRoute
                path='/m'
                component={() => (
                    <Suspense fallback={null}>
                        <MobilePage/>
                    </Suspense>
                )}
            />
            <FBRoute
                path='/m/terminal/:terminalId'
                component={() => (
                    <Suspense fallback={null}>
                        <TerminalPage softKeys={true}/>
                    </Suspense>
                )}
            />

            <FBRoute
                path='/team/:teamId/new/:channelId'
                component={() => <BoardPage new={true}/>}
            />

            <FBRoute
                path={['/team/:teamId/shared/:boardId?/:viewId?/:cardId?', '/shared/:boardId?/:viewId?/:cardId?']}
                component={() => <BoardPage readonly={true}/>}
            />

            <FBRoute
                loginRequired={true}
                path='/board/:boardId?/:viewId?/:cardId?'
                getOriginalPath={({boardId, viewId, cardId}) => {
                    return `/board/${Utils.buildOriginalPath('', boardId, viewId, cardId)}`
                }}
                component={BoardPage}
            />
            <FBRoute
                path='/workspace/:workspaceId/shared/:boardId?/:viewId?/:cardId?'
                component={workspaceToTeamRedirect(true)}
            />
            <FBRoute
                path='/workspace/:workspaceId/:boardId?/:viewId?/:cardId?'
                component={workspaceToTeamRedirect(false)}
            />
            <FBRoute
                loginRequired={true}
                path='/team/:teamId/:boardId?/:viewId?/:cardId?'
                getOriginalPath={({teamId, boardId, viewId, cardId}) => {
                    return `/team/${Utils.buildOriginalPath(teamId, boardId, viewId, cardId)}`
                }}
                component={BoardPage}
            />

            <FBRoute
                path='/:boardId?/:viewId?/:cardId?'
                loginRequired={true}
                getOriginalPath={({boardId, viewId, cardId}) => {
                    const boardIdIsValidUUIDV4 = UUID_REGEX.test(boardId || '')
                    if (boardIdIsValidUUIDV4) {
                        return `/${Utils.buildOriginalPath('', boardId, viewId, cardId)}`
                    }
                    return ''
                }}
                component={BoardPage}
            />
        </Router>
    )
}

export default AppRouter
