import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'
import {TestBlockFactory} from '../../test/testBlockFactory'

import CardTerminal from './cardTerminal'

// The panel is the terminal page plus the frame around it. What the page draws
// — xterm on a socket — is terminalPage's own test; here it only has to be the
// thing that appears, for the terminal it was given.
vi.mock('./terminalPage', () => ({
    default: (props: {terminalId?: string}) => <div data-testid='terminal'>{props.terminalId}</div>,
}))

const anyWindow = window as any
const board = TestBlockFactory.createBoard()

function stubBindings(overrides: Record<string, unknown> = {}) {
    const bindings = {
        OpenCardTerminal: vi.fn().mockResolvedValue(JSON.stringify({id: 'term-1'})),
        GetCardAgent: vi.fn().mockResolvedValue('{}'),
        ...overrides,
    }
    anyWindow.go = {main: {App: bindings}}
    return bindings
}

describe('components/acp/cardTerminal', () => {
    afterEach(() => {
        delete anyWindow.go
        vi.clearAllMocks()
    })

    it('opens the current conversation as the panel opens', async () => {
        // The card resolves a folder, so there is nothing to ask.
        stubBindings({
            GetCardAgent: vi.fn().mockResolvedValue(JSON.stringify({folder: '/tmp/proj'})),
        })
        render(() => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>))
        expect(await screen.findByTestId('terminal')).toHaveTextContent('term-1')
    })

    // A card travels its route, and each stage is its own conversation: the
    // panel names the stage it opened and lists the others as history. Chips,
    // not buttons — a passed stage's conversation reopens only when the card
    // comes back, and only Go knows that rule.
    it('names the stage and lists the passed ones as history', async () => {
        stubBindings({
            GetCardAgent: vi.fn().mockResolvedValue(JSON.stringify({
                conversations: [
                    {nodeId: 'review', column: 'Ревью', agent: 'клаус', current: true},
                    {nodeId: 'work', column: 'В работе', agent: 'кодекс', current: false},
                ],
            })),
        })
        render(() => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>))

        await waitFor(() => expect(screen.getByText('· Ревью', {exact: false})).toBeInTheDocument())
        const passed = screen.getByText('В работе', {exact: false})
        expect(passed).toBeInTheDocument()
        expect(passed.closest('.CardTerminal__stageChip')).not.toBeNull()
        expect(passed.closest('button')).toBeNull()
    })

    // Go could not resolve the agent: the one moment the pick is a real
    // question — a card before any work, with nobody assigned. Choosing here
    // starts the conversation and assigns nobody: planning in place, not an
    // assignment.
    it('offers the pick when Go refuses, and starts with the choice', async () => {
        const open = vi.fn().
            mockRejectedValueOnce(new Error('нет ни одного агента')).
            mockResolvedValue(JSON.stringify({id: 'term-9'}))
        stubBindings({
            GetCardAgent: vi.fn().mockResolvedValue(JSON.stringify({folder: '/tmp/app'})),
            OpenCardTerminal: open,
            ListAgentProjects: vi.fn().mockResolvedValue(JSON.stringify([{name: 'app'}])),
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'клаус'}, {name: 'кодекс'}])),
        })
        render(() => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>))

        // Two agents need choosing. The folder is known, so the agent is the
        // whole question — the names are the answers, no folder buttons. The
        // headline is the ask, not the machinery's own words — those are the
        // small print under the form.
        expect(await screen.findByText('Choosing an agent')).toBeInTheDocument()
        expect(screen.getByRole('button', {name: 'кодекс'})).toBeInTheDocument()
        expect(screen.queryByRole('button', {name: 'The board’s drafts'})).toBeNull()
        const reason = screen.getByText(/нет ни одного агента/)
        expect(reason.className).toContain('CardTerminal__reason')

        // A click on the name is the answer, and — the folder being known —
        // the start.
        await userEvent.click(screen.getByRole('button', {name: 'клаус'}))

        await waitFor(() => expect(open).toHaveBeenLastCalledWith('card-1', '', 'клаус', false))
        expect(await screen.findByTestId('terminal')).toHaveTextContent('term-9')
    })

    // With no folder and several agents, the questions come one at a time and
    // in the order they are answered: who first, where second — the folder
    // question is not interrupted by the agent's.
    it('asks who first and where second', async () => {
        const open = vi.fn().mockResolvedValue(JSON.stringify({id: 'term-5'}))
        stubBindings({
            OpenCardTerminal: open,
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'клаус'}, {name: 'кодекс'}])),
        })
        render(() => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>))

        // Who — and nothing about folders on screen yet.
        expect(await screen.findByText('Choosing an agent')).toBeInTheDocument()
        expect(screen.queryByText('Which folder will the agent work in?')).toBeNull()

        await userEvent.click(screen.getByRole('button', {name: 'клаус'}))

        // Where — with the answered name kept in sight as the way back.
        expect(await screen.findByText('Which folder will the agent work in?')).toBeInTheDocument()
        expect(screen.queryByText('Choosing an agent')).toBeNull()
        await userEvent.click(screen.getByRole('button', {name: 'клаус'}))
        expect(await screen.findByText('Choosing an agent')).toBeInTheDocument()
    })

    // A card that resolves no folder is not started anywhere behind the
    // person's back: the dialog asks first, and the board's drafts folder is one
    // of the answers.
    it('asks before starting when the card resolves no folder', async () => {
        const open = vi.fn().mockResolvedValue(JSON.stringify({id: 'term-8'}))
        stubBindings({
            OpenCardTerminal: open,
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'клаус'}])),
        })
        render(() => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>))

        await screen.findByText('Which folder will the agent work in?')

        // Nothing was started to get here.
        expect(open).not.toHaveBeenCalled()
    })

    // Every answer to the folder question is a chip, the board's own drafts
    // folder among them — and clicking one is what starts the conversation.
    it('offers the board’s folders as chips, the drafts folder among them', async () => {
        const open = vi.fn().mockResolvedValue(JSON.stringify({id: 'term-7'}))
        stubBindings({
            OpenCardTerminal: open,
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'клаус'}])),
            ListAgentProjects: vi.fn().mockResolvedValue(JSON.stringify([{name: 'app'}])),
        })
        render(() => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>))

        // The single agent filled itself in; the note says what the drafts
        // folder is before anything runs.
        const drafts = await screen.findByRole('button', {name: 'The board’s drafts'})
        expect(await screen.findByRole('button', {name: 'app'})).toBeInTheDocument()
        expect(screen.getByText(/The board’s drafts is the board’s own folder/)).toBeInTheDocument()

        await userEvent.click(drafts)
        await waitFor(() => expect(open).toHaveBeenLastCalledWith('card-1', '', 'клаус', false))
    })

    // A folder of the board's is an answer by name, and the conversation starts
    // in it.
    it('starts in a folder of the board’s', async () => {
        const open = vi.fn().mockResolvedValue(JSON.stringify({id: 'term-4'}))
        stubBindings({
            OpenCardTerminal: open,
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'клаус'}])),
            ListAgentProjects: vi.fn().mockResolvedValue(JSON.stringify([{name: 'app'}])),
        })
        render(() => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>))

        await userEvent.click(await screen.findByRole('button', {name: 'app'}))
        await waitFor(() => expect(open).toHaveBeenLastCalledWith('card-1', 'app', 'клаус', false))
    })

    // «Добавить папку…» is the escape hatch, in the same shape «Добавить
    // агента…» has: the native picker registers the folder on this board and the
    // conversation starts in it, in one move.
    it('adds a folder and starts with it', async () => {
        const open = vi.fn().mockResolvedValue(JSON.stringify({id: 'term-6'}))
        const addProject = vi.fn().mockResolvedValue('')
        stubBindings({
            OpenCardTerminal: open,
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'клаус'}])),
            ListAgentProjects: vi.fn().mockResolvedValue('[]'),
            PickDirectory: vi.fn().mockResolvedValue('/home/me/proj'),
            AddAgentProject: addProject,
        })
        render(() => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>))

        await userEvent.click(await screen.findByRole('button', {name: 'Add a folder…'}))

        await waitFor(() => expect(addProject).toHaveBeenCalledWith('proj', '/home/me/proj', board.id, false))
        await waitFor(() => expect(open).toHaveBeenLastCalledWith('card-1', 'proj', 'клаус', false))
    })

    // A window onto a conversation that has not started is a window onto
    // nothing, so while the panel is asking, the header offers no window
    // button.
    it('offers the window only once the terminal is open', async () => {
        stubBindings({
            ListAgents: vi.fn().mockResolvedValue('[]'),
        })
        render(() => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>))

        await screen.findByText('Choosing an agent')
        expect(screen.queryByRole('button', {name: 'Open in a separate window'})).toBeNull()
    })

    // «На весь экран» is a handover, not a copy: two views of one pty fight
    // over its size, so opening the window closes the panel.
    it('hands the conversation to the window and closes the panel', async () => {
        const onClose = vi.fn()
        stubBindings({
            GetCardAgent: vi.fn().mockResolvedValue(JSON.stringify({folder: '/tmp/proj'})),
            OpenCardTerminal: vi.fn().mockResolvedValue(JSON.stringify({id: 'term-1', windowed: true})),
        })
        render(() => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={onClose}/>))
        await screen.findByTestId('terminal')

        await userEvent.click(screen.getByRole('button', {name: 'Open in a separate window'}))
        await waitFor(() => expect(onClose).toHaveBeenCalled())
    })

    // One conversation on a card with no route is the whole story: a row of
    // chips about itself would be noise.
    it('draws no stage chips for a card outside any route', async () => {
        stubBindings({
            GetCardAgent: vi.fn().mockResolvedValue(JSON.stringify({
                conversations: [{nodeId: '', agent: 'клаус', current: true}],
            })),
        })
        const {container} = render(() => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>))

        await waitFor(() => expect(screen.getByTestId('terminal')).toBeInTheDocument())
        expect(container.querySelector('.CardTerminal__stages')).toBeNull()
    })
})
