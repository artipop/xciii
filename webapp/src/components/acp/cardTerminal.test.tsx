import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {mockAppStore, wrapIntl, wrapStore} from '../../testUtils'
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
        render(() => wrapStore(mockAppStore(), () => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>)))
        expect(await screen.findByTestId('terminal')).toHaveTextContent('term-1')
    })

    // The panel lists one conversation per node the card has stood on: the
    // current column's first, then the others. A row carries what the planning
    // screen's rows carry — the name, the agent's own recap, who is talking
    // where — because it is the same list.
    it('lists a conversation per node, the current column’s first', async () => {
        stubBindings({
            GetCardAgent: vi.fn().mockResolvedValue(JSON.stringify({
                conversations: [
                    {nodeId: 'opt-review',
                        column: 'Ревью',
                        agent: 'клаус',
                        current: true,
                        summary: 'пишем ТЗ на импорт',
                        boardFolder: true,
                        startedAt: '2026-08-14T10:00:00Z'},
                    {nodeId: 'opt-work', column: 'В работе', agent: 'кодекс', folder: 'app', startedAt: '2026-08-14T09:00:00Z'},
                ],
            })),
        })
        const {container} = render(() => wrapStore(mockAppStore(), () => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>)))

        await waitFor(() => expect(container.querySelectorAll('.ConversationRow').length).toBe(2))
        expect(screen.getByText('пишем ТЗ на импорт')).toBeInTheDocument()
        expect(screen.getByText('клаус · the board’s drafts')).toBeInTheDocument()

        // A past column's row has nothing to open while nothing runs in it:
        // its conversation continues when the card comes back.
        const passed = screen.getByText('В работе')
        expect(passed.closest('button')).toBeNull()

        // The current column's row is the click that starts or resumes.
        expect(screen.getByText('Ревью').closest('button')).not.toBeNull()
    })

    // The card's own conversation and the work on it are two kinds, and the
    // panel says which is which: «Обсуждение» goes through a door of its own,
    // so no route can ever type a task into it and no folder is claimed by
    // thinking out loud.
    it('opens the card’s own conversation through its own door', async () => {
        const bindings = stubBindings({
            OpenCardTalk: vi.fn().mockResolvedValue(JSON.stringify({id: 'term-talk'})),
            GetCardAgent: vi.fn().mockResolvedValue(JSON.stringify({
                folder: '/tmp/proj',
                conversations: [
                    {nodeId: '@talk', talk: true},
                    {nodeId: 'opt-review', column: 'Ревью', agent: 'клаус', current: true},
                ],
            })),
        })
        render(() => wrapStore(mockAppStore(), () => wrapIntl(() => <CardTerminal cardId='card-talk' board={board} onClose={vi.fn()}/>)))

        // The panel opens the work on the card by itself; the discussion is a
        // row a person picks.
        expect(await screen.findByTestId('terminal')).toHaveTextContent('term-1')

        // Always there, spoken in or not — it is the one row that asks nothing
        // of the card.
        await userEvent.click(screen.getByRole('button', {name: 'Discussion'}))

        await waitFor(() => expect(bindings.OpenCardTalk).toHaveBeenCalled())
        expect(bindings.OpenCardTalk.mock.calls[0][0]).toBe('card-talk')
        await waitFor(() => expect(screen.getByTestId('terminal')).toHaveTextContent('term-talk'))
    })

    // A stage the route is running right now is a conversation to look at, and
    // clicking it draws that pty in the panel rather than a second view of the
    // card's own.
    it('draws a running stage’s conversation when its row is clicked', async () => {
        stubBindings({
            GetCardAgent: vi.fn().mockResolvedValue(JSON.stringify({
                folder: '/tmp/proj',
                conversations: [
                    {nodeId: 'opt-review', column: 'Ревью', agent: 'клаус', current: true},
                    {nodeId: 'opt-work', column: 'В работе', agent: 'кодекс', running: true, stage: true, terminalId: 'term-stage'},
                ],
            })),
        })
        render(() => wrapStore(mockAppStore(), () => wrapIntl(() => <CardTerminal cardId='card-stage' board={board} onClose={vi.fn()}/>)))

        expect(await screen.findByTestId('terminal')).toHaveTextContent('term-1')
        await userEvent.click(screen.getByRole('button', {name: 'В работе'}))
        await waitFor(() => expect(screen.getByTestId('terminal')).toHaveTextContent('term-stage'))
    })

    // Any conversation can be thrown away except one a route is running — and
    // it is asked about first, because the CLI in it ends and the record goes
    // with it.
    it('deletes a conversation, once, and never a running stage’s', async () => {
        const remove = vi.fn().mockResolvedValue(undefined)
        stubBindings({
            GetCardAgent: vi.fn().mockResolvedValue(JSON.stringify({
                folder: '/tmp/proj',
                conversations: [
                    {nodeId: 'opt-review', column: 'Ревью', agent: 'клаус', current: true, running: true, terminalId: 'term-1'},
                    {nodeId: 'opt-work', column: 'В работе', agent: 'кодекс', running: true, stage: true, terminalId: 'term-2'},
                ],
            })),
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'клаус'}])),
            DeleteCardConversation: remove,
        })
        render(() => wrapStore(mockAppStore(), () => wrapIntl(() => <CardTerminal cardId='card-del' board={board} onClose={vi.fn()}/>)))

        // One bin: the running stage's row has none.
        const bins = await screen.findAllByRole('button', {name: 'Delete the conversation'})
        expect(bins.length).toBe(1)

        await userEvent.click(bins[0])
        expect(remove).not.toHaveBeenCalled()

        await userEvent.click(screen.getByRole('button', {name: 'Delete'}))
        await waitFor(() => expect(remove).toHaveBeenCalledWith('card-del', 'opt-review'))
    })

    // Nothing but the agent knows what a conversation in a pty is about, so it
    // is asked — and only where there are tools for it to answer through.
    it('asks the agent to name a running conversation', async () => {
        const ask = vi.fn().mockResolvedValue(undefined)
        stubBindings({
            GetCardAgent: vi.fn().mockResolvedValue(JSON.stringify({
                folder: '/tmp/proj',
                conversations: [
                    {nodeId: 'opt-review', column: 'Ревью', agent: 'клаус', current: true, running: true, terminalId: 'term-1', tools: true},
                    {nodeId: 'opt-work', column: 'В работе', agent: 'кодекс', running: true, terminalId: 'term-2'},
                ],
            })),
            AskTerminalName: ask,
        })
        render(() => wrapStore(mockAppStore(), () => wrapIntl(() => <CardTerminal cardId='card-name' board={board} onClose={vi.fn()}/>)))

        // One row can answer, the other was handed no tools.
        const buttons = await screen.findAllByRole('button', {name: 'Ask the agent to name this conversation'})
        expect(buttons.length).toBe(1)

        await userEvent.click(buttons[0])
        await waitFor(() => expect(ask).toHaveBeenCalledWith('term-1'))
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
            ListAgentWorkdirs: vi.fn().mockResolvedValue(JSON.stringify([{name: 'app'}])),
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'клаус'}, {name: 'кодекс'}])),
        })
        render(() => wrapStore(mockAppStore(), () => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>)))

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
        render(() => wrapStore(mockAppStore(), () => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>)))

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
        render(() => wrapStore(mockAppStore(), () => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>)))

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
            ListAgentWorkdirs: vi.fn().mockResolvedValue(JSON.stringify([{name: 'app'}])),
        })
        render(() => wrapStore(mockAppStore(), () => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>)))

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
            ListAgentWorkdirs: vi.fn().mockResolvedValue(JSON.stringify([{name: 'app'}])),
        })
        render(() => wrapStore(mockAppStore(), () => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>)))

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
            ListAgentWorkdirs: vi.fn().mockResolvedValue('[]'),
            PickDirectory: vi.fn().mockResolvedValue('/home/me/proj'),
            AddAgentWorkdir: addProject,
        })
        render(() => wrapStore(mockAppStore(), () => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>)))

        await userEvent.click(await screen.findByRole('button', {name: 'Add a folder…'}))

        await waitFor(() => expect(addProject).toHaveBeenCalledWith('proj', '/home/me/proj', board.id, '', false))
        await waitFor(() => expect(open).toHaveBeenLastCalledWith('card-1', 'proj', 'клаус', false))
    })

    // A window onto a conversation that has not started is a window onto
    // nothing, so while the panel is asking, the header offers no window
    // button.
    it('offers the window only once the terminal is open', async () => {
        stubBindings({
            ListAgents: vi.fn().mockResolvedValue('[]'),
        })
        render(() => wrapStore(mockAppStore(), () => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>)))

        await screen.findByText('Choosing an agent')
        expect(screen.queryByRole('button', {name: 'Open in a separate window'})).toBeNull()
    })

    // «На весь экран» is a handover, not a copy: two views of one pty fight
    // over its size, so opening the window closes the panel.
    it('hands the conversation to the window and closes the panel', async () => {
        const onClose = vi.fn()
        stubBindings({
            GetCardAgent: vi.fn().mockResolvedValue(JSON.stringify({
                folder: '/tmp/proj',
                conversations: [{nodeId: 'opt-review', column: 'Ревью', agent: 'клаус', current: true, running: true, terminalId: 'term-1'}],
            })),
            OpenCardTerminal: vi.fn().mockResolvedValue(JSON.stringify({id: 'term-1', windowed: true})),
        })
        render(() => wrapStore(mockAppStore(), () => wrapIntl(() => <CardTerminal cardId='card-terminal-window' board={board} onClose={onClose}/>)))
        await screen.findByTestId('terminal')

        // The row offers it, and so does the head of the terminal itself —
        // which is where somebody reading it is looking.
        const windows = screen.getAllByRole('button', {name: 'Open in a separate window'})
        expect(windows.length).toBe(2)
        await userEvent.click(windows[windows.length - 1])
        await waitFor(() => expect(onClose).toHaveBeenCalled())
    })

    // The ✕ over the terminal puts the terminal away, and that is all it does:
    // the CLI keeps running and the row keeps its place, because ending a
    // conversation is the bin on the row.
    it('puts the terminal away without ending it', async () => {
        stubBindings({
            GetCardAgent: vi.fn().mockResolvedValue(JSON.stringify({
                folder: '/tmp/proj',
                conversations: [{nodeId: 'opt-review', column: 'Ревью', agent: 'клаус', current: true, running: true, terminalId: 'term-1'}],
            })),
        })
        const {container} = render(() => wrapStore(mockAppStore(), () => wrapIntl(() => <CardTerminal cardId='card-away' board={board} onClose={vi.fn()}/>)))
        await screen.findByTestId('terminal')

        await userEvent.click(screen.getByRole('button', {name: 'Put the terminal away'}))
        await waitFor(() => expect(screen.queryByTestId('terminal')).toBeNull())
        expect(container.querySelectorAll('.ConversationRow').length).toBe(1)
    })

    // A card that has stood in one column has one conversation, and the list
    // is one row — named after the column, or «Без колонки» when there is none.
    it('lists one row for a card that has not travelled', async () => {
        stubBindings({
            GetCardAgent: vi.fn().mockResolvedValue(JSON.stringify({
                conversations: [{nodeId: '@none', noColumn: true, agent: 'клаус', current: true, startedAt: '2026-08-14T10:00:00Z'}],
            })),
        })
        const {container} = render(() => wrapStore(mockAppStore(), () => wrapIntl(() => <CardTerminal cardId='card-1' board={board} onClose={vi.fn()}/>)))

        await waitFor(() => expect(screen.getByTestId('terminal')).toBeInTheDocument())
        expect(container.querySelectorAll('.ConversationRow').length).toBe(1)

        // Twice: the row's name and the open terminal's head say the same.
        expect(screen.getAllByText('No column').length).toBe(2)
    })
})

