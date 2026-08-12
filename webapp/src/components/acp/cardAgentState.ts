// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {Accessor, createSignal, Setter} from 'solid-js'

import {agentBindings} from './bindings'

// What the Go side knows about the agent on a card: the session it ran, the
// branch and worktree it left behind, and whether a terminal is open on it.
export type CardAgentState = {
    session?: {
        sessionId?: string
        status?: string
        branch?: string
        worktree?: string
        error?: string
    }
    running?: {id: string}
    resume?: {available?: boolean, branch?: string, cwd?: string}
}

type Entry = {
    read: Accessor<CardAgentState>
    write: Setter<CardAgentState>
    inflight?: Promise<void>
}

// One fetch per card, however many components show it. The card dialog draws
// this twice — as the stamp under the title and as the agent's own row — and
// two `GetCardAgent` calls for one card would be two round trips to Go for the
// same answer, plus two chances for the two to disagree on screen.
const entries = new Map<string, Entry>()

function entryFor(cardId: string): Entry {
    let entry = entries.get(cardId)
    if (!entry) {
        const [read, write] = createSignal<CardAgentState>({})
        entry = {read, write}
        entries.set(cardId, entry)
    }
    return entry
}

export function cardAgentState(cardId: string): Accessor<CardAgentState> {
    return entryFor(cardId).read
}

export async function refreshCardAgent(cardId: string): Promise<void> {
    const bindings = agentBindings()
    if (!bindings?.GetCardAgent) {
        return
    }
    const entry = entryFor(cardId)

    // Components mount together, so their first refresh lands in the same tick.
    if (!entry.inflight) {
        entry.inflight = (async () => {
            try {
                entry.write(JSON.parse(await bindings.GetCardAgent(cardId)))
            } finally {
                entry.inflight = undefined
            }
        })()
    }
    await entry.inflight
}
