// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {Board} from '../../blocks/board'
import {TestBlockFactory} from '../../test/testBlockFactory'
import {wrapIntl} from '../../testUtils'

import BoardSetupWizard, {isBoardSetupAvailable, readRegistry, rememberOffered, setupNeeded, shouldOfferSetup, stepsFor} from './boardSetupWizard'

const anyWindow = window as any

// A board made from the developer template: it runs an agent, publishes and
// tests, so every question the wizard has is one it can answer.
function templateBoard(): Board {
    const board = TestBlockFactory.createBoard()
    board.properties = {
        acpColumns: [
            {column: 'In Progress', action: 'agent'},
            {column: 'Deploy', action: 'deploy'},
            {column: 'To Test', action: 'test'},
        ],
        acpFlows: [],
    } as any
    return board
}

// A board made from one of the everyday-life templates: an agent and nothing
// else — no Dokku host to name and no browser to test with.
function choresBoard(): Board {
    const board = TestBlockFactory.createBoard()
    board.properties = {
        acpColumns: [{column: 'Агент готовит', action: 'agent'}],
        acpFlows: [],
    } as any
    return board
}

function stubBindings(overrides: Record<string, unknown> = {}) {
    const bindings = {
        ListAgentProjects: vi.fn().mockResolvedValue('[]'),
        ListAgents: vi.fn().mockResolvedValue('[]'),
        PickDirectory: vi.fn().mockResolvedValue('/Users/me/src/webapp'),
        AddAgentProject: vi.fn().mockResolvedValue('{}'),
        AddAgent: vi.fn().mockResolvedValue('{}'),
        UpdateAgent: vi.fn().mockResolvedValue('{}'),
        SyncAgentUsers: vi.fn().mockResolvedValue('[]'),
        AddDeployTarget: vi.fn().mockResolvedValue('{}'),
        SeedBoardAutomation: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    }
    anyWindow.go = {main: {App: bindings}}
    return bindings
}

describe('components/acp/boardSetupWizard when it offers itself', () => {
    afterEach(() => {
        delete anyWindow.go
        localStorage.clear()
        vi.clearAllMocks()
    })

    test('never outside the desktop app', async () => {
        expect(isBoardSetupAvailable()).toBe(false)
        expect(await readRegistry()).toBeNull()
        expect(setupNeeded(templateBoard(), {agents: [], projects: []})).toBe(false)
    })

    test('only for a board that runs something on a machine that cannot run it', () => {
        stubBindings()
        const empty = {agents: [], projects: []}
        expect(setupNeeded(templateBoard(), empty)).toBe(true)

        // A board that carries no routes has nothing to set up.
        expect(setupNeeded(TestBlockFactory.createBoard(), empty)).toBe(false)

        // And a machine that is already configured is not asked again.
        expect(setupNeeded(templateBoard(), {agents: [{name: 'claude'}], projects: [{name: 'webapp', path: '/src'}]})).toBe(false)

        // Half-configured still counts: an agent with no project cannot work.
        expect(setupNeeded(templateBoard(), {agents: [{name: 'claude'}], projects: []})).toBe(true)
    })

    // Being offered the wizard is remembered per board, so making a second
    // board still gets its own offer.
    test('it is offered once per board', () => {
        stubBindings()
        const board = templateBoard()
        const other = templateBoard()
        other.id = 'board-two'
        const empty = {agents: [], projects: []}

        expect(shouldOfferSetup(board, empty)).toBe(true)

        rememberOffered(board.id)
        expect(shouldOfferSetup(board, empty)).toBe(false)
        expect(shouldOfferSetup(other, empty)).toBe(true)
    })

    // The offer is spent, the need is not: that is what the header reminder
    // reads, and it is the whole reason the two are separate questions.
    test('a board that has had its turn still reports that it needs setting up', () => {
        stubBindings()
        const board = templateBoard()
        const empty = {agents: [], projects: []}

        rememberOffered(board.id)
        expect(shouldOfferSetup(board, empty)).toBe(false)
        expect(setupNeeded(board, empty)).toBe(true)

        // And once the machine is configured, the reminder goes too.
        expect(setupNeeded(board, {agents: [{name: 'claude'}], projects: [{name: 'webapp', path: '/src'}]})).toBe(false)
    })
})

describe('components/acp/boardSetupWizard which steps it has', () => {
    test('the board decides: nothing is asked that its automation never uses', () => {
        expect(stepsFor(templateBoard())).toEqual(['project', 'agent', 'deploy', 'browser', 'done'])
        expect(stepsFor(choresBoard())).toEqual(['project', 'agent', 'done'])

        // A board that ships no automation of its own says nothing about the
        // machine either, so nothing is ruled out for it.
        expect(stepsFor(TestBlockFactory.createBoard())).toEqual(['project', 'agent', 'deploy', 'browser', 'done'])
    })
})

