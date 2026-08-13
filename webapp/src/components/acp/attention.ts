// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {Accessor, createMemo, createSignal, onCleanup, onMount} from 'solid-js'

import {UserSettings} from '../../userSettings'

import {agentBindings} from './bindings'
import {onAgentEvent} from './agentEvents'
import {openCardTerminalWindow} from './liveTerminals'

// Which cards are waiting for a person.
//
// A card whose agent is waiting looks exactly like a card whose agent is busy,
// and the answer waits until somebody happens to look. This keeps what the Go
// side says in one place, so every card on the board shares one subscription
// and one initial load rather than asking for itself.

// The two ways an agent asks for a person. 'question' is ACP itself — a deploy
// or a test asked for a tool it was not given, or sent an elicitation, and its
// turn is open until somebody answers. 'terminal' is a stage of a route whose
// CLI has stopped drawing: it is asking something inside its own interface, and
// only it knows what.
//
// Neither is answered here any more. The agent draws its question where it is
// working, and what this side offers is the way to it.
export type AttentionReason = 'question' | 'terminal'

export type QuestionOption = {
    id: string
    label: string
    description?: string
    kind?: string
}

export type Attention = {
    key: string
    terminalId?: string
    cardId?: string
    boardId?: string
    title?: string
    agent?: string
    reason: AttentionReason
    tool?: string

    // A question carries itself, so it can be answered where it is read.
    questionId?: string
    text?: string
    options?: QuestionOption[]
    freeText?: boolean
    awaiting: boolean
    since?: string
}

// keyOf is what identifies one wait — the Go side fills it in, and this is the
// same rule for anything that arrives without one. A question is keyed by its
// own id, because an agent can have two open on one card and answering one must
// not take the other off the screen.
export const keyOf = (a: Attention): string => {
    if (a.key) {
        return a.key
    }
    if (a.terminalId) {
        return a.terminalId
    }
    return a.questionId ? `q:${a.questionId}` : `card:${a.cardId}`
}

const [waiting, setWaiting] = createSignal<Attention[]>([])

// Consumers are counted rather than assumed: the subscription is worth holding
// only while something displays it, and a test that unmounts everything gets a
// clean module back.
let consumers = 0
let unsubscribe: (() => void) | undefined

function apply(payload: Attention): void {
    if (!payload?.terminalId && !payload?.cardId) {
        return
    }
    setWaiting((current) => {
        const rest = current.filter((a) => keyOf(a) !== keyOf(payload))
        if (!payload.awaiting) {
            return rest
        }
        return [...rest, payload].sort((a, b) => (a.since || '').localeCompare(b.since || ''))
    })
}

async function reload(): Promise<void> {
    const bindings = agentBindings()
    if (!bindings?.ListAttention) {
        return
    }
    try {
        setWaiting(JSON.parse(await bindings.ListAttention()) || [])
    } catch {
        // Nothing waiting is the right answer when nothing can be asked.
        setWaiting([])
    }
}

function subscribe(): () => void {
    consumers++
    if (consumers === 1) {
        // No payload means the socket has just (re)connected and nobody knows
        // what was missed while it was down — which for a question waiting to
        // be answered is exactly the wrong thing to be wrong about, so the
        // whole list is fetched again.
        unsubscribe = onAgentEvent('acp:attention', (payload?: Attention) => (payload ? apply(payload) : reload()))
        reload()
    }
    return () => {
        consumers--
        if (consumers === 0) {
            unsubscribe?.()
            unsubscribe = undefined
            setWaiting([])
        }
    }
}

// useAttention gives a component everything waiting for a person, oldest wait
// first, and keeps it current for as long as the component lives.
export function useAttention(): Accessor<Attention[]> {
    onMount(() => onCleanup(subscribe()))
    return waiting
}

// useCardAttention is the same thing asked about one card — what a card on the
// board shows an indicator for.
export function useCardAttention(cardId: Accessor<string>): Accessor<Attention | undefined> {
    onMount(() => onCleanup(subscribe()))
    return createMemo(() => waiting().find((a) => a.cardId === cardId()))
}

// openWait goes to where the agent is asking, which is the only thing to do
// about a wait now: the terminal it is waiting in, by id when the wait names
// one, else the card's own.
export async function openWait(target: Attention): Promise<void> {
    await openCardTerminalWindow(target.cardId || '', target.terminalId)
}

type Formatter = {
    formatMessage: (descriptor: {id: string, defaultMessage: string}, values?: Record<string, string>) => string
}

// attentionHeading is the one sentence a wait is worth, wherever it is shown —
// the dot's tooltip, the notification, the card.
export function attentionHeading(intl: Formatter, target: Attention): string {
    const agent = target.agent || ''
    return agent ? intl.formatMessage({id: 'Attention.asking-agent', defaultMessage: '{agent} is asking'}, {agent}) : intl.formatMessage({id: 'Attention.asking', defaultMessage: 'The agent is asking'})
}

// Whether being told about it at all is wanted. The indicator on a card is
// always there — it is part of the card — but a notification interrupts, so it
// is a setting, and one the notifications have to see change without a reload.
const [notificationsOn, setNotificationsOn] = createSignal(UserSettings.agentNotifications)

export const agentNotificationsOn: Accessor<boolean> = notificationsOn

export function setAgentNotifications(on: boolean): void {
    UserSettings.agentNotifications = on
    setNotificationsOn(on)
}
