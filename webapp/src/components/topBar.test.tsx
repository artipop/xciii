// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, screen} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {mockAppStore, wrapDNDIntl} from '../testUtils'
import {AppStoreProvider} from '../store'
import {Constants} from '../constants'
import {lightThemeName, setTheme} from '../theme'

import TopBar from './topBar'

Object.defineProperty(Constants, 'versionString', {value: '1.0.0'})
vi.mock('../utils')

describe('src/components/topBar', () => {
    let store = mockAppStore({})

    beforeEach(() => {
        vi.clearAllMocks()
        store = mockAppStore({})
        setTheme(lightThemeName)
    })

    const open = () => render(() => wrapDNDIntl(() =>
        <AppStoreProvider store={store}>
            <TopBar/>
        </AppStoreProvider>,
    ))

    test('should match snapshot', () => {
        const {container} = open()
        expect(container).toMatchSnapshot()
    })

    // How the app looks is changed by looking at it, so it is answered here
    // rather than in the settings dialog three clicks away.
    test('switches the theme from the corner of the board', () => {
        open()

        userEvent.click(screen.getByRole('button', {name: 'Set theme'}))
        userEvent.click(screen.getByText('Dark theme'))

        expect(document.documentElement.dataset.theme).toBe('dark')
    })

    test('switches the language from the corner of the board', () => {
        open()

        userEvent.click(screen.getByRole('button', {name: 'Set language'}))
        userEvent.click(screen.getByText('Deutsch'))

        expect(store.state.language.value).toBe('de')
    })
})
