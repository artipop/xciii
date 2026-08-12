import {render, screen} from '@solidjs/testing-library'
import '@testing-library/jest-dom'

import {mockAppStore, wrapDNDIntl} from '../testUtils'
import {AppStoreProvider} from '../store'
import {Constants} from '../constants'

import TopBar from './topBar'

Object.defineProperty(Constants, 'versionString', {value: '1.0.0'})
vi.mock('../utils')

describe('src/components/topBar', () => {
    let store = mockAppStore({})

    beforeEach(() => {
        vi.clearAllMocks()
        store = mockAppStore({})
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

    // Everything else this corner used to carry — the theme, the language, the
    // way to the manual — is a settings dialog away. What is left is the one
    // thing that is about the moment rather than about the app.
    test('offers somewhere to say that something is broken', () => {
        open()

        expect(screen.getByRole('link', {name: 'Give feedback'})).toHaveAttribute('href', Constants.issuesUrl)
    })
})
