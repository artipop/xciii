import {render, screen, waitFor} from '@solidjs/testing-library'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'

import CardTerminal from './cardTerminal'

// The panel is the terminal page plus the frame around it. What the page draws
// — xterm on a socket — is terminalPage's own test; here it only has to be the
// thing that appears, for the terminal it was given.
vi.mock('./terminalPage', () => ({
    default: (props: {terminalId?: string}) => <div data-testid='terminal'>{props.terminalId}</div>,
}))

const anyWindow = window as any

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
        render(() => wrapIntl(() => <CardTerminal cardId='card-1' onClose={vi.fn()}/>))
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
        render(() => wrapIntl(() => <CardTerminal cardId='card-1' onClose={vi.fn()}/>))

        await waitFor(() => expect(screen.getByText('· Ревью', {exact: false})).toBeInTheDocument())
        const passed = screen.getByText('В работе', {exact: false})
        expect(passed).toBeInTheDocument()
        expect(passed.closest('.CardTerminal__stageChip')).not.toBeNull()
        expect(passed.closest('button')).toBeNull()
    })

    // One conversation on a card with no route is the whole story: a row of
    // chips about itself would be noise.
    it('draws no stage chips for a card outside any route', async () => {
        stubBindings({
            GetCardAgent: vi.fn().mockResolvedValue(JSON.stringify({
                conversations: [{nodeId: '', agent: 'клаус', current: true}],
            })),
        })
        const {container} = render(() => wrapIntl(() => <CardTerminal cardId='card-1' onClose={vi.fn()}/>))

        await waitFor(() => expect(screen.getByTestId('terminal')).toBeInTheDocument())
        expect(container.querySelector('.CardTerminal__stages')).toBeNull()
    })
})
