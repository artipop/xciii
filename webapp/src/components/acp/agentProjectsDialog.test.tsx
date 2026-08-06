// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'
import {TestBlockFactory} from '../../test/testBlockFactory'
import mutator from '../../mutator'

import AgentProjectsDialog, {isAgentProjectsAvailable} from './agentProjectsDialog'

vi.mock('../../mutator')
const mockedMutator = vi.mocked(mutator)

const anyWindow = window as any

describe('components/acp/agentProjectsDialog', () => {
    const board = TestBlockFactory.createBoard()

    afterEach(() => {
        delete anyWindow.go
        vi.clearAllMocks()
    })

    test('isAgentProjectsAvailable is false without desktop bindings', () => {
        expect(isAgentProjectsAvailable()).toBe(false)
    })

    test('lists projects and adds a picked directory', async () => {
        const bindings = {
            ListAgentProjects: vi.fn().mockResolvedValue(JSON.stringify([{name: 'alpha', path: '/tmp/alpha'}])),
            PickDirectory: vi.fn().mockResolvedValue('/tmp/beta'),
            AddAgentProject: vi.fn().mockResolvedValue(JSON.stringify({name: 'beta', path: '/tmp/beta'})),
            RemoveAgentProject: vi.fn().mockResolvedValue(undefined),
        }
        anyWindow.go = {main: {App: bindings}}
        expect(isAgentProjectsAvailable()).toBe(true)

        render(() => wrapIntl(() =>
            <AgentProjectsDialog
                board={board}
                onClose={vi.fn()}
            />,
        ))
        await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Add project…'}))
        await waitFor(() => expect(bindings.PickDirectory).toHaveBeenCalled())
        await waitFor(() => expect(screen.getByDisplayValue('beta')).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Add'}))

        // The board it was added on, and not global unless asked: a project is
        // this board's business until somebody says it is everyone's.
        await waitFor(() => expect(bindings.AddAgentProject).toHaveBeenCalledWith('beta', '/tmp/beta', board.id, false))
        expect(bindings.ListAgentProjects).toHaveBeenCalledWith(board.id)
    })

    // The registry is per machine, so without the board on the call every board
    // ended up offering every project anybody had ever added — including the
    // code checkout on the board about the shopping.
    test('a project can be made every board’s on purpose', async () => {
        const bindings = {
            ListAgentProjects: vi.fn().mockResolvedValue('[]'),
            PickDirectory: vi.fn().mockResolvedValue('/tmp/shared'),
            AddAgentProject: vi.fn().mockResolvedValue(JSON.stringify({name: 'shared', path: '/tmp/shared', global: true})),
            RemoveAgentProject: vi.fn().mockResolvedValue(undefined),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =>
            <AgentProjectsDialog
                board={board}
                onClose={vi.fn()}
            />,
        ))

        userEvent.click(screen.getByRole('button', {name: 'Add project…'}))
        await waitFor(() => expect(screen.getByDisplayValue('shared')).toBeInTheDocument())

        await userEvent.click(screen.getByRole('checkbox'))
        userEvent.click(screen.getByRole('button', {name: 'Add'}))

        await waitFor(() => expect(bindings.AddAgentProject).toHaveBeenCalledWith('shared', '/tmp/shared', board.id, true))
    })

    test('creates a Projects field and adds missing project options', async () => {
        const bindings = {
            ListAgentProjects: vi.fn().mockResolvedValue(JSON.stringify([
                {name: 'alpha', path: '/tmp/alpha'},
                {name: 'beta', path: '/tmp/beta'},
            ])),
            PickDirectory: vi.fn(),
            AddAgentProject: vi.fn(),
            RemoveAgentProject: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}
        mockedMutator.updateBoardCardProperties.mockResolvedValue()

        render(() => wrapIntl(() =>
            <AgentProjectsDialog
                board={board}
                onClose={vi.fn()}
            />,
        ))
        await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument())

        // No button to press: opening the dialog is what puts the registry into
        // the board's field.
        await waitFor(() => expect(mockedMutator.updateBoardCardProperties).toHaveBeenCalledTimes(1))

        const newProps = mockedMutator.updateBoardCardProperties.mock.calls[0][2]
        const projectProp = newProps.find((p) => p.name === 'Проекты')!
        expect(projectProp).toBeDefined()
        expect(projectProp.type).toBe('multiSelect')
        expect(projectProp.options.map((o) => o.value)).toEqual(['alpha', 'beta'])
    })

    test('reuses an existing Projects field and skips existing options', async () => {
        const boardWithProjects = TestBlockFactory.createBoard()
        boardWithProjects.cardProperties.push({
            id: 'projectprop',
            name: 'Проекты',
            type: 'multiSelect',
            options: [{id: 'o1', value: 'alpha', color: 'propColorDefault'}],
        })
        const bindings = {
            ListAgentProjects: vi.fn().mockResolvedValue(JSON.stringify([
                {name: 'alpha', path: '/tmp/alpha'}, // already an option
                {name: 'beta', path: '/tmp/beta'},
            ])),
            PickDirectory: vi.fn(),
            AddAgentProject: vi.fn(),
            RemoveAgentProject: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}
        mockedMutator.updateBoardCardProperties.mockResolvedValue()

        render(() => wrapIntl(() =>
            <AgentProjectsDialog
                board={boardWithProjects}
                onClose={vi.fn()}
            />,
        ))
        await waitFor(() => expect(screen.getByText('beta')).toBeInTheDocument())
        await waitFor(() => expect(mockedMutator.updateBoardCardProperties).toHaveBeenCalledTimes(1))

        const newProps = mockedMutator.updateBoardCardProperties.mock.calls[0][2]
        const projectProps = newProps.filter((p) => p.name === 'Проекты')
        expect(projectProps).toHaveLength(1) // reused, not duplicated
        expect(projectProps[0].options.map((o) => o.value)).toEqual(['alpha', 'beta'])
    })

    // A board made before projects were called projects has a "Repositories"
    // field its cards point at. Creating a second one beside it would leave
    // every existing card pointing at a field nothing reads, so the old one is
    // renamed in place — same id, same options, only the label changes.
    test('renames the field a board had before the rename instead of adding another', async () => {
        const boardFromBefore = TestBlockFactory.createBoard()
        boardFromBefore.cardProperties.push({
            id: 'legacy-prop',
            name: 'Repositories',
            type: 'multiSelect',
            options: [{id: 'o1', value: 'alpha', color: 'propColorDefault'}],
        })
        const bindings = {
            ListAgentProjects: vi.fn().mockResolvedValue(JSON.stringify([{name: 'alpha', path: '/tmp/alpha'}])),
            PickDirectory: vi.fn(),
            AddAgentProject: vi.fn(),
            RemoveAgentProject: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}
        mockedMutator.updateBoardCardProperties.mockResolvedValue()

        render(() => wrapIntl(() =>
            <AgentProjectsDialog
                board={boardFromBefore}
                onClose={vi.fn()}
            />,
        ))
        await waitFor(() => expect(mockedMutator.updateBoardCardProperties).toHaveBeenCalledTimes(1))

        const newProps = mockedMutator.updateBoardCardProperties.mock.calls[0][2]
        expect(newProps.filter((p) => p.name === 'Repositories')).toHaveLength(0)

        const renamed = newProps.filter((p) => p.name === 'Проекты')
        expect(renamed).toHaveLength(1)
        expect(renamed[0].id).toBe('legacy-prop')
        expect(renamed[0].options.map((o) => o.value)).toEqual(['alpha'])
    })

    test('leaves the board alone when its field already lists every project', async () => {
        const boardWithProjects = TestBlockFactory.createBoard()
        boardWithProjects.cardProperties.push({
            id: 'projectprop',
            name: 'Проекты',
            type: 'multiSelect',
            options: [{id: 'o1', value: 'alpha', color: 'propColorDefault'}],
        })
        const bindings = {
            ListAgentProjects: vi.fn().mockResolvedValue(JSON.stringify([{name: 'alpha', path: '/tmp/alpha'}])),
            PickDirectory: vi.fn(),
            AddAgentProject: vi.fn(),
            RemoveAgentProject: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =>
            <AgentProjectsDialog
                board={boardWithProjects}
                onClose={vi.fn()}
            />,
        ))
        await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument())

        // Nothing to add: the board is not patched, so the undo history and the
        // websocket stay quiet every time the dialog is opened.
        expect(mockedMutator.updateBoardCardProperties).not.toHaveBeenCalled()
    })
})
