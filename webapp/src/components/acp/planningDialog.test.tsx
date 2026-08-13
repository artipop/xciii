import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'

import {Board, createBoard} from '../../blocks/board'

import PlanningDialog, {isPlanningAvailable} from './planningDialog'

// The board the dialog was opened from: what bounds where the agent may leave
// the cards it agrees on, and whose folders are offered.
const board: Board = createBoard({id: 'board-1'} as any)

const anyWindow = window as any

function planningBindings() {
    return {
        ListAgentWorkdirs: vi.fn().mockResolvedValue(JSON.stringify([{name: 'app', path: '/src/app'}])),
        ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'planner', kind: 'claude'}])),
        OpenPlanningTerminal: vi.fn().mockResolvedValue(JSON.stringify({
            id: 'term-1', url: 'http://127.0.0.1:1234/acp/terminal/term-1', windowed: true,
        })),
        ListTerminals: vi.fn().mockResolvedValue('[]'),
        ShowTerminal: vi.fn().mockResolvedValue(JSON.stringify({id: 'term-9', windowed: true})),
        CloseTerminal: vi.fn().mockResolvedValue(undefined),
        RenameTerminal: vi.fn().mockResolvedValue(undefined),
        GetPlanningPrompt: vi.fn().mockResolvedValue('Ничего не меняй.'),
        SetPlanningPrompt: vi.fn().mockResolvedValue(undefined),
    }
}

