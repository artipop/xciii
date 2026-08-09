// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import '@testing-library/jest-dom'

import {TestBlockFactory} from '../../test/testBlockFactory'
import mutator from '../../mutator'

import {syncAgentsToBoard} from './agentSync'

vi.mock('../../mutator')
const mockedMutator = vi.mocked(mutator)

const anyWindow = window as any

describe('components/acp/agentSync', () => {
    afterEach(() => {
        delete anyWindow.go
        vi.clearAllMocks()
    })

    test('gives a board an account for every agent on the machine', async () => {
        const board = TestBlockFactory.createBoard()
        const bindings = {
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([
                {name: 'claude', kind: 'claude'},
                {name: 'codex-a', kind: 'codex'},
            ])),
            SyncAgentUsers: vi.fn().mockResolvedValue(JSON.stringify([
                {name: 'claude', created: true},
                {name: 'codex-a', created: false},
            ])),
        }
        anyWindow.go = {main: {App: bindings}}

        expect(await syncAgentsToBoard(board)).toEqual({accounts: 1, retired: false})
        expect(bindings.SyncAgentUsers).toHaveBeenCalledWith(board.id)

        // The account is the whole of it: a card names an agent the way it
        // names anybody, and no second field is added to say the same thing.
        expect(mockedMutator.updateBoardCardProperties).not.toHaveBeenCalled()
    })

    // The «Agent» select this app used to keep is a second answer to "who is
    // doing this", and the card already has one. A board that still carries it
    // loses it on the next visit to its automation screen.
    test('takes the retired «Agent» field off a board that still has one', async () => {
        const board = TestBlockFactory.createBoard()
        board.cardProperties.push({
            id: 'agent-prop',
            name: 'Agent',
            type: 'select',
            options: [{id: 'o1', value: 'claude', color: 'propColorDefault'}],
        })
        anyWindow.go = {main: {App: {
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'claude', kind: 'claude'}])),
            SyncAgentUsers: vi.fn().mockResolvedValue('[]'),
        }}}
        mockedMutator.updateBoardCardProperties.mockResolvedValue()

        expect(await syncAgentsToBoard(board)).toEqual({accounts: 0, retired: true})

        const kept = mockedMutator.updateBoardCardProperties.mock.calls[0][2]
        expect(kept.find((p) => p.name === 'Agent')).toBeUndefined()
        expect(kept).toHaveLength(board.cardProperties.length - 1)
    })

    // Every other board is left exactly as it is: this runs on every visit to
    // the automation screen, and an unchanged write would put an empty entry on
    // the undo stack each time.
    test('writes nothing to a board that never had the field', async () => {
        const board = TestBlockFactory.createBoard()
        anyWindow.go = {main: {App: {
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'claude', kind: 'claude'}])),
            SyncAgentUsers: vi.fn().mockResolvedValue('[]'),
        }}}

        expect(await syncAgentsToBoard(board)).toEqual({accounts: 0, retired: false})
        expect(mockedMutator.updateBoardCardProperties).not.toHaveBeenCalled()
    })

    // A machine with no agents has nobody to give an account to — but a board
    // it left the old field on still loses it.
    test('asks for no accounts when the machine has no agents', async () => {
        const board = TestBlockFactory.createBoard()
        const bindings = {
            ListAgents: vi.fn().mockResolvedValue('[]'),
            SyncAgentUsers: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}

        expect(await syncAgentsToBoard(board)).toEqual({accounts: 0, retired: false})
        expect(bindings.SyncAgentUsers).not.toHaveBeenCalled()
        expect(mockedMutator.updateBoardCardProperties).not.toHaveBeenCalled()
    })

    test('does nothing at all in a build with no desktop bindings', async () => {
        const board = TestBlockFactory.createBoard()
        expect(await syncAgentsToBoard(board)).toEqual({accounts: 0, retired: false})
        expect(mockedMutator.updateBoardCardProperties).not.toHaveBeenCalled()
    })
})
