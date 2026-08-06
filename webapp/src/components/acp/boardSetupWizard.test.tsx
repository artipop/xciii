// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {Board} from '../../blocks/board'
import {TestBlockFactory} from '../../test/testBlockFactory'
import {wrapIntl} from '../../testUtils'

import {SetupPlan, SetupStep, SetupStepKind} from './boardSetup'

import BoardSetupWizard, {readRegistry} from './boardSetupWizard'

const anyWindow = window as any

// One board for the whole file: its id is what the wizard reports a skip
// under, so a fresh one per call would compare against somebody else's.
const testBoard: Board = TestBlockFactory.createBoard()

// A plan is what Go answers with; the wizard's whole shape comes from it.
function plan(kinds: Array<SetupStepKind | Partial<SetupStep>>, extra: Partial<SetupPlan> = {}): string {
    const steps = kinds.map((kind) => {
        if (typeof kind === 'string') {
            return {kind, optional: kind === 'deploy' || kind === 'browser', status: 'pending'}
        }
        return {kind: 'project', optional: false, status: 'pending', ...kind}
    })
    return JSON.stringify({boardId: testBoard.id, steps, declared: true, automated: true, ...extra})
}

// The developer board: it publishes and it tests, so it is asked everything.
const FULL_PLAN = plan(['project', 'agent', 'deploy', 'browser', 'done'])

// A board of household chores: an agent and nothing else.
const CHORES_PLAN = plan(
    [{kind: 'project', hint: 'Папка с домашними заметками'}, {kind: 'agent'}, {kind: 'done'}],
    {agentColumn: 'Агент готовит'},
)

