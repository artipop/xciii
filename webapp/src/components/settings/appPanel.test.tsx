import {render, screen} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {TestRouter, mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'
import {Constants} from '../../constants'
import {lightThemeName, setTheme} from '../../theme'

import AppPanel from './appPanel'

describe('components/settings/appPanel', () => {
    let store = mockAppStore({})

    beforeEach(() => {
        vi.clearAllMocks()
        store = mockAppStore({})
        setTheme(lightThemeName)
    })

    const open = () => render(() => wrapIntl(() =>
        <AppStoreProvider store={store}>
            <TestRouter>
                <AppPanel/>
            </TestRouter>
        </AppStoreProvider>,
    ))

    // How the app looks used to be an icon menu in the corner of the board.
    // It is a setting of the install like every other one here, and the three
    // themes are on the panel rather than behind a menu.
    test('switches the theme', () => {
        open()

        userEvent.click(screen.getByRole('button', {name: 'Dark theme'}))

        expect(document.documentElement.dataset.theme).toBe('dark')
    })

    test('switches the language', () => {
        open()

        userEvent.click(screen.getByRole('button', {name: 'Deutsch'}))

        expect(store.state.language.value).toBe('de')
    })

    test('offers every language it speaks', () => {
        open()

        for (const language of Constants.languages) {
            expect(screen.getByRole('button', {name: language.displayName})).toBeInTheDocument()
        }
    })

    // The question mark in the corner of the board was a link and nothing else,
    // which is a thing a person looks for in the settings and not on a board.
    // Where it leads is the manual, not a source tree: somebody opening
    // «Руководство» wants to be told how the board works.
    test('leads to the guide', () => {
        open()

        expect(screen.getByRole('link', {name: 'Open'})).toHaveAttribute('href', Constants.guideUrl)
    })

    // The last thing left in the corner of the board, and the reason that
    // corner outlived the theme and the language. Somewhere to say that
    // something is broken is looked for once, which is here — and it is a
    // letter, so that saying it costs nobody an account anywhere.
    test('offers somewhere to say that something is broken', () => {
        open()

        expect(screen.getByRole('link', {name: 'Write'})).toHaveAttribute('href', `mailto:${Constants.feedbackEmail}`)
    })

    // The address is on the panel and not only in the link, because a webview
    // that refuses to open a mailto: leaves a person with nothing to copy.
    test('shows the address it writes to', () => {
        open()

        expect(screen.getByText(`Bugs and requests go by email, to ${Constants.feedbackEmail}.`)).toBeInTheDocument()
    })
})
