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
// Only running terminals are in here. A card whose worktree could be resumed is
// not news on a board; a CLI working right now is.

const [byCard, setByCard] = createSignal<Record<string, string>>({})

// Consumers are counted rather than assumed, as in attention.ts: the
// subscription is worth holding only while a board displays it.
let consumers = 0
let unsubscribe: (() => void) | undefined

async function reload(): Promise<void> {
    const bindings = agentBindings()
    if (!bindings?.ListTerminals) {
        setByCard({})
        return
    }
    try {
        const list = (JSON.parse(await bindings.ListTerminals()) || []) as Array<{id: string, cardId?: string}>
        const next: Record<string, string> = {}
        for (const terminal of list) {
            if (terminal.cardId) {
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
        reload()
    }
    return () => {
        consumers--
        if (consumers === 0) {
            unsubscribe?.()
            unsubscribe = undefined
            setByCard({})
        }
    }
}

// useCardTerminal is the terminal running on one card, for as long as the
// component asking lives — the id, so whoever shows it can say which one.
export function useCardTerminal(cardId: Accessor<string>): Accessor<string | undefined> {
    onMount(() => onCleanup(subscribe()))
    return createMemo(() => byCard()[cardId()])
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
// be a passed stage's still running — opening "the card's terminal" would
// start a second one beside it instead of showing the one the dot is for.
export async function openCardTerminalWindow(cardId: string, terminalId?: string): Promise<void> {
    const bindings = agentBindings()
    let handle: {windowed?: boolean, url?: string} | null = null
    if (terminalId && bindings?.ShowTerminal) {
        handle = JSON.parse(await bindings.ShowTerminal(terminalId))
    } else if (bindings?.OpenCardTerminal) {
        handle = JSON.parse(await bindings.OpenCardTerminal(cardId, '', '', true))
    }

    // The desktop app has already opened the window by now; a server build has
    // no windows, so the browser opens a tab instead.
    if (handle && !handle.windowed && handle.url) {
        window.open(handle.url, '_blank', 'noopener')
    }
}