describe('components/acp/boardSetupWizard steps', () => {
    afterEach(() => {
        delete anyWindow.go
        localStorage.clear()
        vi.clearAllMocks()
    })

    const renderWizard = (onClose = vi.fn(), board = templateBoard()) => render(() => wrapIntl(() =>
        <BoardSetupWizard
            board={board}
            onClose={onClose}
        />,
    ))

    test('the project step will not pass until there is one', async () => {
        const bindings = stubBindings()
        renderWizard()
        await waitFor(() => expect(bindings.ListAgentProjects).toHaveBeenCalled())

        expect(screen.getByRole('button', {name: 'Next'})).toBeDisabled()

        userEvent.click(screen.getByRole('button', {name: 'Choose a folder…'}))
        await waitFor(() => expect(screen.getByDisplayValue('webapp')).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Next'}))
        await waitFor(() => expect(bindings.AddAgentProject).toHaveBeenCalledWith('webapp', '/Users/me/src/webapp'))

        // And having added it, the wizard is on the agent step.
        await waitFor(() => expect(screen.getByText('Kind')).toBeInTheDocument())
    })

    test('a refusal from Go is shown rather than swallowed', async () => {
        const bindings = stubBindings({AddAgentProject: vi.fn().mockRejectedValue('/Users/me/src не является git-репозиторием')})
        renderWizard()
        await waitFor(() => expect(bindings.ListAgentProjects).toHaveBeenCalled())

        userEvent.click(screen.getByRole('button', {name: 'Choose a folder…'}))
        await waitFor(() => expect(screen.getByDisplayValue('webapp')).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Next'}))

        await waitFor(() => expect(screen.getByText(/не является git-репозиторием/)).toBeInTheDocument())

        // And it stays on the step, rather than walking on past the problem.
        expect(screen.getByRole('button', {name: 'Choose a folder…'})).toBeInTheDocument()
    })

    test('an agent is registered and made assignable', async () => {
        const bindings = stubBindings({ListAgentProjects: vi.fn().mockResolvedValue(JSON.stringify([{name: 'webapp', path: '/src'}]))})
        renderWizard()
        await waitFor(() => expect(screen.getByRole('button', {name: 'Next'})).toBeEnabled())

        // The project is already there, so this step is passed by moving on.
        userEvent.click(screen.getByRole('button', {name: 'Next'}))
        await waitFor(() => expect(screen.getByText('Kind')).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Next'}))
        await waitFor(() => expect(bindings.AddAgent).toHaveBeenCalled())
        expect(JSON.parse(bindings.AddAgent.mock.calls[0][0])).toEqual({name: 'claude', kind: 'claude'})
        expect(bindings.SyncAgentUsers).toHaveBeenCalled()
    })

    test('deploy and testing are skippable, and the end takes the board’s automation', async () => {
        const bindings = stubBindings({
            ListAgentProjects: vi.fn().mockResolvedValue(JSON.stringify([{name: 'webapp', path: '/src'}])),
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'claude'}])),
        })
        const onClose = vi.fn()
        renderWizard(onClose)
        await waitFor(() => expect(screen.getByRole('button', {name: 'Next'})).toBeEnabled())

        userEvent.click(screen.getByRole('button', {name: 'Next'}))
        await waitFor(() => expect(screen.getByText('Kind')).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Next'}))

        await waitFor(() => expect(screen.getByText('Dokku host')).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Skip'}))
        await waitFor(() => expect(screen.getByRole('button', {name: 'Skip'})).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Skip'}))

        await waitFor(() => expect(screen.getByRole('button', {name: 'Done'})).toBeInTheDocument())
        expect(bindings.AddDeployTarget).not.toHaveBeenCalled()
        expect(bindings.UpdateAgent).not.toHaveBeenCalled()

        userEvent.click(screen.getByRole('button', {name: 'Done'}))
        await waitFor(() => expect(bindings.SeedBoardAutomation).toHaveBeenCalled())
        expect(onClose).toHaveBeenCalled()
    })

    test('a board that only runs an agent goes straight from the agent to the end', async () => {
        const bindings = stubBindings({
            ListAgentProjects: vi.fn().mockResolvedValue(JSON.stringify([{name: 'notes', path: '/src'}])),
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'claude'}])),
        })
        renderWizard(vi.fn(), choresBoard())
        await waitFor(() => expect(screen.getByRole('button', {name: 'Next'})).toBeEnabled())

        // The two questions this board cannot answer are not even listed.
        expect(screen.queryByText('Deploy')).toBeNull()
        expect(screen.queryByText('Testing')).toBeNull()

        userEvent.click(screen.getByRole('button', {name: 'Next'}))
        await waitFor(() => expect(screen.getByText('Kind')).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Next'}))

        // Straight to the end, and the end names this board's own column.
        await waitFor(() => expect(screen.getByRole('button', {name: 'Done'})).toBeInTheDocument())
        expect(screen.getByText(/Агент готовит/)).toBeInTheDocument()
        expect(bindings.AddDeployTarget).not.toHaveBeenCalled()
    })

    test('the browser server is offered ready to accept', async () => {
        const bindings = stubBindings({
            ListAgentProjects: vi.fn().mockResolvedValue(JSON.stringify([{name: 'webapp', path: '/src'}])),
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'claude'}])),
        })
        renderWizard()
        await waitFor(() => expect(screen.getByRole('button', {name: 'Next'})).toBeEnabled())
        userEvent.click(screen.getByRole('button', {name: 'Next'}))
        await waitFor(() => expect(screen.getByText('Kind')).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Next'}))
        await waitFor(() => expect(screen.getByText('Dokku host')).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Skip'}))

        await waitFor(() => expect(screen.getByText(/browser MCP server/)).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Save'}))
        await waitFor(() => expect(bindings.UpdateAgent).toHaveBeenCalled())

        const saved = JSON.parse(bindings.UpdateAgent.mock.calls[0][0])
        expect(saved.name).toBe('claude')
        expect(saved.mcpServers.playwright.command).toBe('npx')
    })
})
