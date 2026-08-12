import {render, screen, waitFor} from '@solidjs/testing-library'

import {MemoryRouter, Route, createMemoryHistory, useLocation} from '@solidjs/router'

import userEvent from '@testing-library/user-event'

import {mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider, AppStore} from '../../store'

import mutator from '../../mutator'

import octoClient from '../../octoClient'

import {IUser} from '../../user'

import WelcomePage from './welcomePage'

const w = (window as any)
const oldBaseURL = w.baseURL

vi.mock('../../mutator')
const mockedMutator = vi.mocked(mutator)

vi.mock('../../octoClient')
const mockedOctoClient = vi.mocked(octoClient)

beforeEach(() => {
    vi.resetAllMocks()
    mockedMutator.patchUserConfig.mockImplementation(() => Promise.resolve([
        {
            user_id: '',
            category: 'xciii',
            name: 'welcomePageViewed',
            value: '1',
        },
    ]))
    mockedOctoClient.prepareOnboarding.mockResolvedValue({
        teamID: 'team_id_1',
        boardID: 'board_id_1',
    })
})

afterEach(() => {
    w.baseURL = oldBaseURL
})

describe('pages/welcome', () => {
    const freshStore = () => mockAppStore({
        teams: {
            current: {id: 'team_id_1'} as any,
        },
        users: {
            me: {props: {}} as unknown as IUser,
            myConfig: {
                onboardingTourStep: {value: '0'},
                tourCategory: {value: 'onboarding'},
            } as any,
        },
    })

    // Where the router ended up, read back the way infra.test does: the page
    // redirects by navigating, so the test watches the location rather than
    // spying on a history object.
    const LocationProbe = () => {
        const location = useLocation()
        return <div data-testid='location'>{location.pathname + location.search}</div>
    }

    const renderPage = (store: AppStore, path = '/welcome') => {
        const history = createMemoryHistory()
        history.set({value: path})
        return render(() =>
            <AppStoreProvider store={store}>
                {wrapIntl(() =>
                    <MemoryRouter
                        history={history}
                        root={(props) => (
                            <>
                                <LocationProbe/>
                                {props.children}
                            </>
                        )}
                    >
                        <Route
                            path='/welcome'
                            component={WelcomePage}
                        />
                        <Route
                            path='*rest'
                            component={() => null}
                        />
                    </MemoryRouter>,
                )}
            </AppStoreProvider>,
        )
    }

    test('Welcome Page shows Explore Page', () => {
        const {container} = renderPage(freshStore())
        expect(screen.getByText('Take a tour')).toBeDefined()
        expect(container).toMatchSnapshot()
    })

    test('Welcome Page shows Explore Page with subpath', () => {
        w.baseURL = '/subpath'
        const {container} = renderPage(freshStore())
        expect(screen.getByText('Take a tour')).toBeDefined()
        expect(container).toMatchSnapshot()
    })

    test('Welcome Page shows Explore Page And Then Proceeds after Clicking Explore', async () => {
        renderPage(freshStore())
        const exploreButton = screen.getByText('No thanks, I\'ll figure it out myself')
        expect(exploreButton).toBeDefined()
        userEvent.click(exploreButton)
        await waitFor(() => {
            expect(screen.getByTestId('location').textContent).toBe('/team/team_id_1')
            expect(mockedMutator.patchUserConfig).toHaveBeenCalledTimes(1)
        })
    })

    test('Welcome Page does not render explore page the second time we visit it', async () => {
        const store = mockAppStore({
            teams: {
                current: {id: 'team_id_1'} as any,
            },
            users: {
                me: {} as IUser,
                myConfig: {
                    welcomePageViewed: {value: '1'},
                } as any,
            },
        })
        renderPage(store)
        await waitFor(() => {
            expect(screen.getByTestId('location').textContent).toBe('/team/team_id_1')
        })
        expect(screen.queryByText('Take a tour')).toBeNull()
    })

    test('Welcome Page redirects us when we have a r query parameter with welcomePageViewed set to true', async () => {
        const store = mockAppStore({
            teams: {
                current: {id: 'team_id_1'} as any,
            },
            users: {
                me: {} as IUser,
                myConfig: {
                    welcomePageViewed: {value: '1'},
                } as any,
            },
        })
        renderPage(store, '/welcome?r=/123')
        await waitFor(() => {
            expect(screen.getByTestId('location').textContent).toBe('/123')
        })
    })

    test('Welcome Page redirects us when we have a r query parameter with welcomePageViewed set to null', async () => {
        const store = mockAppStore({
            teams: {
                current: {id: 'team_id_1'} as any,
            },
            users: {
                me: {props: {}} as unknown as IUser,
            },
        })
        renderPage(store, '/welcome?r=/123')
        const exploreButton = screen.getByText('No thanks, I\'ll figure it out myself')
        expect(exploreButton).toBeDefined()
        userEvent.click(exploreButton)
        await waitFor(() => {
            expect(screen.getByTestId('location').textContent).toBe('/123')
            expect(mockedMutator.patchUserConfig).toHaveBeenCalledTimes(1)
        })
    })

    test('Welcome page starts tour on clicking Take a tour button', async () => {
        const user = {} as unknown as IUser
        mockedOctoClient.getMe.mockResolvedValue(user)

        renderPage(freshStore())
        const exploreButton = screen.getByText('Take a tour')
        expect(exploreButton).toBeDefined()
        userEvent.click(exploreButton)
        await waitFor(() => expect(mockedOctoClient.prepareOnboarding).toHaveBeenCalledTimes(1))
        await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/team/team_id_1/board_id_1'))
    })

    test('Welcome page skips tour on clicking no thanks option', async () => {
        const user = {} as unknown as IUser
        mockedOctoClient.getMe.mockResolvedValue(user)

        renderPage(freshStore())
        const exploreButton = screen.getByText('No thanks, I\'ll figure it out myself')
        expect(exploreButton).toBeDefined()
        userEvent.click(exploreButton)
        await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/team/team_id_1'))
    })
})
