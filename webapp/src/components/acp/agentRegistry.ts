// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {createSignal} from 'solid-js'

import {agentBindings} from './bindings'

// How many agents this machine has registered, asked once for the whole page.
//
// It answers one question, and the whole agent surface hangs off it: whether to
// offer a terminal at all. A board of household chores is a board, and the
// integration being compiled in is not a reason to put an agent on it — so a
// machine with an empty registry is offered nothing, anywhere.
//
// Every card would otherwise ask it for itself, which is one call to Go per
// card opened for an answer that belongs to the machine and changes when
// somebody edits the settings, not when a card is opened.

const [known, setKnown] = createSignal<number | undefined>(undefined)
let inflight: Promise<void> | undefined

// undefined until Go has answered: nothing is drawn on a guess, so the terminal
// button neither flashes into being nor offers what cannot be opened.
export const registeredAgents = known

export function refreshRegisteredAgents(): Promise<void> {
    const bindings = agentBindings()
    if (!bindings?.ListAgents) {
        setKnown(0)
        return Promise.resolve()
    }
    if (!inflight) {
        inflight = (async () => {
            try {
                const list = (JSON.parse(await bindings.ListAgents!()) || []) as unknown[]
                setKnown(list.length)
            } catch (e) {
                setKnown(0)
            } finally {
                inflight = undefined
            }
        })()
    }
    return inflight
}
