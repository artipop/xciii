// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onCleanup, onMount} from 'solid-js'
import {useNavigate} from '@solidjs/router'

import {useIntl} from '../../intl'
import {agentBindings} from '../../components/acp/agentProjectsDialog'
import {onAgentEvent} from '../../components/acp/agentEvents'
import {
    Attention,
    answerQuestion,
    attentionHeading,
    keyOf,
    useAttention,
} from '../../components/acp/attention'

import './mobilePage.scss'

// The board on a phone, and deliberately not the board.
//
// A phone is not where columns are dragged or a description is written; it is
// where you find out that an agent is stuck and unstick it. So this page is
// the two things that cannot wait: what is asking for a person — answered
// here, in place, because a question carries its own options — and which
// terminals are alive, so the one that has gone quiet can be typed into.
//
// It needs nothing from the board API: everything on it comes from the agent
// bindings, which the front door serves to a phone exactly as it serves them
// to the window (main.App.* over /wails/runtime). What it does need is the
// event socket, since the Wails bus does not leave the machine — see
// components/acp/agentEvents.

type Terminal = {
    id: string
    cardId?: string
    title?: string
    agent: string
    branch?: string
    running: boolean
}

const MobilePage = () => {
    const intl = useIntl()
    const navigate = useNavigate()
    const waiting = useAttention()
    const [terminals, setTerminals] = createSignal<Terminal[]>([])
    const [typed, setTyped] = createSignal<Record<string, string>>({})
    const [busy, setBusy] = createSignal('')

    const refreshTerminals = async () => {
        const bindings = agentBindings()
        if (!bindings?.ListTerminals) {
            return
        }
        try {
            setTerminals(JSON.parse(await bindings.ListTerminals()) || [])
        } catch {
            // An app that cannot say what is running says nothing.
            setTerminals([])
        }
    }

    onMount(() => {
        refreshTerminals()
        const off = onAgentEvent('acp:terminal', () => refreshTerminals())
        const offSession = onAgentEvent('acp:session', () => refreshTerminals())
        onCleanup(() => {
            off()
            offSession()
        })
    })

    const answer = async (target: Attention, optionId: string) => {
        setBusy(keyOf(target))
        try {
            await answerQuestion(target, optionId, optionId ? '' : (typed()[keyOf(target)] || ''))
        } finally {
            setBusy('')
        }
    }

    // A terminal that exists is reached by its address alone — no binding call,
    // and no window opening on a desktop nobody is sitting at.
    const openTerminal = (terminalId: string) => navigate(`/m/terminal/${terminalId}`)

    return (
        <div class='MobilePage'>
            <header class='MobilePage__header'>
                <span class='MobilePage__wordmark'>{'XCIII'}</span>
                <span class='MobilePage__subtitle'>
                    {intl.formatMessage({id: 'Mobile.subtitle', defaultMessage: 'What needs you'})}
                </span>
            </header>

            <section class='MobilePage__section'>
                <h2 class='MobilePage__heading'>
                    {intl.formatMessage({id: 'Mobile.waiting', defaultMessage: 'Waiting for an answer'})}
                </h2>
                <Show
                    when={waiting().length > 0}
                    fallback={
                        <p class='MobilePage__empty'>
                            {intl.formatMessage({id: 'Mobile.nothing-waiting', defaultMessage: 'Nothing is waiting. The agents are working.'})}
                        </p>
                    }
                >
                    <For each={waiting()}>
                        {(target) => (
                            <article class='MobilePage__item'>
                                <span class='MobilePage__who'>{attentionHeading(intl, target)}</span>
                                <span class='MobilePage__card'>
                                    {target.title || intl.formatMessage({id: 'Attention.untitled', defaultMessage: 'Untitled card'})}
                                </span>

                                <Show when={target.reason === 'question'}>
                                    <p class='MobilePage__question'>{target.text}</p>
                                    <div class='MobilePage__options'>
                                        <For each={target.options || []}>
                                            {(option) => (
                                                <button
                                                    type='button'
                                                    class='MobilePage__option'
                                                    disabled={busy() === keyOf(target)}
                                                    onClick={() => answer(target, option.id)}
                                                >
                                                    {option.label}
                                                </button>
                                            )}
                                        </For>
                                    </div>
                                    <Show when={target.freeText}>
                                        <form
                                            class='MobilePage__free'
                                            onSubmit={(e) => {
                                                e.preventDefault()
                                                answer(target, '')
                                            }}
                                        >
                                            <input
                                                type='text'
                                                placeholder={intl.formatMessage({id: 'Attention.free-text', defaultMessage: 'Answer in your own words…'})}
                                                value={typed()[keyOf(target)] || ''}
                                                onInput={(e) => setTyped((current) => ({...current, [keyOf(target)]: e.currentTarget.value}))}
                                            />
                                            <button
                                                type='submit'
                                                class='MobilePage__option'
                                                disabled={!typed()[keyOf(target)]}
                                            >
                                                {intl.formatMessage({id: 'Attention.send', defaultMessage: 'Send'})}
                                            </button>
                                        </form>
                                    </Show>
                                </Show>

                                <Show when={target.reason === 'quiet' && target.terminalId}>
                                    <button
                                        type='button'
                                        class='MobilePage__action'
                                        onClick={() => openTerminal(target.terminalId as string)}
                                    >
                                        {intl.formatMessage({id: 'Attention.open', defaultMessage: 'Open the terminal'})}
                                    </button>
                                </Show>
                            </article>
                        )}
                    </For>
                </Show>
            </section>

            <section class='MobilePage__section'>
                <h2 class='MobilePage__heading'>
                    {intl.formatMessage({id: 'Mobile.terminals', defaultMessage: 'Terminals'})}
                </h2>
                <Show
                    when={terminals().length > 0}
                    fallback={
                        <p class='MobilePage__empty'>
                            {intl.formatMessage({id: 'Mobile.no-terminals', defaultMessage: 'No terminal is running.'})}
                        </p>
                    }
                >
                    <For each={terminals()}>
                        {(terminal) => (
                            <button
                                type='button'
                                class='MobilePage__terminal'
                                onClick={() => openTerminal(terminal.id)}
                            >
                                <span class='MobilePage__who'>{terminal.agent}</span>
                                <span class='MobilePage__card'>
                                    {terminal.title || intl.formatMessage({id: 'Mobile.planning', defaultMessage: 'Planning'})}
                                </span>
                                <Show when={terminal.branch}>
                                    <code class='MobilePage__branch'>{terminal.branch}</code>
                                </Show>
                            </button>
                        )}
                    </For>
                </Show>
            </section>
        </div>
    )
}

export default MobilePage
