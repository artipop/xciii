// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'

import PlanningDialog, {isPlanningAvailable} from './planningDialog'

const anyWindow = window as any

function planningBindings() {
    return {
        ListAgentRepos: jest.fn().mockResolvedValue(JSON.stringify([{name: 'app', path: '/src/app'}])),
        ListAgents: jest.fn().mockResolvedValue(JSON.stringify([{name: 'planner', kind: 'claude'}])),
        OpenPlanningTerminal: jest.fn().mockResolvedValue(JSON.stringify({
            id: 'term-1', url: 'http://127.0.0.1:1234/acp/terminal/term-1', windowed: true,
        })),
        ListTerminals: jest.fn().mockResolvedValue('[]'),
        ShowTerminal: jest.fn().mockResolvedValue(JSON.stringify({id: 'term-9', windowed: true})),
    }
}

describe('components/acp/planningDialog', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        delete anyWindow.go
    })

    it('is inert without desktop bindings', () => {
        expect(isPlanningAvailable()).toBe(false)
    })

    it('preselects the one repository and agent, then opens a terminal', async () => {
        const bindings = planningBindings()
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =><PlanningDialog onClose={jest.fn()}/>))

        // One of a kind needs no choosing, so the button is live at once.
        const open = await screen.findByText('Open a terminal')
        await waitFor(() => expect(open.closest('button')).not.toBeDisabled())
        await userEvent.click(open)

        await waitFor(() => expect(bindings.OpenPlanningTerminal).toHaveBeenCalledWith('app', 'planner'))

        // The desktop opened the window itself; nothing else should be needed.
        expect(bindings.ListTerminals).toHaveBeenCalled()
    })

    // A terminal outlives its window, and a planning one has no card behind it:
    // the dialog is the only place it can be found again.
    it('offers back a terminal that is still running', async () => {
        const bindings = planningBindings()
        bindings.ListTerminals = jest.fn().mockResolvedValue(JSON.stringify([
            {id: 'term-9', agent: 'planner', cwd: '/src/app', running: true},
        ]))
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =><PlanningDialog onClose={jest.fn()}/>))

        const running = await screen.findByText('planner · app')
        await userEvent.click(running)
        await waitFor(() => expect(bindings.ShowTerminal).toHaveBeenCalledWith('term-9'))
    })

    it('says what went wrong instead of failing silently', async () => {
        const bindings = planningBindings()
        bindings.OpenPlanningTerminal = jest.fn().mockRejectedValue(new Error('CLI агента не установлен'))
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =><PlanningDialog onClose={jest.fn()}/>))

        const open = await screen.findByText('Open a terminal')
        await waitFor(() => expect(open.closest('button')).not.toBeDisabled())
        await userEvent.click(open)

        expect(await screen.findByText(/CLI агента не установлен/)).toBeInTheDocument()
    })
})
