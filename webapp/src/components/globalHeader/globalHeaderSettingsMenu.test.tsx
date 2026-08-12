import {render} from '@solidjs/testing-library'

import userEvent from '@testing-library/user-event'

import {TestRouter, mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import TelemetryClient, {TelemetryCategory, TelemetryActions} from '../../telemetry/telemetryClient'

import client from '../../octoClient'

import GlobalHeaderSettingsMenu from './globalHeaderSettingsMenu'

vi.mock('../../telemetry/telemetryClient')
vi.mock('../../octoClient')
const mockedTelemetry = vi.mocked(TelemetryClient)
const mockedOctoClient = vi.mocked(client)

describe('components/sidebar/GlobalHeaderSettingsMenu', () => {
    let store = mockAppStore({})
    beforeEach(() => {
        store = mockAppStore({
            teams: {
                current: {id: 'team_id_1'},
            },
            boards: {
                current: 'board_id',
                boards: {
                    board_id: {id: 'board_id'},
                },
                myBoardMemberships: {
                    board_id: {userId: 'user_id_1', schemeAdmin: true},
                },
            },
            users: {
                me: {
                    id: 'user-id',
                },
            },
        })
    })
    test('settings menu closed should match snapshot', () => {
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <GlobalHeaderSettingsMenu history={history}/>
                </TestRouter>
            </AppStoreProvider>,
        )

        const {container} = render(component)
        expect(container).toMatchSnapshot()
    })

    test('settings menu open should match snapshot', () => {
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <GlobalHeaderSettingsMenu history={history}/>
                </TestRouter>
            </AppStoreProvider>,
        )

        const {container} = render(component)
        userEvent.click(container.querySelector('.menu-entry') as Element)
        expect(container).toMatchSnapshot()
    })

    test('languages menu open should match snapshot', () => {
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <GlobalHeaderSettingsMenu history={history}/>
                </TestRouter>
            </AppStoreProvider>,
        )

        const {container} = render(component)
        userEvent.click(container.querySelector('.menu-entry') as Element)
        userEvent.hover(container.querySelector('#lang') as Element)
        expect(container).toMatchSnapshot()
    })

    test('imports menu open should match snapshot', () => {
        window.open = vi.fn()
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <GlobalHeaderSettingsMenu history={history}/>
                </TestRouter>
            </AppStoreProvider>,
        )

        const {container} = render(component)
        userEvent.click(container.querySelector('.menu-entry') as Element)
        userEvent.click(container.querySelector('#import') as Element)
        expect(container).toMatchSnapshot()

        userEvent.click(document.querySelector('[aria-label="Trello"]') as Element)
        expect(mockedTelemetry.trackEvent).toHaveBeenCalledWith(TelemetryCategory, TelemetryActions.ImportTrello)
    })

    test('Product Tour option restarts the tour', () => {
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <GlobalHeaderSettingsMenu history={history}/>
                </TestRouter>
            </AppStoreProvider>,
        )

        const {container} = render(component)
        userEvent.click(container.querySelector('.menu-entry') as Element)
        userEvent.click(container.querySelector('.product-tour') as Element)

        expect(mockedOctoClient.patchUserConfig).toHaveBeenCalledWith('user-id', {
            updatedFields: {
                onboardingTourStarted: '1',
                onboardingTourStep: '0',
                tourCategory: 'onboarding',
            },
        })
    })
})
