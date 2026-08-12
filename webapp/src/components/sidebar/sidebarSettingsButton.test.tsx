import {render, screen, waitFor} from '@solidjs/testing-library'

import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import SidebarSettingsButton from './sidebarSettingsButton'

describe('components/sidebar/SidebarSettingsButton', () => {
    let store = mockAppStore({})
    beforeEach(() => {
        store = mockAppStore({
            teams: {
                current: {id: 'team-id'},
            },
        })
    })

    const open = () => {
        render(() => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <SidebarSettingsButton/>
            </AppStoreProvider>,
        ))
        userEvent.click(screen.getByRole('button', {name: 'Settings'}))
    }

    // The foot of the sidebar used to be a menu with two levels of submenu in
    // it. One dialog is what a person opens looking for any setting at all.
    test('opens the settings of the app', async () => {
        open()

        await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
        expect(screen.getByRole('button', {name: 'Import and export'})).toBeInTheDocument()
    })

    // A build with no agents on it still has boards to carry in and out, so the
    // dialog is not gated on the machine having an agent integration at all.
    test('is offered on a machine with no agents', async () => {
        open()

        await waitFor(() => expect(screen.getByRole('button', {name: 'Import and export'})).toBeInTheDocument())
        expect(screen.queryByRole('button', {name: 'Agents'})).toBeNull()
    })

    // The two settings that are changed by looking at the screen are not in
    // here: they live in the corner of the board.
    test('leaves the theme and the language to the top of the board', async () => {
        open()

        await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
        expect(screen.queryByText('Set theme')).toBeNull()
        expect(screen.queryByText('Set language')).toBeNull()
    })
})
