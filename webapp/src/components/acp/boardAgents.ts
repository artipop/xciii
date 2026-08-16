// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {IUser} from '../../user'

import {agentBindings} from './bindings'

// Which agents a board offers on a card. The registry is the machine's — every
// agent registered anywhere gets an account on every board — so a machine with
// two agents offered both of them in «Исполнитель» on every board, with nothing
// on screen saying which had anything to do with the work there.
//
// What a board says about it is its automation: the crew of its columns and of
// its route stages. Go reads that (BoardAgentUsers) and answers with two lists
// of usernames — the ones this board names, and every agent there is — because
// the narrowing is a subtraction: an agent this board does not name is dropped,
// and anybody who is not an agent is left exactly as they were.
//
// A board that names nobody narrows nothing. That is the case of a board never
// set up, and refusing to offer an agent there would leave no way to assign one
// at all — the setup wizard's agent step is where a board says otherwise.

export type BoardAgents = {

    // Usernames of the agents this board names in its automation.
    board: string[]

    // Usernames of every agent in the machine's registry.
    all: string[]
}

const EMPTY: BoardAgents = {board: [], all: []}

// Asked once per board and shared: a card dialog draws one person property, a
// table draws one per row, and they all want the same two lists.
const cache = new Map<string, Promise<BoardAgents>>()

// invalidateBoardAgents drops the cache. There is no event to listen for —
// nothing on the Go side announces a crew or a registry edit — so this is
// called at the places that make one: the automation editor, the setup wizard,
// and the sync a board runs when it is opened.
export function invalidateBoardAgents(): void {
    cache.clear()
}

// loadBoardAgents answers with the two lists, and with nothing at all outside
// the desktop app: a browser or plugin build has no registry, so there are no
// agents to tell from people.
export function loadBoardAgents(boardId: string): Promise<BoardAgents> {
    const bindings = agentBindings()
    if (!bindings?.BoardAgentUsers || !boardId) {
        return Promise.resolve(EMPTY)
    }
    const cached = cache.get(boardId)
    if (cached) {
        return cached
    }
    const loading = bindings.BoardAgentUsers(boardId).
        then((raw) => {
            const answer = JSON.parse(raw) as BoardAgents
            return {board: answer?.board || [], all: answer?.all || []}
        }).
        catch(() => {
            // A board whose agents could not be read narrows nothing, which is
            // the safe direction: the field offers too many rather than none.
            cache.delete(boardId)
            return EMPTY
        })
    cache.set(boardId, loading)
    return loading
}

// keepBoardAgents is the subtraction itself, kept apart from the loading so the
// rule can be read on its own: everybody who is not an agent stays, and an
// agent stays when this board names it. Matching is by username, which is what
// the board holds and what Go folded both lists to.
export function keepBoardAgents(users: IUser[], agents: BoardAgents): IUser[] {
    if (agents.board.length === 0 || agents.all.length === 0) {
        return users
    }
    const named = new Set(agents.board)
    const isAgent = new Set(agents.all)
    return users.filter((user) => !isAgent.has(user.username) || named.has(user.username))
}

// boardAgentsFilter is what a person property hands to the selector: the lists
// are fetched (cached, so this is one call per board) and the subtraction is
// applied to whatever the search found.
export function boardAgentsFilter(boardId: string): (users: IUser[]) => Promise<IUser[]> {
    return (users: IUser[]) => loadBoardAgents(boardId).then((agents) => keepBoardAgents(users, agents))
}
