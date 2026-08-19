// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {Accessor, createMemo, createSignal, onCleanup, onMount} from 'solid-js'

import {agentBindings} from './bindings'
import {onAgentEvent} from './agentEvents'

// Which cards have a terminal running on them.
//
// The board needs this per card and a board has as many cards as it likes, so
// it is asked the other way round: one `ListTerminals` for the whole page,
// indexed by card. Asking `GetCardAgent` per card — which is what a card's own
// panel does, for one card at a time — would be a round trip to Go for every
// card drawn.
//
// Two facts, one subscription: a CLI working right now, and a conversation that
// stopped without a verdict — the CLI was closed, or the app was. Both are a
// card in the middle of something.
//
// Merely resumable is not news: a card whose worktree could be continued says
// nothing about whether anybody meant to.

const [byCard, setByCard] = createSignal<Record<string, string>>({})

// Card id → why the conversation there stopped. The Go side decides what counts
// (StallKindConversation): the other reasons a card stands still are about a
// column, a folder or a route, and none of them is opened by a terminal.
const [cutOffByCard, setCutOffByCard] = createSignal<Record<string, string>>({})

// Consumers are counted rather than assumed, as in attention.ts: the
// subscription is worth holding only while a board displays it.
let consumers = 0
let unsubscribe: (() => void) | undefined
let unsubscribeCutOff: (() => void) | undefined

async function reloadCutOff(): Promise<void> {
    const bindings = agentBindings()
    if (!bindings?.ListCutOffConversations) {
        setCutOffByCard({})
        return
    }
    try {
        setCutOffByCard(JSON.parse(await bindings.ListCutOffConversations()) || {})
    } catch (e) {
        setCutOffByCard({})
    }
}

async function reload(): Promise<void> {
    const bindings = agentBindings()
    if (!bindings?.ListTerminals) {
        setByCard({})
        return
    }
    try {
        const list = (JSON.parse(await bindings.ListTerminals()) || []) as Array<{id: string, cardId?: string, talk?: boolean}>
        const next: Record<string, string> = {}
        for (const terminal of list) {
            // Work outranks talk on the card's face. The button there says what
            // is happening *to* the card, and a conversation about it — which
            // claims nothing and no route runs in — is not that: on a card with
            // both, drawing the discussion would hide the work behind it.
            if (terminal.cardId && (!next[terminal.cardId] || !terminal.talk)) {
                next[terminal.cardId] = terminal.id
            }
        }
        setByCard(next)
    } catch (e) {
        setByCard({})
    }
}

function subscribe(): () => void {
    consumers++
    if (consumers === 1) {
        unsubscribe = onAgentEvent('acp:terminal', () => reload())

        // A stall rides the session event rather than carrying one of its own
        // (internal/acp/stall.go), which is also what tells this side that a
        // card made progress and the reason was dropped.
        unsubscribeCutOff = onAgentEvent('acp:session', () => reloadCutOff())
        reload()
        reloadCutOff()
    }
    return () => {
        consumers--
        if (consumers === 0) {
            unsubscribe?.()
            unsubscribe = undefined
            unsubscribeCutOff?.()
            unsubscribeCutOff = undefined
            setByCard({})
            setCutOffByCard({})
        }
    }
}

// useCardTerminal is the terminal running on one card, for as long as the
// component asking lives — the id, so whoever shows it can say which one.
export function useCardTerminal(cardId: Accessor<string>): Accessor<string | undefined> {
    onMount(() => onCleanup(subscribe()))
    return createMemo(() => byCard()[cardId()])
}

// useCardCutOff is why the conversation on one card stopped without a verdict,
// or nothing when it did not — what the card's button draws its paused state
// from, and the sentence it says when hovered.
export function useCardCutOff(cardId: Accessor<string>): Accessor<string | undefined> {
    onMount(() => onCleanup(subscribe()))
    return createMemo(() => cutOffByCard()[cardId()])
}

export function isCardTerminalAvailable(): boolean {
    return Boolean(agentBindings()?.OpenCardTerminal)
}

// openCardTerminalWindow is the way to a terminal from anywhere that has no
// room to draw one — the board. It lives here rather than in the panel beside
// the card so that a board does not import the panel, and with it the emulator's
// stylesheet, to open a window.
//
// A live terminal is shown by its id, not reopened by its card: the card's
// terminal is the conversation of the stage it stands on, and the live CLI may
// belong to a passed stage still running, so "the card's terminal" would start
// a second one beside it.
//
// It answers false when Go refused for want of a folder. A window has no way to
// ask anything, so that question belongs to the panel beside the card, and the
// caller opens the card rather than a CLI in a directory nobody chose.
export async function openCardTerminalWindow(cardId: string, terminalId?: string): Promise<boolean> {
    const bindings = agentBindings()
    let handle: {windowed?: boolean, url?: string} | null = null
    try {
        if (terminalId && bindings?.ShowTerminal) {
            handle = JSON.parse(await bindings.ShowTerminal(terminalId))
        } else if (bindings?.OpenCardTerminal) {
            handle = JSON.parse(await bindings.OpenCardTerminal(cardId, '', '', true))
        }
    } catch (e) {
        return false
    }

    // The desktop app has already opened the window by now; a server build has
    // no windows, so the browser opens a tab instead.
    if (handle && !handle.windowed && handle.url) {
        window.open(handle.url, '_blank', 'noopener')
    }
    return true
}
