import {fireEvent, render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'
import {Board, createBoard} from '../../blocks/board'

import BoardPromptsDialog from './boardPromptsDialog'

const anyWindow = window as any

const board: Board = {...createBoard(), id: 'board-1'}

function stubBindings(brief: unknown = {}) {
    const bindings = {
        GetBoardPrompts: vi.fn().mockResolvedValue(JSON.stringify(brief)),
        SetBoardPrompts: vi.fn().mockResolvedValue(undefined),
        ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'клаус'}, {name: 'кодекс'}])),
    }
    anyWindow.go = {main: {App: bindings}}
    return bindings
}

function open() {
    return render(() => wrapIntl(() => (
        <BoardPromptsDialog
            board={board}
            onClose={vi.fn()}
        />
    )))
}

describe('components/acp/boardPromptsDialog', () => {
    afterEach(() => {
        delete anyWindow.go
        vi.clearAllMocks()
    })

    // The board's own words and the words it keeps for one agent are two
    // answers, and both are saved in one go — it is one screen and one Save.
    test('saves what the board says to everybody and to one agent', async () => {
        const bindings = stubBindings({board: 'Отвечай по-русски.'})
        open()

        const shared = await screen.findByRole('textbox', {name: 'To every agent of this board'})
        expect(shared).toHaveValue('Отвечай по-русски.')

        userEvent.click(await screen.findByText('кодекс'))
        const mine = await screen.findByRole('textbox', {name: 'кодекс'})
        fireEvent.input(mine, {target: {value: 'Только ревью, код не правь.'}})

        userEvent.click(screen.getByRole('button', {name: 'Save'}))
        await waitFor(() => expect(bindings.SetBoardPrompts).toHaveBeenCalled())
        const [boardId, payload] = bindings.SetBoardPrompts.mock.calls[0]
        expect(boardId).toBe('board-1')
        expect(JSON.parse(payload)).toEqual({
            board: 'Отвечай по-русски.',
            agents: {'кодекс': 'Только ревью, код не правь.'},
        })
    })

    // An agent this machine has no entry for is still listed when the board
    // carries words for it: the text came with the board, and dropping it would
    // be this machine quietly undoing what another machine set up.
    test('lists an agent the board names but this machine has not got', async () => {
        stubBindings({agents: {'джуни': 'Только документация.'}})
        open()

        expect(await screen.findByText('джуни — set')).toBeInTheDocument()
    })
})
