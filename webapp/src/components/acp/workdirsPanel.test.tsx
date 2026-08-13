import {fireEvent, render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'
import {TestBlockFactory} from '../../test/testBlockFactory'
import mutator from '../../mutator'

import WorkdirsPanel, {isWorkdirsAvailable} from './workdirsPanel'

vi.mock('../../mutator')
const mockedMutator = vi.mocked(mutator)

const anyWindow = window as any

describe('components/acp/workdirsPanel', () => {
    const board = TestBlockFactory.createBoard()

    afterEach(() => {
        delete anyWindow.go
        vi.clearAllMocks()
    })

    test('isWorkdirsAvailable is false without desktop bindings', () => {
        expect(isWorkdirsAvailable()).toBe(false)
    })

    test('lists workdirs and adds a picked directory', async () => {
        const bindings = {
            ListAgentWorkdirs: vi.fn().mockResolvedValue(JSON.stringify([{name: 'alpha', path: '/tmp/alpha'}])),
            PickDirectory: vi.fn().mockResolvedValue('/tmp/beta'),
            AddAgentWorkdir: vi.fn().mockResolvedValue(JSON.stringify({name: 'beta', path: '/tmp/beta'})),
            RemoveAgentWorkdir: vi.fn().mockResolvedValue(undefined),
        }
        anyWindow.go = {main: {App: bindings}}
        expect(isWorkdirsAvailable()).toBe(true)

        render(() => wrapIntl(() =>
            <WorkdirsPanel
                board={board}
                onClose={vi.fn()}
            />,
        ))
        await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Add a folder…'}))
        await waitFor(() => expect(bindings.PickDirectory).toHaveBeenCalled())
        await waitFor(() => expect(screen.getByDisplayValue('beta')).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Add'}))

        // The board it was added on, and not global unless asked: a workdir is
        // this board's business until somebody says it is everyone's.
        await waitFor(() => expect(bindings.AddAgentWorkdir).toHaveBeenCalledWith('beta', '/tmp/beta', board.id, '', false))
        expect(bindings.ListAgentWorkdirs).toHaveBeenCalledWith(board.id)
    })

    // What a folder is decides what work in it looks like, so the list says
    // it — and says the one setting a repository has, the branch work starts
    // from.
    test('says which folders are repositories, and lets the base branch be changed', async () => {
        const setBase = vi.fn().mockResolvedValue('{}')
        const bindings = {
            ListAgentWorkdirs: vi.fn().mockResolvedValue(JSON.stringify([
                {name: 'code', path: '/tmp/code', git: true, base: 'main'},
                {name: 'notes', path: '/tmp/notes'},
                {name: 'gone', path: '/tmp/gone', kind: 'git', broken: true},
            ])),
            PickDirectory: vi.fn(),
            AddAgentWorkdir: vi.fn(),
            RemoveAgentWorkdir: vi.fn(),
            SetAgentWorkdirBase: setBase,
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =>
            <WorkdirsPanel
                board={board}
                onClose={vi.fn()}
            />,
        ))

        await waitFor(() => expect(screen.getByText('repository')).toBeInTheDocument())
        expect(screen.getByText('folder')).toBeInTheDocument()

        // A folder added as a repository whose git is gone says so: everything
        // that waits for a branch will fail on it.
        expect(screen.getByText('added as a repository, no git in it')).toBeInTheDocument()

        const base = screen.getByDisplayValue('main')
        fireEvent.change(base, {target: {value: 'develop'}})
        await waitFor(() => expect(setBase).toHaveBeenCalledWith('code', 'develop'))
    })

    // The field this app made used to be called «Проекты», and a card that
    // names a folder should not be asked about a project. The name is ours, so
    // it is renamed once, in place — the board records the field by id, so
    // nothing that points at it notices.
    test('renames the field it made when it still says «Проекты»', async () => {
        const legacyBoard = TestBlockFactory.createBoard()
        legacyBoard.cardProperties.push({
            id: 'projectprop',
            name: 'Проекты',
            type: 'multiSelect',
            options: [{id: 'o1', value: 'alpha', color: 'propColorDefault'}],
        })
        legacyBoard.properties = {...legacyBoard.properties, xciiiProjectProperty: 'projectprop'}
        anyWindow.go = {main: {App: {
            ListAgentWorkdirs: vi.fn().mockResolvedValue(JSON.stringify([{name: 'alpha', path: '/tmp/alpha'}])),
            PickDirectory: vi.fn(),
            AddAgentWorkdir: vi.fn(),
            RemoveAgentWorkdir: vi.fn(),
        }}}
        mockedMutator.updateBoardCardProperties.mockResolvedValue()

        render(() => wrapIntl(() =>
            <WorkdirsPanel
                board={legacyBoard}
                onClose={vi.fn()}
            />,
        ))

        await waitFor(() => expect(mockedMutator.updateBoardCardProperties).toHaveBeenCalledTimes(1))
        const renamed = mockedMutator.updateBoardCardProperties.mock.calls[0][2].find((p) => p.id === 'projectprop')!
        expect(renamed.name).toBe('Папки')

        // And its options are left exactly as they were: cards reference them.
        expect(renamed.options.map((o) => o.value)).toEqual(['alpha'])
    })

    // Picking a folder somebody has already added is not a mistake: it is the
    // folder they meant, on another board. The answer is a question.
    test('offers a folder that is already added instead of refusing it', async () => {
        const share = vi.fn().mockResolvedValue('{}')
        const add = vi.fn()
        anyWindow.go = {main: {App: {
            ListAgentWorkdirs: vi.fn().mockResolvedValue('[]'),
            PickDirectory: vi.fn().mockResolvedValue('/tmp/code'),
            FindAgentWorkdir: vi.fn().mockResolvedValue(JSON.stringify({name: 'code', path: '/tmp/code', boardId: 'another-board'})),
            ShareAgentWorkdir: share,
            AddAgentWorkdir: add,
            RemoveAgentWorkdir: vi.fn(),
        }}}

        render(() => wrapIntl(() =>
            <WorkdirsPanel
                board={board}
                onClose={vi.fn()}
            />,
        ))

        userEvent.click(await screen.findByRole('button', {name: 'Add a folder…'}))
        await waitFor(() => expect(screen.getByText(/already added as "code"/)).toBeInTheDocument())

        await userEvent.click(screen.getByRole('button', {name: 'Use it here'}))

        // Shared rather than added twice: one folder, one entry, offered on
        // both boards.
        await waitFor(() => expect(share).toHaveBeenCalledWith('code'))
        expect(add).not.toHaveBeenCalled()
    })

    // A workdir registered before workdirs belonged to a board is offered
    // nowhere — and its folder cannot be added again, the path is taken. So it
    // is listed apart, with the one action that puts it back into use.
    test('offers a workdir no board has claimed to this one', async () => {
        const bindings = {
            ListAgentWorkdirs: vi.fn().mockResolvedValue('[]'),
            ListUnattachedWorkdirs: vi.fn().mockResolvedValue(JSON.stringify([{name: 'legacy', path: '/tmp/legacy'}])),
            AttachAgentWorkdir: vi.fn().mockResolvedValue('{}'),
            PickDirectory: vi.fn(),
            AddAgentWorkdir: vi.fn(),
            RemoveAgentWorkdir: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =>
            <WorkdirsPanel
                board={board}
                onClose={vi.fn()}
            />,
        ))

        expect(await screen.findByText('Not on any board yet')).toBeInTheDocument()
        await userEvent.click(screen.getByRole('button', {name: 'Add to this board'}))
        await waitFor(() => expect(bindings.AttachAgentWorkdir).toHaveBeenCalledWith('legacy', board.id))
    })

    // The registry is per machine, so without the board on the call every board
    // ended up offering every workdir anybody had ever added — including the
    // code checkout on the board about the shopping.
    test('a workdir can be made every board’s on purpose', async () => {
        const bindings = {
            ListAgentWorkdirs: vi.fn().mockResolvedValue('[]'),
            PickDirectory: vi.fn().mockResolvedValue('/tmp/shared'),
            AddAgentWorkdir: vi.fn().mockResolvedValue(JSON.stringify({name: 'shared', path: '/tmp/shared', global: true})),
            RemoveAgentWorkdir: vi.fn().mockResolvedValue(undefined),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =>
            <WorkdirsPanel
                board={board}
                onClose={vi.fn()}
            />,
        ))

        userEvent.click(screen.getByRole('button', {name: 'Add a folder…'}))
        await waitFor(() => expect(screen.getByDisplayValue('shared')).toBeInTheDocument())

        await userEvent.click(screen.getByRole('checkbox'))
        userEvent.click(screen.getByRole('button', {name: 'Add'}))

        await waitFor(() => expect(bindings.AddAgentWorkdir).toHaveBeenCalledWith('shared', '/tmp/shared', board.id, '', true))
    })

    test('creates the folder field and adds missing options', async () => {
        const bindings = {
            ListAgentWorkdirs: vi.fn().mockResolvedValue(JSON.stringify([
                {name: 'alpha', path: '/tmp/alpha'},
                {name: 'beta', path: '/tmp/beta'},
            ])),
            PickDirectory: vi.fn(),
            AddAgentWorkdir: vi.fn(),
            RemoveAgentWorkdir: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}
        mockedMutator.updateBoardCardProperties.mockResolvedValue()

        render(() => wrapIntl(() =>
            <WorkdirsPanel
                board={board}
                onClose={vi.fn()}
            />,
        ))
        await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument())

        // No button to press: opening the dialog is what puts the registry into
        // the board's field.
        await waitFor(() => expect(mockedMutator.updateBoardCardProperties).toHaveBeenCalledTimes(1))

        const newProps = mockedMutator.updateBoardCardProperties.mock.calls[0][2]
        const projectProp = newProps.find((p) => p.name === 'Папки')!
        expect(projectProp).toBeDefined()
        expect(projectProp.type).toBe('multiSelect')
        expect(projectProp.options.map((o) => o.value)).toEqual(['alpha', 'beta'])
    })

    test('adds to the field the board recorded, whatever it is called', async () => {
        const boardWithProjects = TestBlockFactory.createBoard()
        boardWithProjects.cardProperties.push({
            id: 'projectprop',
            name: 'Мои папки',
            type: 'multiSelect',
            options: [{id: 'o1', value: 'alpha', color: 'propColorDefault'}],
        })
        boardWithProjects.properties = {...boardWithProjects.properties, xciiiProjectProperty: 'projectprop'}
        const bindings = {
            ListAgentWorkdirs: vi.fn().mockResolvedValue(JSON.stringify([
                {name: 'alpha', path: '/tmp/alpha'}, // already an option
                {name: 'beta', path: '/tmp/beta'},
            ])),
            PickDirectory: vi.fn(),
            AddAgentWorkdir: vi.fn(),
            RemoveAgentWorkdir: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}
        mockedMutator.updateBoardCardProperties.mockResolvedValue()

        render(() => wrapIntl(() =>
            <WorkdirsPanel
                board={boardWithProjects}
                onClose={vi.fn()}
            />,
        ))
        await waitFor(() => expect(screen.getByText('beta')).toBeInTheDocument())
        await waitFor(() => expect(mockedMutator.updateBoardCardProperties).toHaveBeenCalledTimes(1))

        const newProps = mockedMutator.updateBoardCardProperties.mock.calls[0][2]
        const projectProps = newProps.filter((p) => p.type === 'multiSelect')
        expect(projectProps).toHaveLength(1) // reused, not duplicated
        expect(projectProps[0].id).toBe('projectprop')
        expect(projectProps[0].name).toBe('Мои папки') // the name is the owner's
        expect(projectProps[0].options.map((o) => o.value)).toEqual(['alpha', 'beta'])

        // The board already said which field it is, so it is not written to.
        expect(mockedMutator.updateBoard).not.toHaveBeenCalled()
    })

    // A board with a multiSelect of its own is not a board with a workdirs
    // field: nothing is recognised by what it is called, so the field is made
    // and the board is told which one it is.
    test('does not mistake another field for the workdirs one', async () => {
        const boardFromBefore = TestBlockFactory.createBoard()
        boardFromBefore.cardProperties.push({
            id: 'tags-prop',
            name: 'Repositories',
            type: 'multiSelect',
            options: [{id: 'o1', value: 'alpha', color: 'propColorDefault'}],
        })
        const bindings = {
            ListAgentWorkdirs: vi.fn().mockResolvedValue(JSON.stringify([{name: 'alpha', path: '/tmp/alpha'}])),
            PickDirectory: vi.fn(),
            AddAgentWorkdir: vi.fn(),
            RemoveAgentWorkdir: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}
        mockedMutator.updateBoardCardProperties.mockResolvedValue()

        render(() => wrapIntl(() =>
            <WorkdirsPanel
                board={boardFromBefore}
                onClose={vi.fn()}
            />,
        ))
        await waitFor(() => expect(mockedMutator.updateBoardCardProperties).toHaveBeenCalledTimes(1))

        const newProps = mockedMutator.updateBoardCardProperties.mock.calls[0][2]
        const made = newProps.find((p) => p.name === 'Папки')!
        expect(made).toBeDefined()
        expect(made.id).not.toBe('tags-prop')
        expect(newProps.find((p) => p.id === 'tags-prop')!.options).toHaveLength(1)

        // And the board is told which field it is, so it is never guessed again.
        await waitFor(() => expect(mockedMutator.updateBoard).toHaveBeenCalledTimes(1))
        expect(mockedMutator.updateBoard.mock.calls[0][0].properties.xciiiProjectProperty).toBe(made.id)
    })

    test('leaves the board alone when its field already lists every workdir', async () => {
        const boardWithProjects = TestBlockFactory.createBoard()
        boardWithProjects.cardProperties.push({
            id: 'projectprop',
            name: 'Папки',
            type: 'multiSelect',
            options: [{id: 'o1', value: 'alpha', color: 'propColorDefault'}],
        })

        // Deliberately the key's old name: every board made before the rename
        // carries it, and the panel has to go on finding the field.
        boardWithProjects.properties = {...boardWithProjects.properties, acpProjectProperty: 'projectprop'}
        const bindings = {
            ListAgentWorkdirs: vi.fn().mockResolvedValue(JSON.stringify([{name: 'alpha', path: '/tmp/alpha'}])),
            PickDirectory: vi.fn(),
            AddAgentWorkdir: vi.fn(),
            RemoveAgentWorkdir: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =>
            <WorkdirsPanel
                board={boardWithProjects}
                onClose={vi.fn()}
            />,
        ))
        await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument())

        // Nothing to add and nothing to say: neither the card properties nor
        // the board itself is written to, so the undo history and the websocket
        // stay quiet every time the dialog is opened.
        expect(mockedMutator.updateBoardCardProperties).not.toHaveBeenCalled()
        expect(mockedMutator.updateBoard).not.toHaveBeenCalled()
    })
})
