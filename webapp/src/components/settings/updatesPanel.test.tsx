import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'

import UpdatesPanel, {isUpdatesAvailable} from './updatesPanel'

const anyWindow = window as any

// The event socket, kept where a test can make a download happen while the
// panel is open. vi.mock is hoisted above the imports, so what it captures has
// to be too.
const {handlers} = vi.hoisted(() => ({handlers: {} as Record<string, (payload?: any) => void>}))

vi.mock('../acp/agentEvents', () => ({
    onAgentEvent: (event: string, handler: (payload?: any) => void) => {
        handlers[event] = handler
        return () => delete handlers[event]
    },
}))

function bindings(state: Record<string, unknown>) {
    return {
        GetUpdateState: vi.fn().mockResolvedValue(JSON.stringify({
            supported: true,
            enabled: true,
            currentVersion: '1.0.0',
            status: 'idle',
            ...state,
        })),
        SetUpdateSettings: vi.fn().mockResolvedValue('{}'),
        CheckForUpdate: vi.fn().mockResolvedValue(undefined),
        InstallUpdate: vi.fn().mockResolvedValue(undefined),
        SkipUpdateVersion: vi.fn().mockResolvedValue(undefined),
        RestartToUpdate: vi.fn().mockResolvedValue(undefined),
    }
}

const open = () => render(() => wrapIntl(() => <UpdatesPanel/>))

describe('components/settings/updatesPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        Object.keys(handlers).forEach((event) => delete handlers[event])
    })

    afterEach(() => {
        delete anyWindow.go
    })

    // The same bundle is served in a plain browser,
    // where there is nothing to update and nothing to ask. The settings dialog
    // leaves the whole section out on this answer.
    it('is inert without desktop bindings', () => {
        expect(isUpdatesAvailable()).toBe(false)
    })

    it('names the version that is running', async () => {
        anyWindow.go = {main: {App: bindings({})}}

        open()

        expect(await screen.findByText('Installed version 1.0.0')).toBeInTheDocument()
        expect(screen.getByText('Not checked yet')).toBeInTheDocument()
    })

    // Two editions are two installers under one app name, so this line is the
    // only place on screen that says which one is running.
    it('names the edition beside the version', async () => {
        anyWindow.go = {main: {App: bindings({edition: 'lifetime'})}}

        open()

        expect(await screen.findByText('Edition: Lifetime')).toBeInTheDocument()
    })

    // A build this page has never heard of still says what it is: a word we
    // cannot translate beats a blank line, and both beat "Basic".
    it('prints an edition it does not know as it came', async () => {
        anyWindow.go = {main: {App: bindings({edition: 'team'})}}

        open()

        expect(await screen.findByText('Edition: team')).toBeInTheDocument()
    })

    // Nothing is downloaded until somebody asks: a hundred megabytes over
    // somebody's connection is not a thing to do quietly in the background.
    it('offers a found version rather than installing it', async () => {
        const app = bindings({status: 'available', availableVersion: '1.1.0', sizeBytes: 52428800})
        anyWindow.go = {main: {App: app}}

        open()

        expect(await screen.findByText('Version 1.1.0 is available')).toBeInTheDocument()
        expect(app.InstallUpdate).not.toHaveBeenCalled()

        await userEvent.click(screen.getByText('Install'))

        await waitFor(() => expect(app.InstallUpdate).toHaveBeenCalled())
    })

    // A check that started on the timer has to draw the same as one this panel
    // asked for, or a person watching the panel sees nothing happen while the
    // app downloads a release behind it.
    it('follows a download that nobody started here', async () => {
        anyWindow.go = {main: {App: bindings({})}}

        open()
        await screen.findByText('Installed version 1.0.0')

        handlers['acp:update']({
            supported: true,
            enabled: true,
            currentVersion: '1.0.0',
            status: 'downloading',
            availableVersion: '1.1.0',
            sizeBytes: 100,
            downloaded: 40,
        })

        expect(await screen.findByText('Downloading…')).toBeInTheDocument()
    })

    // An installed update is not applied until the app is restarted, and the
    // restart is a person's decision — this is the only thing that offers it.
    it('offers the restart that applies a staged update', async () => {
        const app = bindings({status: 'ready', availableVersion: '1.1.0'})
        anyWindow.go = {main: {App: app}}

        open()

        await userEvent.click(await screen.findByText('Restart and update'))

        await waitFor(() => expect(app.RestartToUpdate).toHaveBeenCalled())
    })

    // Skipping is remembered by the Go side across restarts; the panel's job is
    // only to say that it happened, so a version that stops being offered does
    // not read as a check that stopped working.
    it('says which version was skipped', async () => {
        anyWindow.go = {main: {App: bindings({status: 'up-to-date', skippedVersion: '1.1.0'})}}

        open()

        expect(await screen.findByText('Version 1.1.0 is skipped and will not be offered again.')).toBeInTheDocument()
    })

    // A previous run's result is not carried over, only when it looked. Saying
    // "Not checked yet" directly above "Last checked yesterday" is the app
    // contradicting itself in two adjacent lines.
    it('says nothing about a result it does not have', async () => {
        anyWindow.go = {main: {App: bindings({status: 'idle', lastCheckedAt: '2026-08-13T10:00:00Z'})}}

        open()

        await screen.findByText('Installed version 1.0.0')
        expect(screen.queryByText('Not checked yet')).toBeNull()
        expect(screen.getByText(/Last checked/)).toBeInTheDocument()
    })

    // The framework's errors are English and shaped like a Go stack of wrapped
    // verbs. What a person can act on is said here, in their language; the raw
    // text stays because it is the half a bug report needs.
    it('says what went wrong in the reader\'s language, keeping the raw text', async () => {
        anyWindow.go = {main: {App: bindings({
            status: 'error',
            errorStage: 'check',
            error: 'updater: all providers failed: dial tcp: lookup updates.deffun.org: no such host',
        })}}

        open()

        expect(await screen.findByText('Could not reach the update server.')).toBeInTheDocument()
        expect(screen.getByText(/no such host/)).toBeInTheDocument()
    })

    it('turns the automatic check off', async () => {
        const app = bindings({})
        anyWindow.go = {main: {App: app}}

        const {container} = open()
        await screen.findByText('Installed version 1.0.0')

        await userEvent.click(container.querySelector('.Switch')!)

        await waitFor(() => expect(app.SetUpdateSettings).toHaveBeenCalledWith(JSON.stringify({enabled: false})))
    })
})
