import {IUser} from '../../user'

import {invalidateBoardAgents, keepBoardAgents, loadBoardAgents} from './boardAgents'

const anyWindow = window as any

const asUser = (username: string): IUser => ({username} as IUser)

describe('components/acp/boardAgents', () => {
    afterEach(() => {
        delete anyWindow.go
        invalidateBoardAgents()
        vi.clearAllMocks()
    })

    // The narrowing is a subtraction, and the thing being subtracted is "an
    // agent this board has nothing to do with". Everybody else — a person, an
    // account this app knows nothing about — is left exactly as found.
    test('an agent the board does not name is dropped, and a person is not', () => {
        const users = [asUser('artem'), asUser('cl'), asUser('coc')]
        const kept = keepBoardAgents(users, {board: ['coc'], all: ['cl', 'coc']})
        expect(kept.map((u) => u.username)).toEqual(['artem', 'coc'])
    })

    // A board that names nobody is a board never set up, and a field that
    // offered no agent there would leave no way to assign one at all.
    test('a board that names nobody narrows nothing', () => {
        const users = [asUser('artem'), asUser('cl'), asUser('coc')]
        expect(keepBoardAgents(users, {board: [], all: ['cl', 'coc']})).toEqual(users)
    })

    // Outside the desktop app there is no registry, so there are no agents to
    // tell from people and nothing to narrow by.
    test('a build with no bindings offers everybody', async () => {
        expect(await loadBoardAgents('board-1')).toEqual({board: [], all: []})
    })

    // One call per board however many person properties are drawn: a table row
    // draws one each, and they all ask the same question.
    test('the answer is asked for once per board and shared', async () => {
        const BoardAgentUsers = vi.fn().mockResolvedValue(JSON.stringify({board: ['coc'], all: ['cl', 'coc']}))
        anyWindow.go = {main: {App: {BoardAgentUsers}}}

        const [first, second] = await Promise.all([loadBoardAgents('board-1'), loadBoardAgents('board-1')])
        expect(first).toEqual({board: ['coc'], all: ['cl', 'coc']})
        expect(second).toEqual(first)
        expect(BoardAgentUsers).toHaveBeenCalledTimes(1)

        // And asked again once something says the crew may have moved.
        invalidateBoardAgents()
        await loadBoardAgents('board-1')
        expect(BoardAgentUsers).toHaveBeenCalledTimes(2)
    })

    // A refusal narrows nothing rather than emptying the field: wrong in the
    // direction that still lets somebody assign the card.
    test('a board whose agents cannot be read offers everybody', async () => {
        anyWindow.go = {main: {App: {BoardAgentUsers: vi.fn().mockRejectedValue('нет такой доски')}}}
        expect(await loadBoardAgents('board-1')).toEqual({board: [], all: []})
    })
})
