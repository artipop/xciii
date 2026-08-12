import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import AppSettingsDialog from './appSettingsDialog'

const anyWindow = window as any

describe('components/settings/appSettingsDialog', () => {
    const store = mockAppStore({teams: {current: {id: 'team-id'}}})

    const bindings = () => ({
        ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'claude', kind: 'claude'}])),
        ListAgentAdapters: vi.fn().mockResolvedValue('[]'),
        ListDeployTargets: vi.fn().mockResolvedValue(JSON.stringify([{name: 'dokku-1', sshHost: 'dokku.example.com'}])),
        ListProxies: vi.fn().mockResolvedValue(JSON.stringify([{name: 'office', proxy: 'http://proxy.example.com:8080'}])),
        GetTailnetAccess: vi.fn().mockResolvedValue(JSON.stringify({enabled: false, hostname: 'board', status: 'off', path: '/x'})),
        GetPlanningPrompt: vi.fn().mockResolvedValue('Think it through.'),
        GetWorktreeMode: vi.fn().mockResolvedValue('always'),
    })

    const open = () => render(() => wrapIntl(() =>
        <AppStoreProvider store={store}>
            <AppSettingsDialog onClose={vi.fn()}/>
        </AppStoreProvider>,
    ))

    afterEach(() => {
        delete anyWindow.go
        vi.clearAllMocks()
    })

    // The point of the move: none of this is about a board, so none of it needs
    // one open. The dialog is handed no board and asks for none.
    test('opens every machine registry without a board', async () => {
        anyWindow.go = {main: {App: bindings()}}

        open()

        // Agents is where it lands, because it is the first thing anybody comes
        // here for. ("claude" is both the agent's name and its kind, so the
        // registered row is matched by its own class.)
        await waitFor(() => expect(document.querySelector('.AgentsPanel__name')).toHaveTextContent('claude'))

        // Proxies used to be folded inside the agents form, two levels down.
        // They are a section of their own now.
        userEvent.click(screen.getByRole('button', {name: 'Proxy configurations'}))
        await waitFor(() => expect(screen.getByText('office')).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Where to deploy'}))
        await waitFor(() => expect(screen.getByText('dokku-1')).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Access from a phone'}))
        await waitFor(() => expect(screen.getByText('The board is on this machine only')).toBeInTheDocument())
    })

    // What a conversation with an agent opens saying is a setting of the
    // install, and used to be edited in the dialog that opens one — which made
    // it look like part of opening it.
    test('carries the instructions a card-less conversation starts with', async () => {
        anyWindow.go = {main: {App: bindings()}}

        open()
        userEvent.click(screen.getByRole('button', {name: 'Other'}))

        await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('Think it through.'))
    })

    // Whether an agent may interrupt is a setting of the install like the rest
    // of them, and it was the last thing left in the sidebar's menu.
    test('carries whether an agent waiting may interrupt', async () => {
        anyWindow.go = {main: {App: bindings()}}

        open()
        userEvent.click(screen.getByRole('button', {name: 'Other'}))

        await waitFor(() => expect(screen.getByText('Notify me when an agent is waiting')).toBeInTheDocument())
        expect(document.querySelector('.Switch')).toBeTruthy()
    })

    // A build that cannot do a thing does not offer a section for it.
    test('leaves out what this build has no bindings for', async () => {
        anyWindow.go = {main: {App: {ListAgents: vi.fn().mockResolvedValue('[]')}}}

        open()

        await waitFor(() => expect(screen.getByRole('button', {name: 'Agents'})).toBeInTheDocument())
        expect(screen.queryByRole('button', {name: 'Where to deploy'})).toBeNull()
        expect(screen.queryByRole('button', {name: 'Access from a phone'})).toBeNull()
        expect(screen.queryByRole('button', {name: 'Proxy configurations'})).toBeNull()
    })

    // Carrying boards in and out is not part of the agent integration: a build
    // with no agents at all still opens on it.
    test('offers import and export whatever else the machine can do', async () => {
        open()

        await waitFor(() => expect(screen.getByRole('button', {name: 'Import and export'})).toBeInTheDocument())
        expect(screen.getByText('Import archive')).toBeInTheDocument()
        expect(screen.getByText('Export archive')).toBeInTheDocument()
    })
})
