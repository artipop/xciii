// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'
import {TestBlockFactory} from '../../test/testBlockFactory'
import mutator from '../../mutator'

import AgentProjectsPanel, {isAgentProjectsAvailable} from './agentProjectsPanel'

vi.mock('../../mutator')
const mockedMutator = vi.mocked(mutator)

const anyWindow = window as any

describe('components/acp/agentProjectsPanel', () => {
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
            <AgentProjectsPanel
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

    // A project registered before projects belonged to a board is offered
    // nowhere — and its folder cannot be added again, the path is taken. So it
    // is listed apart, with the one action that puts it back into use.
    test('offers a project no board has claimed to this one', async () => {
        const bindings = {
            ListAgentProjects: vi.fn().mockResolvedValue('[]'),
            ListUnattachedProjects: vi.fn().mockResolvedValue(JSON.stringify([{name: 'legacy', path: '/tmp/legacy'}])),
            AttachAgentProject: vi.fn().mockResolvedValue('{}'),
            PickDirectory: vi.fn(),
            AddAgentProject: vi.fn(),
            RemoveAgentProject: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =>
            <AgentProjectsPanel
                board={board}
                onClose={vi.fn()}
            />,
        ))

        expect(await screen.findByText('Not on any board yet')).toBeInTheDocument()
        await userEvent.click(screen.getByRole('button', {name: 'Add to this board'}))
        await waitFor(() => expect(bindings.AttachAgentProject).toHaveBeenCalledWith('legacy', board.id))
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
            <AgentProjectsPanel
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
            <AgentProjectsPanel
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
            <AgentProjectsPanel
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

    // A board made before the field was recorded by id has one under a name
    // this app used to give it. It is adopted — same id, same options, and the
    // name left as it is, because the name is the board owner's — and the id is
    // written down, so this is the last time a name decides anything.
    test('adopts a field a board already had, by name, exactly once', async () => {
        const boardFromBefore = TestBlockFactory.createBoard()
        boardFromBefore.cardProperties.push({
            id: 'legacy-prop',
            name: 'Repositories',
            type: 'multiSelect',
            options: [{id: 'o1', value: 'alpha', color: 'propColorDefault'}],
        })
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
            <AgentProjectsPanel
                board={boardFromBefore}
                onClose={vi.fn()}
            />,
        ))
        await waitFor(() => expect(mockedMutator.updateBoardCardProperties).toHaveBeenCalledTimes(1))

        const newProps = mockedMutator.updateBoardCardProperties.mock.calls[0][2]
        expect(newProps.filter((p) => p.type === 'multiSelect')).toHaveLength(1)

        const adopted = newProps.filter((p) => p.id === 'legacy-prop')
        expect(adopted).toHaveLength(1)
        expect(adopted[0].name).toBe('Repositories')
        expect(adopted[0].options.map((o) => o.value)).toEqual(['alpha', 'beta'])

        // And the board now knows which field it is, so its name never has to
        // be recognised again.
        await waitFor(() => expect(mockedMutator.updateBoard).toHaveBeenCalledTimes(1))
        expect(mockedMutator.updateBoard.mock.calls[0][0].properties.acpProjectProperty).toBe('legacy-prop')
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
            <AgentProjectsPanel
                board={boardWithProjects}
                onClose={vi.fn()}
            />,
        ))
        await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument())

        // Nothing to add: the card properties are not touched, so the undo
        // history and the websocket stay quiet every time the dialog is opened.
        // The board is told once which field this is, and after that not at all.
        expect(mockedMutator.updateBoardCardProperties).not.toHaveBeenCalled()
        await waitFor(() => expect(mockedMutator.updateBoard).toHaveBeenCalledTimes(1))
    })

    // Once the board carries the id, nothing here writes to it at all — and the
    // field is found however it has since been renamed.
    test('writes nothing to a board that already knows its field, whatever it is called', async () => {
        const settled = TestBlockFactory.createBoard()
        settled.cardProperties.push({
            id: 'projectprop',
            name: 'Мои папки',
            type: 'multiSelect',
            options: [{id: 'o1', value: 'alpha', color: 'propColorDefault'}],
        })
        settled.properties = {...settled.properties, acpProjectProperty: 'projectprop'}
        const bindings = {
            ListAgentProjects: vi.fn().mockResolvedValue(JSON.stringify([{name: 'alpha', path: '/tmp/alpha'}])),
            PickDirectory: vi.fn(),
            AddAgentProject: vi.fn(),
            RemoveAgentProject: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =>
            <AgentProjectsPanel
                board={settled}
                onClose={vi.fn()}
            />,
        ))
        await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument())

        expect(mockedMutator.updateBoardCardProperties).not.toHaveBeenCalled()
        expect(mockedMutator.updateBoard).not.toHaveBeenCalled()
    })
})
