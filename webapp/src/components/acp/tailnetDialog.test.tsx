// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'

import TailnetDialog, {isTailnetAvailable} from './tailnetDialog'

const anyWindow = window as any

const settingsPath = '/Users/x/Library/Application Support/XCIII/tailnet/settings.json'

function bindings(state: Record<string, unknown>) {
    return {
        GetTailnetAccess: vi.fn().mockResolvedValue(JSON.stringify({path: settingsPath, ...state})),
        SetTailnetAccess: vi.fn().mockImplementation((json: string) => {
            const want = JSON.parse(json)
            return Promise.resolve(JSON.stringify({
                path: settingsPath,
                enabled: want.enabled,
                hostname: want.hostname,
                status: want.enabled ? 'joining' : 'off',
            }))
        }),
    }
}

const renderDialog = () => render(() => wrapIntl(() => <TailnetDialog onClose={() => undefined}/>))

describe('components/acp/tailnetDialog', () => {
    beforeEach(() => vi.clearAllMocks())

    afterEach(() => {
        delete anyWindow.go
    })

    it('is inert without desktop bindings', () => {
        expect(isTailnetAvailable()).toBe(false)
    })

    // The address is the whole reason to open this panel: it is typed into a
    // phone by hand, so it has to be on screen in full.
    it('shows the address a phone opens once the board is published', async () => {
        anyWindow.go = {main: {App: bindings({
            enabled: true,
            hostname: 'board',
            status: 'on',
            url: 'https://board.tail1234.ts.net/m',
        })}}

        renderDialog()

        expect(await screen.findByText('https://board.tail1234.ts.net/m')).toBeInTheDocument()
        expect(screen.getByText('The board is on your tailnet')).toBeInTheDocument()
    })

    // Turning it on is not a settings file that takes effect next launch: the
    // node comes up on this call, and the panel says so while it does.
    it('publishes the board under the name that was typed', async () => {
        const app = bindings({enabled: false, hostname: '', status: 'off'})
        anyWindow.go = {main: {App: app}}

        renderDialog()
        await waitFor(() => expect(app.GetTailnetAccess).toHaveBeenCalled())

        const field = await screen.findByRole('textbox')
        await userEvent.clear(field)
        await userEvent.type(field, 'desk')
        await userEvent.click(screen.getByText('Publish the board'))

        await waitFor(() => expect(app.SetTailnetAccess).toHaveBeenCalledWith(JSON.stringify({enabled: true, hostname: 'desk'})))
        expect(await screen.findByText('Joining the tailnet…')).toBeInTheDocument()
    })

    // A first run waits for a person to follow a login URL, and a panel that did
    // not say so would look like one that had hung.
    it('offers the login link while the machine is being registered', async () => {
        anyWindow.go = {main: {App: bindings({
            enabled: true,
            hostname: 'board',
            status: 'login',
            loginUrl: 'https://login.tailscale.com/a/abcdef',
        })}}

        renderDialog()

        expect(await screen.findByText('https://login.tailscale.com/a/abcdef')).toBeInTheDocument()
        expect(screen.getByText('Waiting for you to log this machine in')).toBeInTheDocument()
    })

    // Switching it off has to be reachable from the same place, or the only way
    // back is the settings file.
    it('stops publishing', async () => {
        const app = bindings({enabled: true, hostname: 'board', status: 'on', url: 'https://board.tail1234.ts.net/m'})
        anyWindow.go = {main: {App: app}}

        renderDialog()

        await userEvent.click(await screen.findByText('Stop publishing'))

        await waitFor(() => expect(app.SetTailnetAccess).toHaveBeenCalledWith(JSON.stringify({enabled: false, hostname: 'board'})))
    })
})
