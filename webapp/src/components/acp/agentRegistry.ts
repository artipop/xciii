// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {createSignal} from 'solid-js'

import {agentBindings} from './bindings'

// The machine's agents, as the board knows them, asked once for the whole page.
//
// Two questions hang off this list. Whether to offer anything about agents at
// all — a board of household chores is a board, and the integration being
// compiled in is not a reason to put an agent on it, so a machine with an empty
// registry is offered nothing anywhere. And whether a given person on the board
// is one of them, which decides what the board says to somebody putting it on a
// card.
//
// Every card would otherwise ask for itself, which is one call to Go per card
// opened for an answer that belongs to the machine and changes when somebody
// edits the settings, not when a card is opened.

export type AgentAccount = {
    name: string

    // What the agent's board account is called. The fold from the name is the
    // Go side's (AgentUsername) and is not repeated here — that would be two
    // answers to "is this person an agent", and they would drift.
    username: string
}

const [known, setKnown] = createSignal<AgentAccount[] | undefined>(undefined)
let inflight: Promise<void> | undefined

// undefined until Go has answered: nothing is drawn on a guess, so a terminal
// button neither flashes into being nor offers what cannot be opened.
export const registeredAgents = () => known()?.length

export function refreshRegisteredAgents(): Promise<void> {
    const bindings = agentBindings()
    if (!bindings?.ListAgentAccounts) {
        setKnown([])
        return Promise.resolve()
    }
    if (!inflight) {
        inflight = (async () => {
            try {
                setKnown((JSON.parse(await bindings.ListAgentAccounts!()) || []) as AgentAccount[])
            } catch (e) {
                setKnown([])
            } finally {
                inflight = undefined
            }
        })()
    }
    return inflight
}

// isAgentUsername answers for one of the board's people. It is false until the
// registry has been fetched, which is the safe way round: what it guards is a
// board saying something about an agent that it must not say about a person.
export function isAgentUsername(username: string): boolean {
    if (!username) {
        return false
    }
    return (known() || []).some((agent) => agent.username === username)
}
