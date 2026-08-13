import {fireEvent, render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {Board} from '../../blocks/board'
import {TestBlockFactory} from '../../test/testBlockFactory'
import {wrapIntl} from '../../testUtils'

import mutator from '../../mutator'

import {SetupPlan, SetupStep, SetupStepKind} from './boardSetup'

import BoardSetupWizard, {readRegistry} from './boardSetupWizard'

vi.mock('../../mutator')
const mockedMutator = vi.mocked(mutator)

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
        ListAgentWorkdirs: vi.fn().mockResolvedValue('[]'),
        ListAgents: vi.fn().mockResolvedValue('[]'),
        PickDirectory: vi.fn().mockResolvedValue('/Users/me/src/webapp'),
        ListAgentAdapters: vi.fn().mockResolvedValue('[]'),
        AddAgentWorkdir: vi.fn().mockResolvedValue('{}'),
        AddAgent: vi.fn().mockResolvedValue('{}'),
        UpdateAgent: vi.fn().mockResolvedValue('{}'),
        SetBoardTestAgent: vi.fn().mockResolvedValue(undefined),
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
        // The registry answers empty until the folder is added, and with it
        // afterwards — which is what the wizard reads back to put it on the
        // board's own field.
        const bindings = stubBindings({
            ListAgentWorkdirs: vi.fn().
                mockResolvedValueOnce('[]').
                mockResolvedValue(JSON.stringify([{name: 'webapp', path: '/Users/me/src/webapp'}])),
        })
        renderWizard()
        await waitFor(() => expect(bindings.ListAgentWorkdirs).toHaveBeenCalled())

        expect(screen.getByRole('button', {name: 'Next'})).toBeDisabled()

        userEvent.click(screen.getByRole('button', {name: 'Choose a folder…'}))
        await waitFor(() => expect(screen.getByDisplayValue('webapp')).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Next'}))

        // Filed against the board being set up: the wizard is that board's.
        await waitFor(() => expect(bindings.AddAgentWorkdir).toHaveBeenCalledWith('webapp', '/Users/me/src/webapp', testBoard.id, '', false))

        // And onto the board's own field, or the person who has just answered
        // "which folder" has nothing to pick on the card: a card names its
        // folder with an option of that field and with nothing else.
        await waitFor(() => expect(mockedMutator.updateBoardCardProperties).toHaveBeenCalled())
        const added = mockedMutator.updateBoardCardProperties.mock.calls[0][2].
            flatMap((p: {options?: Array<{value: string}>}) => p.options || []).
            map((o: {value: string}) => o.value)
        expect(added).toContain('webapp')

        // And having added it, the wizard is on the agent step.
        await waitFor(() => expect(screen.getByText('Kind')).toBeInTheDocument())
    })

    // The name is filled in from the folder, so changing the folder has to
    // refill it: a second choice registered under the first one's name is a
    // folder nobody can find by what it is called.
    test('picking another folder renames it with it, unless the name was typed', async () => {
        const bindings = stubBindings({
            PickDirectory: vi.fn().
                mockResolvedValueOnce('/Users/me/src/webapp').
                mockResolvedValueOnce('/Users/me/src/server').
                mockResolvedValue('/Users/me/src/mobile'),
        })
        renderWizard()
        await waitFor(() => expect(bindings.ListAgentWorkdirs).toHaveBeenCalled())

        userEvent.click(screen.getByRole('button', {name: 'Choose a folder…'}))
        await waitFor(() => expect(screen.getByDisplayValue('webapp')).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Choose a folder…'}))
        await waitFor(() => expect(screen.getByDisplayValue('server')).toBeInTheDocument())

        // A name somebody typed is theirs and survives the next pick.
        fireEvent.input(screen.getByDisplayValue('server'), {target: {value: 'мой сервер'}})
        userEvent.click(screen.getByRole('button', {name: 'Choose a folder…'}))
        await waitFor(() => expect(screen.getByDisplayValue('мой сервер')).toBeInTheDocument())
    })

    test('a refusal from Go is shown rather than swallowed', async () => {
        const bindings = stubBindings({AddAgentWorkdir: vi.fn().mockRejectedValue('/Users/me/src не является git-проектом')})
        renderWizard()
        await waitFor(() => expect(bindings.ListAgentWorkdirs).toHaveBeenCalled())

        userEvent.click(screen.getByRole('button', {name: 'Choose a folder…'}))
        await waitFor(() => expect(screen.getByDisplayValue('webapp')).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Next'}))

        await waitFor(() => expect(screen.getByText(/не является git-проектом/)).toBeInTheDocument())

        // And it stays on the step, rather than walking on past the problem.
        expect(screen.getByRole('button', {name: 'Choose a folder…'})).toBeInTheDocument()
    })

    test('an agent is registered and made assignable', async () => {
        const bindings = stubBindings({
            ListAgentWorkdirs: vi.fn().mockResolvedValue(JSON.stringify([{name: 'webapp', path: '/src'}])),
            BoardSetupPlan: vi.fn().mockResolvedValue(
                plan([{kind: 'project', status: 'done'}, {kind: 'agent'}, {kind: 'done'}]),
            ),
        })

        // Registered, so the registry has it from then on — which is what makes
        // it assignable on the board.
        bindings.AddAgent.mockImplementation(async () => {
            bindings.ListAgents.mockResolvedValue(JSON.stringify([{name: 'claude', kind: 'claude'}]))
            return '{}'
        })
        renderWizard()

        // The project is answered, so the wizard opens on the question that is
        // not — asked by the same short form a card offers.
        await waitFor(() => expect(screen.getByText('Kind')).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Add'}))
        await waitFor(() => expect(bindings.AddAgent).toHaveBeenCalled())
        expect(JSON.parse(bindings.AddAgent.mock.calls[0][0])).toEqual({name: 'claude', kind: 'claude'})
        await waitFor(() => expect(bindings.SyncAgentUsers).toHaveBeenCalledWith(testBoard.id))
        await waitFor(() => expect(bindings.RecordBoardSetupStep).toHaveBeenCalledWith(testBoard.id, 'agent', 'done'))
    })

    // The machine being configured is not this board being set up: passing a
    // step because a project is already registered still answers it, for this
    // board, or the second board you make is created in silence.
    test('a step passed because the machine already has one is answered too', async () => {
        const bindings = stubBindings({
            ListAgentWorkdirs: vi.fn().mockResolvedValue(JSON.stringify([{name: 'webapp', path: '/src'}])),
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'claude'}])),
            BoardSetupPlan: vi.fn().mockResolvedValue(plan([
                {kind: 'project', ready: true},
                {kind: 'agent', ready: true},
                {kind: 'done'},
            ])),
        })
        renderWizard()
        await waitFor(() => expect(screen.getByRole('button', {name: 'Next'})).toBeEnabled())

        userEvent.click(screen.getByRole('button', {name: 'Next'}))
        await waitFor(() => expect(bindings.RecordBoardSetupStep).toHaveBeenCalledWith(testBoard.id, 'project', 'done'))
        expect(bindings.AddAgentWorkdir).not.toHaveBeenCalled()

        // The machine already has an agent, so the step says so and offers Next
        // rather than a form. ("claude" is the agent; the project is "webapp".)
        await waitFor(() => expect(screen.getByText('Already registered: claude')).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Next'}))
        await waitFor(() => expect(bindings.RecordBoardSetupStep).toHaveBeenCalledWith(testBoard.id, 'agent', 'done'))
        expect(bindings.AddAgent).not.toHaveBeenCalled()
    })

    // The step that says «Уже добавлены: …» is also the step to add another
    // one on: a board is worked by a crew often enough, and the alternative was
    // an errand to the settings for the one thing this screen is about.
    test('another agent can be added on a step that already has one', async () => {
        const bindings = stubBindings({
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'клаус'}])),
            BoardSetupPlan: vi.fn().mockResolvedValue(plan([{kind: 'agent', ready: true}, {kind: 'done'}])),
        })
        bindings.AddAgent.mockImplementation(async () => {
            bindings.ListAgents.mockResolvedValue(JSON.stringify([{name: 'клаус'}, {name: 'тестер'}]))
            return '{}'
        })
        renderWizard()

        await waitFor(() => expect(screen.getByText('Already registered: клаус')).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Add an agent…'}))
        await waitFor(() => expect(screen.getByText('Kind')).toBeInTheDocument())
        await userEvent.clear(screen.getByDisplayValue('claude'))
        await userEvent.type(screen.getByRole('textbox'), 'тестер')
        userEvent.click(screen.getByRole('button', {name: 'Add'}))

        await waitFor(() => expect(screen.getByText('Already registered: клаус, тестер')).toBeInTheDocument())

        // Adding one is not answering the step: «Next» is what moves on, so a
        // second agent can be added straight after the first.
        expect(bindings.RecordBoardSetupStep).not.toHaveBeenCalledWith(testBoard.id, 'agent', 'done')
        expect(screen.getByRole('button', {name: 'Next'})).toBeInTheDocument()
    })

    test('deploy and testing are skippable, and skipping is remembered', async () => {
        const bindings = stubBindings({
            ListAgentWorkdirs: vi.fn().mockResolvedValue(JSON.stringify([{name: 'webapp', path: '/src'}])),
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
        expect(bindings.SetBoardTestAgent).not.toHaveBeenCalled()

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
            ListAgentWorkdirs: vi.fn().mockResolvedValue(JSON.stringify([{name: 'notes', path: '/src'}])),
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
        await waitFor(() => expect(bindings.RecordBoardSetupStep).toHaveBeenCalledWith(testBoard.id, 'project', 'done'))

        // The machine already has an agent, so this step says so rather than
        // asking again. ("claude" is the agent; the project is "notes".)
        await waitFor(() => expect(screen.getByText('Already registered: claude')).toBeInTheDocument())
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
        await waitFor(() => expect(screen.getByText(/has to be a git repository/)).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Choose a folder…'}))
        await waitFor(() => expect(screen.getByDisplayValue('webapp')).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Next'}))

        await waitFor(() => expect(screen.getByText(/нет git-репозитория/)).toBeInTheDocument())
        expect(bindings.AddAgentWorkdir).not.toHaveBeenCalled()
    })

    // …and a board of personal tasks is never told about git at all.
    test('a board that does not need git never mentions it', async () => {
        stubBindings({BoardSetupPlan: vi.fn().mockResolvedValue(CHORES_PLAN)})
        renderWizard()
        await waitFor(() => expect(screen.getByText('Папка с домашними заметками')).toBeInTheDocument())
        expect(screen.queryByText(/has to be a git repository/)).toBeNull()
    })

    // The QA step is one answer with two halves: the browser goes to an agent,
    // and that agent works the column that tests. A single registered agent
    // answers "who" without being asked.
    test('the browser server is offered ready to accept', async () => {
        const bindings = stubBindings({
            ListAgentWorkdirs: vi.fn().mockResolvedValue(JSON.stringify([{name: 'webapp', path: '/src'}])),
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'claude'}])),
            BoardSetupPlan: vi.fn().mockResolvedValue(plan([
                {kind: 'project', status: 'done'},
                {kind: 'agent', status: 'done'},
                {kind: 'browser', optional: true},
                {kind: 'done'},
            ], {testColumn: 'QA'})),
        })
        renderWizard()

        await waitFor(() => expect(screen.getByText(/browser MCP server/)).toBeInTheDocument())

        // The question says which column the answer crews, by the board's own
        // name for it.
        expect(screen.getByText(/“QA”/)).toBeInTheDocument()

        userEvent.click(screen.getByRole('button', {name: 'Save'}))
        await waitFor(() => expect(bindings.SetBoardTestAgent).toHaveBeenCalled())

        const [boardId, agentName, serversJson] = bindings.SetBoardTestAgent.mock.calls[0]
        expect(boardId).toBe(testBoard.id)
        expect(agentName).toBe('claude')
        expect(JSON.parse(serversJson).playwright.command).toBe('npx')
    })

    // Several agents is a question, and it is the one a card asks: the names as
    // chips, the answer a click. Taking the first of them is what this
    // replaces — the browser then sat on an agent the QA column never ran.
    test('the agent that tests is chosen from the registry, not guessed', async () => {
        const bindings = stubBindings({
            ListAgentWorkdirs: vi.fn().mockResolvedValue(JSON.stringify([{name: 'webapp', path: '/src'}])),
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'клаус'}, {name: 'тестер'}])),
            BoardSetupPlan: vi.fn().mockResolvedValue(plan([
                {kind: 'browser', optional: true},
                {kind: 'done'},
            ], {testColumn: 'QA'})),
        })
        renderWizard()

        await waitFor(() => expect(screen.getByRole('button', {name: 'тестер'})).toBeInTheDocument())

        // Nobody is chosen yet, so there is nothing to save.
        expect(screen.getByRole('button', {name: 'Save'})).toBeDisabled()

        userEvent.click(screen.getByRole('button', {name: 'тестер'}))
        await waitFor(() => expect(screen.getByRole('button', {name: 'Save'})).toBeEnabled())
        userEvent.click(screen.getByRole('button', {name: 'Save'}))

        await waitFor(() => expect(bindings.SetBoardTestAgent).toHaveBeenCalled())
        expect(bindings.SetBoardTestAgent.mock.calls[0][1]).toBe('тестер')
    })

    // An agent can be registered where the question is asked, exactly as on a
    // card — and registering one here is answering the question.
    test('an agent added on the QA step is the one that tests', async () => {
        const bindings = stubBindings({
            ListAgents: vi.fn().mockResolvedValue('[]'),
            BoardSetupPlan: vi.fn().mockResolvedValue(plan([{kind: 'browser', optional: true}, {kind: 'done'}])),
        })
        bindings.AddAgent.mockImplementation(async () => {
            bindings.ListAgents.mockResolvedValue(JSON.stringify([{name: 'claude'}]))
            return '{}'
        })
        renderWizard()

        await waitFor(() => expect(screen.getByText(/browser MCP server/)).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Add an agent…'}))
        await waitFor(() => expect(screen.getByText('Kind')).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Add'}))

        await waitFor(() => expect(screen.getByRole('button', {name: 'claude'})).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Save'}))
        await waitFor(() => expect(bindings.SetBoardTestAgent).toHaveBeenCalled())
        expect(bindings.SetBoardTestAgent.mock.calls[0][1]).toBe('claude')
    })

    // A source is asked for only by a board that says it wants one — no
    // arrangement of columns implies that cards should arrive by themselves —
    // and the token it hands back is readable exactly once.
    test('a board that asks for a source is given one, with its token', async () => {
        const bindings = stubBindings({
            AddSource: vi.fn().mockResolvedValue(JSON.stringify({name: 'phone', token: 'secret-token'})),
            BoardSetupPlan: vi.fn().mockResolvedValue(plan([
                {kind: 'agent', status: 'done'},
                {kind: 'source', optional: true},
                {kind: 'done'},
            ])),
        })
        renderWizard()

        await waitFor(() => expect(screen.getByText(/A source puts cards on this board/)).toBeInTheDocument())
        await userEvent.type(screen.getByPlaceholderText('phone'), 'phone')
        userEvent.click(screen.getByRole('button', {name: 'Save'}))

        await waitFor(() => expect(bindings.AddSource).toHaveBeenCalled())
        const created = JSON.parse(bindings.AddSource.mock.calls[0][0])
        expect(created.name).toBe('phone')
        expect(created.boardId).toBe(testBoard.id)
        expect(await screen.findByText('secret-token')).toBeInTheDocument()
    })

    test('a board that says nothing about sources is not asked about them', async () => {
        stubBindings({BoardSetupPlan: vi.fn().mockResolvedValue(CHORES_PLAN)})
        renderWizard()

        await waitFor(() => expect(screen.getByText(/Папка с домашними заметками/)).toBeInTheDocument())
        expect(screen.queryByText(/A source puts cards on this board/)).toBeNull()
    })
})
