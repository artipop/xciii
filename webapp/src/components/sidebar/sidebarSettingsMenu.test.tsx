// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {render} from '@solidjs/testing-library'

import userEvent from '@testing-library/user-event'

import {mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import {lightThemeName} from '../../theme'

import TelemetryClient, {TelemetryCategory, TelemetryActions} from '../../telemetry/telemetryClient'

import SidebarSettingsMenu from './sidebarSettingsMenu'

vi.mock('../../telemetry/telemetryClient')
const mockedTelemetry = vi.mocked(TelemetryClient)

describe('components/sidebar/SidebarSettingsMenu', () => {
    let store = mockAppStore({})
    beforeEach(() => {
        store = mockAppStore({
            teams: {
                current: {id: 'team-id'},
            },
            boards: {
                current: 'board_id',
                boards: {
                    board_id: {id: 'board_id'},
                },
                templates: [],
                myBoardMemberships: {
                    board_id: {userId: 'user_id_1', schemeAdmin: true},
                },
            },
        })
    })
    test('settings menu closed should match snapshot', () => {
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <SidebarSettingsMenu activeTheme={lightThemeName}/>
            </AppStoreProvider>,
        )

        const {container} = render(component)
        expect(container).toMatchSnapshot()
    })

    test('settings menu open should match snapshot', () => {
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <SidebarSettingsMenu activeTheme={lightThemeName}/>
            </AppStoreProvider>,
        )

        const {container} = render(component)
        userEvent.click(container.querySelector('.menu-entry') as Element)
        expect(container).toMatchSnapshot()
    })

    test('theme menu open should match snapshot', () => {
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <SidebarSettingsMenu activeTheme={lightThemeName}/>
            </AppStoreProvider>,
        )

        const {container} = render(component)
        userEvent.click(container.querySelector('.menu-entry') as Element)
        userEvent.hover(container.querySelector('#theme') as Element)
        expect(container).toMatchSnapshot()
    })

    test('languages menu open should match snapshot', () => {
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <SidebarSettingsMenu activeTheme={lightThemeName}/>
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
                <SidebarSettingsMenu activeTheme={lightThemeName}/>
            </AppStoreProvider>,
        )

        const {container} = render(component)
        userEvent.click(container.querySelector('.menu-entry') as Element)
        userEvent.click(container.querySelector('#import') as Element)
        expect(container).toMatchSnapshot()

        userEvent.click(document.querySelector('[aria-label="Asana"]') as Element)
        expect(mockedTelemetry.trackEvent).toHaveBeenCalledWith(TelemetryCategory, TelemetryActions.ImportAsana)
    })
})
