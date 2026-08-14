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

    // How the card's workspace is arranged — 'worktree' (a copy of its own) or
    // 'branch' (in the folder itself). The stamp names its line after it.
    workMode?: string

    // Why the automation is doing nothing on this card, when it knows — the
    // same reason the route strip shows, for a card outside any route.
    stall?: {reason?: string, nodeId?: string, createdAt?: string}

    // The card's conversations, one per node it has stood on: the current
    // node's first — what the panel opens — then the others, newest first.
    conversations?: CardConversation[]

    // Where a conversation on this card would run, when the card resolves a
    // folder. Absent means «no folder», which the panel turns into an explicit
    // choice before anything starts.
    folder?: string
}

export type CardConversation = {
    nodeId?: string
    column?: string

    // The conversation of a card that had no column when it was held: there is
    // no column to name it after, so the name is this side's to give.
    noColumn?: boolean
    agent?: string
    running?: boolean

    // The node the card stands on now — the conversation the panel opens, and
    // the only place a new one can start.
    current?: boolean

    // A route is running this conversation right now: the one row that cannot
    // be deleted, since the route is waiting on it.
    stage?: boolean
    terminalId?: string
    startedAt?: string
    endedAt?: string
    exitCode?: number

    // What the row says about itself: what the conversation is called (a
    // person's name for it, or the agent's own), the line the agent wrote about
    // what is going on in it, and where it is happening.
    title?: string
    summary?: string
    folder?: string
    boardFolder?: boolean

    // Whether the CLI in it was handed the board tools, which is what makes
    // «попросить агента назвать» possible.
    tools?: boolean
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
