import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'

import {Board, createBoard} from '../../blocks/board'

import PlanningDialog, {isPlanningAvailable} from './planningDialog'

// The board the dialog was opened from: what bounds where the agent may leave
// the cards it agrees on.
const board: Board = createBoard({id: 'board-1'} as any)

const anyWindow = window as any

function planningBindings() {
    return {
        ListAgentProjects: vi.fn().mockResolvedValue(JSON.stringify([{name: 'app', path: '/src/app'}])),
        ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'planner', kind: 'claude'}])),
        OpenPlanningTerminal: vi.fn().mockResolvedValue(JSON.stringify({
            id: 'term-1', url: 'http://127.0.0.1:1234/acp/terminal/term-1', windowed: true,
        })),
        ListTerminals: vi.fn().mockResolvedValue('[]'),
        ShowTerminal: vi.fn().mockResolvedValue(JSON.stringify({id: 'term-9', windowed: true})),
        GetPlanningPrompt: vi.fn().mockResolvedValue('Ничего не меняй.'),
        SetPlanningPrompt: vi.fn().mockResolvedValue(undefined),
    }
}

describe('components/acp/planningDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        delete anyWindow.go
    })

    it('is inert without desktop bindings', () => {
        expect(isPlanningAvailable()).toBe(false)
    })

    // One registered agent answers the who-question by itself, so the dialog
    // opens straight onto where — and a project's name is an answer, not an
    // option in a list: clicking it opens the terminal.
    it('skips the one agent, and a project name starts the terminal', async () => {
        const bindings = planningBindings()
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <PlanningDialog board={board} onClose={vi.fn()}/>))

        expect(await screen.findByText('Where should the conversation live?')).toBeInTheDocument()
        await userEvent.click(await screen.findByRole('button', {name: 'app'}))

        await waitFor(() => expect(bindings.OpenPlanningTerminal).toHaveBeenCalledWith('app', 'planner', 'board-1'))

        // The desktop opened the window itself; nothing else should be needed.
        expect(bindings.ListTerminals).toHaveBeenCalled()
    })

    // «Папка доски» is an answer here exactly as it is on a card: planning
    // with no code is how a board of briefs gets talked over. The empty
    // project name is what Go resolves into the board's folder.
    it('offers the board’s folder and starts in it', async () => {
        const bindings = planningBindings()
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <PlanningDialog board={board} onClose={vi.fn()}/>))

        await userEvent.click(await screen.findByRole('button', {name: 'Use the board’s folder'}))

        await waitFor(() => expect(bindings.OpenPlanningTerminal).toHaveBeenCalledWith('', 'planner', 'board-1'))
    })

    // With several agents the questions come one at a time and in order: who
    // — the names are the answers — then where, with the chosen name kept
    // above the question as the way back.
    it('asks who first when there is a choice, and the name leads back', async () => {
        const bindings = planningBindings()
        bindings.ListAgents = vi.fn().mockResolvedValue(JSON.stringify([{name: 'planner'}, {name: 'coder'}]))
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <PlanningDialog board={board} onClose={vi.fn()}/>))

        expect(await screen.findByText('Who talks here?')).toBeInTheDocument()
        expect(screen.queryByText('Where should the conversation live?')).toBeNull()

        await userEvent.click(await screen.findByRole('button', {name: 'planner'}))
        expect(await screen.findByText('Where should the conversation live?')).toBeInTheDocument()

        await userEvent.click(screen.getByRole('button', {name: 'planner'}))
        expect(await screen.findByText('Who talks here?')).toBeInTheDocument()
    })

    // A terminal outlives its window, and a planning one has no card behind it:
    // the dialog is the only place it can be found again.
    it('offers back a terminal that is still running', async () => {
        const bindings = planningBindings()
        bindings.ListTerminals = vi.fn().mockResolvedValue(JSON.stringify([
            {id: 'term-9', agent: 'planner', cwd: '/src/app', running: true},
        ]))
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <PlanningDialog board={board} onClose={vi.fn()}/>))

        const running = await screen.findByText('planner · app')
        await userEvent.click(running)
        await waitFor(() => expect(bindings.ShowTerminal).toHaveBeenCalledWith('term-9'))
    })

    // A terminal that lives in «папка доски» is named that, never by the raw
    // directory — the path into the app's data is nobody's address.
    it('names a board-folder terminal «папка доски»', async () => {
        const bindings = planningBindings()
        bindings.ListTerminals = vi.fn().mockResolvedValue(JSON.stringify([
            {id: 'term-8', agent: 'planner', cwd: '/data/boards/board-1', boardFolder: true, running: true},
        ]))
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <PlanningDialog board={board} onClose={vi.fn()}/>))

        expect(await screen.findByText('planner · the board’s folder')).toBeInTheDocument()
    })

    // What the agent is told to begin with is a setting of the machine, edited
    // in Settings → This machine. It used to be edited here, which made a
    // setting look like part of the act of opening a terminal. The bindings for
    // it are still handed to the dialog below, so this fails if it goes back to
    // reading them.
    it('does not ask about the instructions it opens with', async () => {
        anyWindow.go = {main: {App: planningBindings()}}

        render(() => wrapIntl(() => <PlanningDialog board={board} onClose={vi.fn()}/>))

        await screen.findByText('Where should the conversation live?')
        expect(screen.queryByRole('textbox')).toBeNull()
    })

    it('says what went wrong instead of failing silently', async () => {
        const bindings = planningBindings()
        bindings.OpenPlanningTerminal = vi.fn().mockRejectedValue(new Error('CLI агента не установлен'))
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <PlanningDialog board={board} onClose={vi.fn()}/>))

        await userEvent.click(await screen.findByRole('button', {name: 'app'}))

        expect(await screen.findByText(/CLI агента не установлен/)).toBeInTheDocument()
    })
})
