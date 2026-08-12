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
        stubBindings()
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

    // Go could not resolve the folder or the agent: the one moment the pick is
    // a real question — a card before any work, with nobody assigned. Choosing
    // here starts the conversation and assigns nobody: planning in place, not
    // an assignment.
    it('offers the pick when Go refuses, and starts with the choice', async () => {
        const open = vi.fn().
            mockRejectedValueOnce(new Error('ни тег карточки, ни исходная колонка не совпали с проектом из реестра')).
            mockResolvedValue(JSON.stringify({id: 'term-9'}))
        stubBindings({
            OpenCardTerminal: open,
            ListAgentProjects: vi.fn().mockResolvedValue(JSON.stringify([{name: 'app'}, {name: 'site'}])),
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'клаус'}])),
        })
        render(() => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>))

        // Two folders need choosing; the single agent filled itself in. The
        // headline is the ask, not the machinery's own words — those are the
        // small print under the form.
        expect(await screen.findByText('Choose a folder…')).toBeInTheDocument()
        expect(screen.getByText('клаус')).toBeInTheDocument()
        expect(screen.getByText('The card does not say where or by whom to work — choose:')).toBeInTheDocument()
        const reason = screen.getByText(/ни тег карточки/)
        expect(reason.className).toContain('CardTerminal__reason')

        await userEvent.click(screen.getByText('Choose a folder…'))
        await userEvent.click(await screen.findByText('app'))
        await userEvent.click(screen.getByRole('button', {name: 'Start the conversation'}))

        await waitFor(() => expect(open).toHaveBeenLastCalledWith('card-1', 'app', 'клаус', false))
        expect(await screen.findByTestId('terminal')).toHaveTextContent('term-9')
    })

    // «На весь экран» is a handover, not a copy: two views of one pty fight
    // over its size, so opening the window closes the panel.
    it('hands the conversation to the window and closes the panel', async () => {
        const onClose = vi.fn()
        stubBindings({
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