// The two regressions of the panel, held down. Switching rows must remake the
// terminal page: it builds its socket from the id it mounted with, so handing a
// new prop to the old page showed the first pty whatever row was clicked. And
// the whole row is the click, not the name inside it.
describe('components/acp/cardTerminal rows', () => {
    afterEach(() => {
        delete (window as any).go
        vi.clearAllMocks()
    })

    it('switches the terminal when another row is picked, by remaking the page', async () => {
        stubBindings({
            GetCardAgent: vi.fn().mockResolvedValue(JSON.stringify({
                folder: '/tmp/proj',
                conversations: [
                    {nodeId: 'opt-review', column: 'Ревью', agent: 'клаус', current: true},
                    {nodeId: 'opt-work', column: 'В работе', agent: 'кодекс', running: true, stage: true, terminalId: 'term-stage'},
                ],
            })),
        })
        render(() => wrapStore(mockAppStore(), () => wrapIntl(() => <CardTerminal cardId='card-switch' board={board} onClose={vi.fn()}/>)))
        expect(await screen.findByTestId('terminal')).toHaveTextContent('term-1')

        // Clicking the row itself — not the name button — switches too.
        const row = screen.getByText('кодекс').closest('.ConversationRow') as HTMLElement
        await userEvent.click(row)
        await waitFor(() => expect(screen.getByTestId('terminal')).toHaveTextContent('term-stage'))
    })
})