function stubBindings(overrides: Record<string, unknown> = {}) {
    const bindings = {
        BoardSetupPlan: vi.fn().mockResolvedValue(FULL_PLAN),
        RecordBoardSetupStep: vi.fn().mockResolvedValue(undefined),
        CheckBoardSetupAnswer: vi.fn().mockResolvedValue(undefined),
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

describe('components/acp/boardSetupWizard', () => {
    afterEach(() => {
        delete anyWindow.go
        localStorage.clear()
        vi.clearAllMocks()
    })

    const renderWizard = (onClose = vi.fn()) => render(() => wrapIntl(() =>
        <BoardSetupWizard
            board={testBoard}
            onClose={onClose}
        />,
    ))

    test('outside the desktop app there is no registry to read', async () => {
        expect(await readRegistry()).toBeNull()
    })

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
        const bindings = stubBindings({AddAgentProject: vi.fn().mockRejectedValue('/Users/me/src не является git-проектом')})
        renderWizard()
        await waitFor(() => expect(bindings.ListAgentProjects).toHaveBeenCalled())

        userEvent.click(screen.getByRole('button', {name: 'Choose a folder…'}))
        await waitFor(() => expect(screen.getByDisplayValue('webapp')).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Next'}))

        await waitFor(() => expect(screen.getByText(/не является git-проектом/)).toBeInTheDocument())

        // And it stays on the step, rather than walking on past the problem.
        expect(screen.getByRole('button', {name: 'Choose a folder…'})).toBeInTheDocument()
    })

    test('an agent is registered and made assignable', async () => {
        const bindings = stubBindings({
            ListAgentProjects: vi.fn().mockResolvedValue(JSON.stringify([{name: 'webapp', path: '/src'}])),
            BoardSetupPlan: vi.fn().mockResolvedValue(
                plan([{kind: 'project', status: 'done'}, {kind: 'agent'}, {kind: 'done'}]),
            ),
        })
        renderWizard()

        // The project is answered, so the wizard opens on the question that is not.
        await waitFor(() => expect(screen.getByText('Kind')).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Next'}))
        await waitFor(() => expect(bindings.AddAgent).toHaveBeenCalled())
        expect(JSON.parse(bindings.AddAgent.mock.calls[0][0])).toEqual({name: 'claude', kind: 'claude'})
        expect(bindings.SyncAgentUsers).toHaveBeenCalled()
    })

    test('deploy and testing are skippable, and skipping is remembered', async () => {
        const bindings = stubBindings({
            ListAgentProjects: vi.fn().mockResolvedValue(JSON.stringify([{name: 'webapp', path: '/src'}])),
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'claude'}])),
            BoardSetupPlan: vi.fn().mockResolvedValue(plan([
                {kind: 'project', status: 'done'},
                {kind: 'agent', status: 'done'},
                {kind: 'deploy', optional: true},
                {kind: 'browser', optional: true},
                {kind: 'done'},
            ])),
        })
        const onClose = vi.fn()
        renderWizard(onClose)

        await waitFor(() => expect(screen.getByText('Dokku host')).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Skip'}))
        await waitFor(() => expect(screen.getByText(/browser MCP server/)).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Skip'}))

        await waitFor(() => expect(screen.getByRole('button', {name: 'Done'})).toBeInTheDocument())
        expect(bindings.AddDeployTarget).not.toHaveBeenCalled()
        expect(bindings.UpdateAgent).not.toHaveBeenCalled()

        // A skip is the one answer no registry can be read for later, so it is
        // the one the app has to remember.
        expect(bindings.RecordBoardSetupStep).toHaveBeenCalledWith(testBoard.id, 'deploy', 'skipped')
        expect(bindings.RecordBoardSetupStep).toHaveBeenCalledWith(testBoard.id, 'browser', 'skipped')

        userEvent.click(screen.getByRole('button', {name: 'Done'}))
        await waitFor(() => expect(bindings.SeedBoardAutomation).toHaveBeenCalled())
        expect(onClose).toHaveBeenCalled()
    })

    test('a board is asked only what it asked to be asked', async () => {
        const bindings = stubBindings({
            ListAgentProjects: vi.fn().mockResolvedValue(JSON.stringify([{name: 'notes', path: '/src'}])),
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'claude'}])),
            BoardSetupPlan: vi.fn().mockResolvedValue(CHORES_PLAN),
        })
        renderWizard()

        // The board's own sentence about the step it asks for is shown, and it
        // is also what says the plan has arrived.
        await waitFor(() => expect(screen.getByText('Папка с домашними заметками')).toBeInTheDocument())

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

    // Git is asked for by what the board does, and the answer is checked where
    // it is given: a folder that will not do must not be filed and found out
    // about later, on a card, when a deploy fails.
    test('a board that needs git says so, and refuses a folder without it', async () => {
        const bindings = stubBindings({
            BoardSetupPlan: vi.fn().mockResolvedValue(
                plan([{kind: 'project', requires: ['git']}, {kind: 'agent'}, {kind: 'done'}]),
            ),
            CheckBoardSetupAnswer: vi.fn().mockRejectedValue('в каталоге /Users/me/src/webapp нет git-репозитория, а этой доске он нужен'),
        })
        renderWizard()
        await waitFor(() => expect(screen.getByText(/has to be under git/)).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Choose a folder…'}))
        await waitFor(() => expect(screen.getByDisplayValue('webapp')).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Next'}))

        await waitFor(() => expect(screen.getByText(/нет git-репозитория/)).toBeInTheDocument())
        expect(bindings.AddAgentProject).not.toHaveBeenCalled()
    })

    // …and a board of personal tasks is never told about git at all.
    test('a board that does not need git never mentions it', async () => {
        stubBindings({BoardSetupPlan: vi.fn().mockResolvedValue(CHORES_PLAN)})
        renderWizard()
        await waitFor(() => expect(screen.getByText('Папка с домашними заметками')).toBeInTheDocument())
        expect(screen.queryByText(/has to be under git/)).toBeNull()
    })

    test('the browser server is offered ready to accept', async () => {
        const bindings = stubBindings({
            ListAgentProjects: vi.fn().mockResolvedValue(JSON.stringify([{name: 'webapp', path: '/src'}])),
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'claude'}])),
            BoardSetupPlan: vi.fn().mockResolvedValue(plan([
                {kind: 'project', status: 'done'},
                {kind: 'agent', status: 'done'},
                {kind: 'browser', optional: true},
                {kind: 'done'},
            ])),
        })
        renderWizard()

        await waitFor(() => expect(screen.getByText(/browser MCP server/)).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Save'}))
        await waitFor(() => expect(bindings.UpdateAgent).toHaveBeenCalled())

        const saved = JSON.parse(bindings.UpdateAgent.mock.calls[0][0])
        expect(saved.name).toBe('claude')
        expect(saved.mcpServers.playwright.command).toBe('npx')
    })
})
