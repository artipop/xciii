// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {chooseOption, wrapIntl} from '../../testUtils'
import {setupReactFlowEnvironment} from '../../test/reactFlowEnvironment'
import {Board, createBoard} from '../../blocks/board'

import AutomationDialog, {isAutomationAvailable} from './automationDialog'
import {SUCCESS} from './automation'

setupReactFlowEnvironment()

vi.mock('../../mutator')

const anyWindow = window as any

const board: Board = {
    ...createBoard(),
    id: 'board-1',
    cardProperties: [{
        id: 'prop-status',
        name: 'Статус',
        type: 'select',
        options: [
            {id: 'opt-work', value: 'В работе', color: ''},
            {id: 'opt-review', value: 'На ревью', color: ''},
        ],
    }],
}

function stubBindings(overrides: Record<string, unknown> = {}) {
    const bindings = {
        SeedBoardAutomation: vi.fn().mockResolvedValue(undefined),
        ListBoardColumns: vi.fn().mockResolvedValue(JSON.stringify([
            {boardId: 'board-1', optionId: 'opt-work', property: 'Статус', column: 'В работе', action: 'agent'},
        ])),
        ListFlows: vi.fn().mockResolvedValue(JSON.stringify([{
            name: 'Фича',
            boardId: 'board-1',
            property: 'Статус',
            nodes: [
                {id: 'opt-work', column: 'В работе', optionId: 'opt-work', action: ''},
                {id: 'opt-review', column: 'На ревью', optionId: 'opt-review', action: ''},
            ],
            edges: [{from: 'opt-work', to: 'opt-review', on: SUCCESS}],
        }])),
        ListFlowTriggers: vi.fn().mockResolvedValue(JSON.stringify([
            {kind: SUCCESS, source: 'outcome', label: 'шаг прошёл'},
        ])),
        ListFlowTemplates: vi.fn().mockResolvedValue('[]'),
        ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'claude'}])),
        ListDeployTargets: vi.fn().mockResolvedValue('[]'),
        GetWorktreeMode: vi.fn().mockResolvedValue('always'),
        GetBoardFlowOverview: vi.fn().mockResolvedValue('[]'),
        SaveBoardColumn: vi.fn().mockResolvedValue('{}'),
        RemoveBoardColumn: vi.fn().mockResolvedValue(undefined),
        AddFlow: vi.fn().mockResolvedValue('{}'),
        UpdateFlow: vi.fn().mockResolvedValue('{}'),
        RemoveFlow: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    }
    anyWindow.go = {main: {App: bindings}}
    return bindings
}

describe('components/acp/automationDialog', () => {
    afterEach(() => {
        delete anyWindow.go
        vi.clearAllMocks()
    })

    test('isAutomationAvailable is false without desktop bindings', () => {
        expect(isAutomationAvailable()).toBe(false)
    })

    // A board straight out of a template has its automation in its own
    // properties and nothing in the registry until something reads it. An
    // editor that showed an empty board there would be lying about it.
    test('takes what the board carries into the registry before drawing it', async () => {
        const bindings = stubBindings()
        render(() => wrapIntl(() => (
            <AutomationDialog
                board={board}
                onClose={vi.fn()}
            />
        )))
        await waitFor(() => expect(bindings.SeedBoardAutomation).toHaveBeenCalledWith('board-1'))
        await waitFor(() => expect(screen.getByRole('button', {name: 'Фича'})).toBeInTheDocument())
    })

    test('saves the column that changed, and only that one', async () => {
        const bindings = stubBindings()
        const onClose = vi.fn()
        render(() => wrapIntl(() => (
            <AutomationDialog
                board={board}
                focusColumnId='opt-review'
                onClose={onClose}
            />
        )))

        chooseOption(await screen.findByRole('button', {name: 'When a card lands here'}), 'test the preview')
        userEvent.click(screen.getByRole('button', {name: 'Save'}))

        await waitFor(() => expect(bindings.SaveBoardColumn).toHaveBeenCalledTimes(1))
        expect(JSON.parse(bindings.SaveBoardColumn.mock.calls[0][0])).toMatchObject({
            boardId: 'board-1',
            optionId: 'opt-review',
            column: 'На ревью',
            action: 'test',
        })

        // Nothing was done to the route, so nothing was written about it.
        expect(bindings.UpdateFlow).not.toHaveBeenCalled()
        expect(bindings.RemoveFlow).not.toHaveBeenCalled()
        await waitFor(() => expect(onClose).toHaveBeenCalled())
    })

    // Routes are the board's own now, so deleting one names the board it is
    // being deleted from — another board's route of the same name stays.
    test('deleting a route names the board it belongs to', async () => {
        const bindings = stubBindings()
        render(() => wrapIntl(() => (
            <AutomationDialog
                board={board}
                onClose={vi.fn()}
            />
        )))

        userEvent.click(await screen.findByRole('button', {name: 'Фича'}))
        userEvent.click(await screen.findByRole('button', {name: 'Delete this route'}))
        userEvent.click(screen.getByRole('button', {name: 'Save'}))

        await waitFor(() => expect(bindings.RemoveFlow).toHaveBeenCalledWith('board-1', 'Фича'))
    })

    test('a refused save says why and keeps the dialog open', async () => {
        const onClose = vi.fn()
        stubBindings({
            SaveBoardColumn: vi.fn().mockRejectedValue('агент "ghost" не найден в реестре'),
        })
        render(() => wrapIntl(() => (
            <AutomationDialog
                board={board}
                focusColumnId='opt-review'
                onClose={onClose}
            />
        )))

        chooseOption(await screen.findByRole('button', {name: 'When a card lands here'}), 'an agent works on the card')
        userEvent.click(screen.getByRole('button', {name: 'Save'}))

        await waitFor(() => expect(screen.getByText(/не найден в реестре/)).toBeInTheDocument())
        expect(onClose).not.toHaveBeenCalled()
    })
})
