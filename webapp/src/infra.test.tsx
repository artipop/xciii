// The infrastructure the whole UI port stands on: the intl shim must format
// the same ICU messages react-intl did, and the route guard must bounce a
// logged-out visitor to /error with the original path — behaviour every page
// silently depends on.

import {MemoryRouter, createMemoryHistory, useLocation} from '@solidjs/router'
import {render, screen} from '@solidjs/testing-library'
import '@testing-library/jest-dom'

import {FormattedMessage, IntlProvider, useIntl} from './intl'
import {AppStoreProvider, createAppStore} from './store'
import FBRoute from './route'

describe('intl shim', () => {
    test('FormattedMessage falls back to the default message', () => {
        render(() => (
            <IntlProvider
                locale='en'
                messages={{}}
            >
                <FormattedMessage
                    id='test.hello'
                    defaultMessage='Hello {name}'
                    values={{name: 'world'}}
                />
            </IntlProvider>
        ))
        expect(screen.getByText('Hello world')).toBeInTheDocument()
    })

    test('FormattedMessage prefers the locale catalogue over the default', () => {
        render(() => (
            <IntlProvider
                locale='ru'
                messages={{'test.hello': 'Привет {name}'}}
            >
                <FormattedMessage
                    id='test.hello'
                    defaultMessage='Hello {name}'
                    values={{name: 'мир'}}
                />
            </IntlProvider>
        ))
        expect(screen.getByText('Привет мир')).toBeInTheDocument()
    })

    test('useIntl formats messages imperatively', () => {
        const Probe = () => {
            const intl = useIntl()
            return <span>{intl.formatMessage({id: 'x', defaultMessage: 'formatted {n}'}, {n: 42})}</span>
        }
        render(() => (
            <IntlProvider
                locale='en'
                messages={{}}
            >
                <Probe/>
            </IntlProvider>
        ))
        expect(screen.getByText('formatted 42')).toBeInTheDocument()
    })
})

describe('route guard', () => {
    const renderRoutes = (loggedIn: boolean|null, path: string) => {
        const store = createAppStore()
        store.actions.users.setMe(loggedIn ? {id: 'user-1', username: 'u'} as Parameters<typeof store.actions.users.setMe>[0] : null)
        const history = createMemoryHistory()
        history.set({value: path})

        const LocationProbe = () => {
            const location = useLocation()
            return <div data-testid='location'>{location.pathname + location.search}</div>
        }

        render(() => (
            <AppStoreProvider store={store}>
                <MemoryRouter
                    history={history}
                    root={(props) => (
                        <>
                            <LocationProbe/>
                            {props.children}
                        </>
                    )}
                >
                    <FBRoute
                        path='/error'
                        component={() => <div>{'error page'}</div>}
                    />
                    <FBRoute
                        loginRequired={true}
                        path='/board/:boardId?'
                        getOriginalPath={({boardId}) => `/board/${boardId || ''}`}
                        component={() => <div>{'board page'}</div>}
                    />
                </MemoryRouter>
            </AppStoreProvider>
        ))
        return history
    }

    test('a logged-out visitor is bounced to /error with the original path', async () => {
        renderRoutes(false, '/board/board-1')
        const location = await screen.findByTestId('location')
        expect(location.textContent).toContain('/error?id=not-logged-in')
        expect(decodeURIComponent(location.textContent || '')).toContain('/board/board-1')
        expect(screen.queryByText('board page')).not.toBeInTheDocument()
    })

    test('a logged-in visitor sees the page', async () => {
        renderRoutes(true, '/board/board-1')
        expect(await screen.findByText('board page')).toBeInTheDocument()
    })
})
