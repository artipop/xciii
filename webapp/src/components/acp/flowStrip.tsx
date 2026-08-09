// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onCleanup, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {agentBindings} from './bindings'
import {onAgentEvent} from './agentEvents'

import './flowStrip.scss'

// Where the card is on its route, on the card itself. Until now this could only
// be reconstructed by reading the comments backwards, which is a poor way to
// answer the one question a stalled card raises: what is it waiting for?

export type CardFlowStage = {
    nodeId: string
    column: string
    action: string
    crew?: string[]
    current: boolean
    done: boolean
}

export type CardFlow = {
    flow: string
    stages: CardFlowStage[]
    currentNodeId: string
    since?: string
    branch?: string
    waitingFor?: string[]
    queued?: boolean
    running?: boolean
}

export function isFlowStripAvailable(): boolean {
    return Boolean(agentBindings()?.GetCardFlow)
}

// waited says how long the card has stood where it stands, in the units a
// person would use out loud. The number and the unit are kept apart so the
// wording stays translatable.
export function waited(since: string | undefined, now: number): {value: number, unit: string} | null {
    if (!since) {
        return null
    }
    const started = Date.parse(since)
    if (isNaN(started)) {
        return null
    }
    const minutes = Math.max(0, Math.floor((now - started) / 60000))
    if (minutes < 60) {
        return {value: minutes, unit: 'minutes'}
    }
    const hours = Math.floor(minutes / 60)
    if (hours < 24) {
        return {value: hours, unit: 'hours'}
    }
    return {value: Math.floor(hours / 24), unit: 'days'}
}

type Props = {
    cardId: string
}

const FlowStrip = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()
    const [flow, setFlow] = createSignal<CardFlow | null>(null)

    const refresh = async () => {
        if (!bindings?.GetCardFlow) {
            return
        }
        try {
            setFlow(JSON.parse(await bindings.GetCardFlow(props.cardId)))
        } catch (e) {
            setFlow(null)
        }
    }

    onMount(() => {
        refresh()

        // A session starting, finishing or moving the card changes the answer.
        const off = onAgentEvent('acp:session', () => refresh())
        onCleanup(() => off?.())
    })

    const since = () => {
        const age = waited(flow()?.since, Date.now())
        return age === null ? '' : sinceLabel(intl as Parameters<typeof sinceLabel>[0], age)
    }
    const status = () => {
        if (flow()?.running) {
            return intl.formatMessage({id: 'FlowStrip.running', defaultMessage: 'working now'})
        }
        if (flow()?.queued) {
            return intl.formatMessage({id: 'FlowStrip.queued', defaultMessage: 'waiting for a free place in the column'})
        }
        const waitingFor = flow()?.waitingFor
        if (waitingFor && waitingFor.length > 0) {
            return intl.formatMessage({id: 'FlowStrip.waiting', defaultMessage: 'waiting: {events}'}, {events: waitingFor.join(', ')})
        }
        return intl.formatMessage({id: 'FlowStrip.idle', defaultMessage: 'nothing to wait for here — the card moves on by hand'})
    }

    return (
        <Show when={flow() && flow()!.stages.length > 0}>
            <div class='FlowStrip'>
                <div class='FlowStrip__head'>
                    <span class='FlowStrip__name'>{flow()!.flow}</span>
                    <Show when={flow()!.branch}>
                        <span class='FlowStrip__branch'>{flow()!.branch}</span>
                    </Show>
                </div>
                <div class='FlowStrip__stages'>
                    <For each={flow()!.stages}>
                        {(stage) => (
                            <span
                                class={`FlowStrip__stage${stage.current ? ' FlowStrip__stage--current' : ''}${stage.done ? ' FlowStrip__stage--done' : ''}`}
                                title={stage.crew && stage.crew.length > 0 ? stage.crew.join(', ') : ''}
                            >{stage.column}</span>
                        )}
                    </For>
                </div>
                <div class='FlowStrip__status'>
                    {status()}
                    {since() && ` · ${since()}`}
                </div>
            </div>
        </Show>
    )
}

// sinceLabel is "for 20 minutes" in the reader's language.
function sinceLabel(
    intl: {formatMessage: (d: {id: string, defaultMessage: string}, v?: Record<string, unknown>) => string},
    age: {value: number, unit: string},
): string {
    switch (age.unit) {
    case 'hours':
        return intl.formatMessage({id: 'FlowStrip.hours', defaultMessage: '{value} h'}, {value: age.value})
    case 'days':
        return intl.formatMessage({id: 'FlowStrip.days', defaultMessage: '{value} d'}, {value: age.value})
    default:
        return intl.formatMessage({id: 'FlowStrip.minutes', defaultMessage: '{value} min'}, {value: age.value})
    }
}

export default FlowStrip
