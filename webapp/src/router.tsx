import {Component, Show, Suspense, createEffect, lazy, onMount} from 'solid-js'
import {Router, useLocation, useNavigate, useParams} from '@solidjs/router'
import type {JSX} from 'solid-js'

import BoardPage from './pages/boardPage/boardPage'
import ChangePasswordPage from './pages/changePasswordPage'
import ErrorPage from './pages/errorPage'
import LoginPage from './pages/loginPage'
import RegisterPage from './pages/registerPage'
import WelcomePage from './pages/welcome/welcomePage'
import {Utils} from './utils'
import octoClient from './octoClient'
import {getGlobalError} from './store/globalError'
import {getMe, getMyConfig} from './store/users'
import {useAppSelector, useAppStore} from './store/hooks'
import {UserSettingKey} from './userSettings'
import FBRoute from './route'

// The desktop app's terminal window: the agent's own CLI on a card, drawn by
// xterm.js. Its own route so the window is just a URL — and lazily loaded so a
// browser build, which cannot open one, never pays for the emulator.
const TerminalPage = lazy(() => import('./components/acp/terminalPage'))

// The board on a phone: what is waiting for a person, and the terminals it is
// waiting in. Lazy for the same reason — a desktop window never opens these,
// and a browser build should not carry them.
const MobilePage = lazy(() => import('./pages/mobile/mobilePage'))

// The dialog the system's «Поделиться» opens: a link, and the one question of
// which board it goes on. Lazy like the other two — the board itself never
// shows it, and it is opened by the app in a window of its own.
const SharePage = lazy(() => import('./pages/share/sharePage'))

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

// Where the welcome screen must never appear. The phone, the share dialog and
// the terminal are windows opened to do one thing, and a login screen is not a
// place to greet somebody either — each would be hijacked by a greeting that
// only makes sense on the way to a board. `/welcome` is here because the route
// below already renders the page: without it, it would be rendered twice.
const NOT_A_FIRST_RUN = ['/welcome', '/m', '/share', '/acp', '/login', '/register', '/error', '/change_password']

// Whether the person in front of this window has ever been greeted. "Once" is a
// fact about them rather than about this machine: welcomePageViewed is a user
// preference the board server keeps, so a second window and a phone do not greet
// somebody twice, and settings can clear it to run the tour again.
const useNeedsWelcome = () => {
    const location = useLocation()
    const me = useAppSelector(getMe)
    const myConfig = useAppSelector(getMyConfig)

    return () => {
        const user = me()
        if (!user || user.is_guest || myConfig()[UserSettingKey.WelcomePageViewed]) {
            return false
        }
        const path = location.pathname
        return !NOT_A_FIRST_RUN.some((prefix) => path === prefix || path.startsWith(prefix + '/'))
    }
}

// The greeting stands in front of the board rather than redirecting to it. A
// redirect had to win a race it could not: the board page navigates to the last
// team and board of its own accord, so `navigate('/welcome')` was undone by
// whichever of those effects ran next, and clearing the preference from settings
// left the person looking at the board they were already on. Not having been
// greeted is a state, and a state has nothing to race with.
const rootLayout = (props: {children?: JSX.Element}) => {
    const needsWelcome = useNeedsWelcome()

    return (
        <>
            <GlobalErrorRedirect/>
            <Show
                when={!needsWelcome()}
                fallback={<WelcomePage/>}
            >
                {props.children}
            </Show>
        </>
    )
}

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
                loginRequired={true}
                path='/welcome'
                component={WelcomePage}
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
                path='/share'
                component={() => (
                    <Suspense fallback={null}>
                        <SharePage/>
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
