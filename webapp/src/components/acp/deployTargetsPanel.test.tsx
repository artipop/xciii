// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'

import DeployTargetsPanel, {isDeployTargetsAvailable} from './deployTargetsPanel'

const anyWindow = window as any

describe('components/acp/deployTargetsPanel', () => {
    afterEach(() => {
        delete anyWindow.go
        vi.clearAllMocks()
    })

    test('isDeployTargetsAvailable is false without desktop bindings', () => {
        expect(isDeployTargetsAvailable()).toBe(false)
    })

    test('lists targets and adds one', async () => {
        const bindings = {
            ListDeployTargets: vi.fn().mockResolvedValue(JSON.stringify([
                {name: 'staging', sshHost: 'dokku.example.com', baseApp: 'api'},
            ])),
            AddDeployTarget: vi.fn().mockResolvedValue(JSON.stringify({name: 'preview'})),
            UpdateDeployTarget: vi.fn(),
            RemoveDeployTarget: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}
        expect(isDeployTargetsAvailable()).toBe(true)

        render(() => wrapIntl(() => <DeployTargetsPanel onClose={vi.fn()}/>))
        await waitFor(() => expect(screen.getByText('staging')).toBeInTheDocument())
        expect(screen.getByText('dokku@dokku.example.com → *.dokku.example.com')).toBeInTheDocument()

        userEvent.click(screen.getByRole('button', {name: 'Add target…'}))
        await waitFor(() => expect(screen.getByPlaceholderText('dokku.example.com')).toBeInTheDocument())

        userEvent.type(screen.getByPlaceholderText('Name (also matched against the card\'s options)'), 'preview')
        userEvent.type(screen.getByPlaceholderText('dokku.example.com'), 'dokku.example.com')

        // A target is a host and a domain, nothing else: what a preview needs
        // beyond that belongs to the project, so the form does not ask.
        expect(screen.queryByText(/Let's Encrypt/)).not.toBeInTheDocument()
        expect(screen.queryByPlaceholderText('DATABASE_URL=postgres://…')).not.toBeInTheDocument()

        // The app name is left empty: it comes from the project being
        // deployed, and the form says what the address will look like.
        expect(screen.getByText('A branch is served at reponame-my-branch.dokku.example.com')).toBeInTheDocument()

        userEvent.click(screen.getByRole('button', {name: 'Save'}))
        await waitFor(() => expect(bindings.AddDeployTarget).toHaveBeenCalled())
        const sent = JSON.parse(bindings.AddDeployTarget.mock.calls[0][0])
        expect(sent).toMatchObject({
            name: 'preview',
            sshHost: 'dokku.example.com',
        })

        // Neither the app name nor the domain is typed: one comes from the
        // project, the other from the host itself.
        expect(sent.baseApp).toBeFalsy()
        expect(sent.baseDomain).toBeFalsy()
    })

    test('editing keeps the name and sends the whole entry back', async () => {
        const bindings = {
            ListDeployTargets: vi.fn().mockResolvedValue(JSON.stringify([
                {name: 'staging', sshHost: 'dokku.example.com', baseApp: 'api', baseDomain: 'preview.example.com'},
            ])),
            AddDeployTarget: vi.fn(),
            UpdateDeployTarget: vi.fn().mockResolvedValue('{}'),
            RemoveDeployTarget: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <DeployTargetsPanel onClose={vi.fn()}/>))
        await waitFor(() => expect(screen.getByText('staging')).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Edit'}))
        await waitFor(() => expect(screen.getByDisplayValue('staging')).toBeDisabled())

        userEvent.click(screen.getByRole('button', {name: 'Save'}))
        await waitFor(() => expect(bindings.UpdateDeployTarget).toHaveBeenCalled())
        expect(JSON.parse(bindings.UpdateDeployTarget.mock.calls[0][0])).toMatchObject({
            name: 'staging',
            baseApp: 'api',
            baseDomain: 'preview.example.com',
        })
        expect(bindings.AddDeployTarget).not.toHaveBeenCalled()
    })

    test('shows the backend validation error', async () => {
        const bindings = {
            ListDeployTargets: vi.fn().mockResolvedValue('[]'),
            AddDeployTarget: vi.fn().mockRejectedValue(new Error('не задан адрес Dokku-хоста')),
            UpdateDeployTarget: vi.fn(),
            RemoveDeployTarget: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <DeployTargetsPanel onClose={vi.fn()}/>))
        await waitFor(() => expect(screen.getByText('No deploy targets yet.')).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Add target…'}))
        await waitFor(() => expect(screen.getByRole('button', {name: 'Save'})).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Save'}))

        await waitFor(() => expect(screen.getByText(/не задан адрес Dokku-хоста/)).toBeInTheDocument())
    })
})