// A conversation with no card behind it, as ListTerminals reports one.
const openTerminal = {
    id: 'term-9',
    agent: 'planner',
    cwd: '/src/app',
    title: 'Разбор задачи',
    summary: 'составляю план на три карточки',
    running: true,
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
    // opens straight onto the folder question — and a folder's name is an
    // answer, not an option in a list: clicking it opens the terminal.
    it('skips the one agent, and a folder name starts the terminal', async () => {
        const bindings = planningBindings()
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <PlanningDialog board={board} onClose={vi.fn()}/>))

        expect(await screen.findByText('Which folder will the agent work in?')).toBeInTheDocument()
        await userEvent.click(await screen.findByRole('button', {name: 'app'}))

        await waitFor(() => expect(bindings.OpenPlanningTerminal).toHaveBeenCalledWith('app', 'planner', 'board-1'))

        // The desktop opened the window itself; nothing else should be needed.
        expect(bindings.ListTerminals).toHaveBeenCalled()
    })

    // The board's drafts folder is an answer here exactly as it is on a card:
    // planning with no code is how a board of briefs gets talked over. The empty
    // folder name is what Go resolves into it.
    it('offers the board’s drafts and starts in them', async () => {
        const bindings = planningBindings()
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <PlanningDialog board={board} onClose={vi.fn()}/>))

        await userEvent.click(await screen.findByRole('button', {name: 'The board’s drafts'}))

        await waitFor(() => expect(bindings.OpenPlanningTerminal).toHaveBeenCalledWith('', 'planner', 'board-1'))
    })

    // With several agents the questions come one at a time and in order: which
    // agent — the names are the answers — then which folder, with the chosen
    // name kept above the question as the way back.
    it('asks which agent first, and the name leads back', async () => {
        const bindings = planningBindings()
        bindings.ListAgents = vi.fn().mockResolvedValue(JSON.stringify([{name: 'planner'}, {name: 'coder'}]))
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <PlanningDialog board={board} onClose={vi.fn()}/>))

        expect(await screen.findByText('Choosing an agent')).toBeInTheDocument()
        expect(screen.queryByText('Which folder will the agent work in?')).toBeNull()

        await userEvent.click(await screen.findByRole('button', {name: 'planner'}))
        expect(await screen.findByText('Which folder will the agent work in?')).toBeInTheDocument()

        await userEvent.click(screen.getByRole('button', {name: 'planner'}))
        expect(await screen.findByText('Choosing an agent')).toBeInTheDocument()
    })

    // A terminal outlives its window, and a planning one has no card behind it:
    // the dialog is the only place it can be found again. What it is called and
    // what the agent said it is doing are both on the row, because «planner ·
    // app» three times over says nothing about which one to open.
    it('lists an open terminal by its name and the agent’s own recap', async () => {
        const bindings = planningBindings()
        bindings.ListTerminals = vi.fn().mockResolvedValue(JSON.stringify([openTerminal]))
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <PlanningDialog board={board} onClose={vi.fn()}/>))

        expect(await screen.findByText('Open terminals')).toBeInTheDocument()
        expect(await screen.findByText('составляю план на три карточки')).toBeInTheDocument()
        expect(screen.getByText('planner · app')).toBeInTheDocument()

        // The name opens it, and so does the icon beside it.
        await userEvent.click(screen.getByRole('button', {name: 'Разбор задачи'}))
        await waitFor(() => expect(bindings.ShowTerminal).toHaveBeenCalledWith('term-9'))
    })

    // A terminal that lives in the board's own folder is named that, never by
    // the raw directory — the path into the app's data is nobody's address.
    it('names a drafts-folder terminal by the folder, not the path', async () => {
        const bindings = planningBindings()
        bindings.ListTerminals = vi.fn().mockResolvedValue(JSON.stringify([
            {id: 'term-8', agent: 'planner', cwd: '/data/boards/board-1', boardFolder: true, running: true},
        ]))
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <PlanningDialog board={board} onClose={vi.fn()}/>))

        expect(await screen.findByText('planner · the board’s drafts')).toBeInTheDocument()
    })

    // The title a terminal starts with says which card and nothing about what is
    // going on in it, so it can be renamed where it is read.
    it('renames a conversation in place', async () => {
        const bindings = planningBindings()
        bindings.ListTerminals = vi.fn().mockResolvedValue(JSON.stringify([openTerminal]))
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <PlanningDialog board={board} onClose={vi.fn()}/>))

        await userEvent.click(await screen.findByRole('button', {name: 'Rename the conversation'}))
        const input = await screen.findByRole('textbox', {name: 'Rename the conversation'})
        await userEvent.clear(input)
        await userEvent.type(input, 'Экспорт архива{Enter}')

        await waitFor(() => expect(bindings.RenameTerminal).toHaveBeenCalledWith('term-9', 'Экспорт архива'))
    })

    // Ending a terminal ends the CLI in it, so it is asked about first — and
    // ending it is the only way this list gets shorter.
    it('asks before ending a terminal, and then ends it', async () => {
        const bindings = planningBindings()
        bindings.ListTerminals = vi.fn().mockResolvedValue(JSON.stringify([openTerminal]))
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <PlanningDialog board={board} onClose={vi.fn()}/>))

        await userEvent.click(await screen.findByRole('button', {name: 'End the terminal'}))
        expect(await screen.findByText('End this terminal?')).toBeInTheDocument()
        expect(bindings.CloseTerminal).not.toHaveBeenCalled()

        // Answering no leaves it running.
        await userEvent.click(screen.getByRole('button', {name: 'Cancel'}))
        expect(bindings.CloseTerminal).not.toHaveBeenCalled()

        await userEvent.click(await screen.findByRole('button', {name: 'End the terminal'}))
        await userEvent.click(await screen.findByRole('button', {name: 'End'}))
        await waitFor(() => expect(bindings.CloseTerminal).toHaveBeenCalledWith('term-9'))
    })

    // What the agent is told to begin with is a setting of the machine, edited
    // in Settings → This machine. It used to be edited here, which made a
    // setting look like part of the act of opening a terminal. The bindings for
    // it are still handed to the dialog below, so this fails if it goes back to
    // reading them.
    it('does not ask about the instructions it opens with', async () => {
        anyWindow.go = {main: {App: planningBindings()}}

        render(() => wrapIntl(() => <PlanningDialog board={board} onClose={vi.fn()}/>))

        await screen.findByText('Which folder will the agent work in?')
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
