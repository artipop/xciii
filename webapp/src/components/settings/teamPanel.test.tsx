import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'

import TeamPanel, {inviteLink, isTeamAvailable} from './teamPanel'

const anyWindow = window as any

function bindings(state: Record<string, unknown>) {
    return {
        GetTeamAccess: vi.fn().mockResolvedValue(JSON.stringify({
            enabled: false,
            running: false,
            owner: '',
            invite: '',
            ...state,
        })),
        SetTeamAccess: vi.fn().mockResolvedValue(JSON.stringify({
            enabled: true,
            running: false,
            owner: 'artem',
            invite: '',
        })),
        RegenerateTeamInvite: vi.fn().mockResolvedValue(JSON.stringify({
            enabled: true,
            running: true,
            owner: 'artem',
            invite: 'second-token',
        })),
    }
}

const open = () => render(() => wrapIntl(() => <TeamPanel/>))

describe('components/settings/teamPanel', () => {
    beforeEach(() => vi.clearAllMocks())
    afterEach(() => {
        delete anyWindow.go
    })

    // The same bundle is served in a plain browser, where there is no install
    // to switch. The settings dialog leaves the whole section out on this
    // answer.
    it('is inert without desktop bindings', () => {
        expect(isTeamAvailable()).toBe(false)
    })

    // Turning the mode on is the one moment the person at the machine is asked
    // for a name, so before that the fields have to be there.
    it('asks the person at the machine to name themselves', async () => {
        anyWindow.go = {main: {App: bindings({})}}
        open()

        await waitFor(() => expect(screen.getByText('Your username')).toBeInTheDocument())
        expect(screen.getByText('The board belongs to one person and asks nobody to log in')).toBeInTheDocument()
    })

    // An account that already exists is not asked for again: this is the switch
    // coming back on, and a second password field would read as a second
    // account.
    it('asks nothing of an install that already has an owner', async () => {
        anyWindow.go = {main: {App: bindings({enabled: true, running: true, owner: 'artem', invite: 'first-token'})}}
        open()

        await waitFor(() => expect(screen.getByText('This machine belongs to artem')).toBeInTheDocument())
        expect(screen.queryByText('Your username')).not.toBeInTheDocument()
    })

    // Which mode the board server runs in is decided when it starts, so the
    // panel's whole job after the click is to say that the click is not enough.
    it('says a restart is owed while the file and the server disagree', async () => {
        const app = bindings({})
        anyWindow.go = {main: {App: app}}
        open()

        await waitFor(() => expect(screen.getByText('Your username')).toBeInTheDocument())
        await userEvent.type(screen.getByLabelText('Your username'), 'artem')
        await userEvent.type(screen.getByLabelText('A password, at least six characters'), 'sixchars')
        await userEvent.click(screen.getByText('Work as a team'))

        await waitFor(() => expect(screen.getByText('Restart the app: after that everybody logs in')).toBeInTheDocument())
        expect(JSON.parse(app.SetTeamAccess.mock.calls[0][0])).toEqual({
            enabled: true,
            username: 'artem',
            password: 'sixchars',
        })
    })

    // The invite is the only thing on this panel that leaves the machine, and
    // it is dead until the restart — so it is not offered before then.
    it('offers the invite only once the mode is running', async () => {
        anyWindow.go = {main: {App: bindings({enabled: true, running: false, owner: 'artem', invite: ''})}}
        open()

        await waitFor(() => expect(screen.getByText('This machine belongs to artem')).toBeInTheDocument())
        expect(screen.queryByText('Send this to whoever is joining')).not.toBeInTheDocument()
    })

    it('takes back an invite by asking for a new one', async () => {
        const app = bindings({enabled: true, running: true, owner: 'artem', invite: 'first-token'})
        anyWindow.go = {main: {App: app}}
        open()

        await waitFor(() => expect(screen.getByText(/first-token/)).toBeInTheDocument())
        await userEvent.click(screen.getByText('New link'))

        await waitFor(() => expect(screen.getByText(/second-token/)).toBeInTheDocument())
        expect(screen.queryByText(/first-token/)).not.toBeInTheDocument()
    })

    // The address is built by the page rather than by the Go side, because the
    // page is the half that knows which door it was opened through.
    it('builds the invite on the origin the page was opened from', () => {
        expect(inviteLink('https://board.tail1234.ts.net', 'tok en')).toBe(
            'https://board.tail1234.ts.net/register?t=tok%20en')
        expect(inviteLink('http://localhost:8080', '')).toBe('')
    })
})
