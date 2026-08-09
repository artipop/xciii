// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {Accessor, createMemo, createSignal, onCleanup, onMount} from 'solid-js'

import {UserSettings} from '../../userSettings'

import {agentBindings} from './bindings'
import {onAgentEvent} from './agentEvents'

// Which cards are waiting for a person.
//
// A card whose agent is waiting looks exactly like a card whose agent is busy,
// and the answer waits until somebody happens to look. This keeps what the Go
// side says in one place, so every card on the board shares one subscription
// and one initial load rather than asking for itself.

// The one way an agent asks for a person: ACP itself — the session asked for a
// tool it was not given, or sent an elicitation, and its turn is open until
// somebody answers. A terminal used to be the second way, through silence, and
// silence could not be told from a CLI sitting at its prompt: a terminal opened
// and left alone announced itself five seconds later. The window is in front of
// whoever opened it; only the protocol asks now.
export type AttentionReason = 'question'

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

// answerQuestion hands the agent what it is waiting for. Both empty is a
// refusal, which is an answer too: the agent carries on without it.
export async function answerQuestion(target: Attention, optionId: string, text: string): Promise<void> {
    const bindings = agentBindings()
    if (!bindings?.AnswerQuestion || !target.questionId) {
        return
    }
    await bindings.AnswerQuestion(target.questionId, optionId, text)
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
