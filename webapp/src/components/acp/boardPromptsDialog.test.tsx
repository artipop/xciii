import {fireEvent, render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'
import {Board, createBoard} from '../../blocks/board'

import BoardPromptsDialog from './boardPromptsDialog'

const anyWindow = window as any

const board: Board = {...createBoard(), id: 'board-1'}

function stubBindings(stored = '') {
    const bindings = {
        GetBoardPrompt: vi.fn().mockResolvedValue(stored),
        SetBoardPrompt: vi.fn().mockResolvedValue(undefined),
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

    test('opens on what the board says and saves what was typed', async () => {
        const bindings = stubBindings('Отвечай по-русски.')
        open()

        const box = await screen.findByRole('textbox', {name: 'The board’s system prompt'})
        expect(box).toHaveValue('Отвечай по-русски.')
        fireEvent.input(box, {target: {value: 'Отвечай по-русски. Тесты обязательны.'}})

        userEvent.click(screen.getByRole('button', {name: 'Save'}))
        await waitFor(() => expect(bindings.SetBoardPrompt).toHaveBeenCalledWith('board-1', 'Отвечай по-русски. Тесты обязательны.'))
    })

    // There are two prompts, and which one this is only means something beside
    // where the other lives and which of them the agent reads first.
    test('says what else the agent is given, and in what order', async () => {
        stubBindings()
        open()

        expect(await screen.findByText(/then its own prompt from "Settings → Agents"/)).toBeInTheDocument()
    })
})
