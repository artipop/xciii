// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {Board, IPropertyTemplate} from '../../blocks/board'
import mutator from '../../mutator'

import {agentBindings} from './bindings'
import {invalidateBoardAgents} from './boardAgents'

// Making the machine's agents usable on a board: an account each, so the board
// can name one the same way it names a person.
//
// There used to be a second way — an «Agent» select property this kept in step
// with the registry — and a card therefore had two fields for one question:
// who is doing this. Two answers meant a rule about which of them wins, a
// column crew that had to be checked against both, and a field that said
// nothing on a board where nobody had registered an agent. The assignee is the
// one that survives: it is the field a person already reaches for, it is
// already what the engine prefers (resolveSessionAgent), and an agent is a
// member of the board like anybody else.
//
// This used to live in the agents dialog, which had a board because it was
// opened from one. The registry is the machine's, and it is now edited where
// the machine is — so the sync moved to where a board actually is: the board's
// own automation screen, and the moment somebody adds an agent from a card.

// The property this used to keep. Still named here because a board that has one
// is a board this app made, and taking it away is the other half of the move.
const RETIRED_AGENT_PROPERTY = 'Agent'

type SyncResult = {

    // How many agent accounts had to be created. Zero is the ordinary case and
    // is worth saying nothing about.
    accounts: number

    // Whether the retired «Agent» field was taken off the board. Once.
    retired: boolean
}

// syncAgentsToBoard is idempotent: a board that already knows every agent is
// left untouched, so this can ride along with an ordinary refresh without
// churning the board or its undo history.
export async function syncAgentsToBoard(board: Board): Promise<SyncResult> {
    const bindings = agentBindings()
    const result: SyncResult = {accounts: 0, retired: false}
    if (!bindings?.ListAgents || !board?.id) {
        return result
    }

    const agents = (JSON.parse(await bindings.ListAgents()) || []) as Array<{name: string}>
    if (agents.length > 0 && bindings.SyncAgentUsers) {
        const synced = (JSON.parse(await bindings.SyncAgentUsers(board.id)) || []) as Array<{created?: boolean}>
        result.accounts = synced.filter((u) => u.created).length
    }

    // Opening a board is when the registry may have moved since anybody last
    // looked: an agent added in the settings is one this board's assignee list
    // has to know about, one way or the other.
    invalidateBoardAgents()

    result.retired = await retireAgentProperty(board)
    return result
}

// retireAgentProperty takes the old field off a board that still carries it.
// The values go with it, which is the point: a card that named an agent there
// now names one in «Кто занимается», and leaving a second field on the board
// would leave two answers to the same question — the thing this removes.
//
// Exported because a board loses it the moment it is opened, not only when its
// automation screen is: a field deleted on one board and still on the next four
// is a deletion nobody can trust.
export async function retireAgentProperty(board: Board): Promise<boolean> {
    const retired = board.cardProperties.find((p: IPropertyTemplate) =>
        p.name.trim().toLowerCase() === RETIRED_AGENT_PROPERTY.toLowerCase() &&
        (p.type === 'select' || p.type === 'multiSelect'))
    if (!retired) {
        return false
    }
    await mutator.updateBoardCardProperties(
        board.id,
        board.cardProperties,
        board.cardProperties.filter((p: IPropertyTemplate) => p.id !== retired.id),
        'retire the Agent field',
    )
    return true
}
