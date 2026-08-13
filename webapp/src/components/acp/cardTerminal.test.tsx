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
        // whole question — no folder buttons. The headline is the ask, not
        // the machinery's own words — those are the small print under the
        // form.
        expect(await screen.findByText('Choose an agent…')).toBeInTheDocument()
        expect(screen.getByText('Who talks here? Pick an agent.')).toBeInTheDocument()
        expect(screen.queryByRole('button', {name: 'Use the board’s folder'})).toBeNull()
        const reason = screen.getByText(/нет ни одного агента/)
        expect(reason.className).toContain('CardTerminal__reason')

        await userEvent.click(screen.getByText('Choose an agent…'))
        await userEvent.click(await screen.findByText('клаус'))
        await userEvent.click(screen.getByRole('button', {name: 'Start the conversation'}))

        await waitFor(() => expect(open).toHaveBeenLastCalledWith('card-1', '', 'клаус', false))
        expect(await screen.findByTestId('terminal')).toHaveTextContent('term-9')
    })

    // A card that resolves no folder is not started anywhere behind the
    // person's back: the dialog asks first, and the board's folder is one of
    // its two answers.
    it('asks before starting when the card resolves no folder', async () => {
        const open = vi.fn().mockResolvedValue(JSON.stringify({id: 'term-8'}))
        stubBindings({
            OpenCardTerminal: open,
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'клаус'}])),
        })
        render(() => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>))

        await screen.findByText('The agent needs a folder to work in.')

        // Nothing was started to get here.
        expect(open).not.toHaveBeenCalled()
    })

    // «Использовать папку доски» is the dialog's first answer: the board's
    // own directory under the app's data, called that on every surface — and
    // choosing it is what starts the conversation.
    it('starts in the board’s folder on the first answer', async () => {
        const open = vi.fn().mockResolvedValue(JSON.stringify({id: 'term-7'}))
        stubBindings({
            OpenCardTerminal: open,
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'клаус'}])),
        })
        render(() => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>))

        // The single agent filled itself in; the note says what the board's
        // folder is before anything runs.
        const useBoard = await screen.findByRole('button', {name: 'Use the board’s folder'})
        expect(screen.getByText(/The board’s folder is where its agents keep/)).toBeInTheDocument()
        expect(useBoard).toBeEnabled()

        await userEvent.click(useBoard)
        await waitFor(() => expect(open).toHaveBeenLastCalledWith('card-1', '', 'клаус', false))
    })

    // The second answer: a real folder, picked natively — registered to the
    // board and started with, in one move.
    it('picks a folder and starts with it', async () => {
        const open = vi.fn().mockResolvedValue(JSON.stringify({id: 'term-6'}))
        const addProject = vi.fn().mockResolvedValue('')
        stubBindings({
            OpenCardTerminal: open,
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'клаус'}])),
            PickDirectory: vi.fn().mockResolvedValue('/home/me/proj'),
            AddAgentProject: addProject,
        })
        render(() => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>))

        await userEvent.click(await screen.findByRole('button', {name: 'Choose a folder…'}))

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

        await screen.findByText('The agent needs a folder to work in.')
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
