// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onCleanup, onMount} from 'solid-js'
import {useNavigate} from '@solidjs/router'

import {useIntl} from '../../intl'
import type {IntlShape} from '../../intl'
import {agentBindings} from '../../components/acp/agentProjectsDialog'
import {onAgentEvent} from '../../components/acp/agentEvents'
import {
    Attention,
    answerQuestion,
    attentionHeading,
    keyOf,
    useAttention,
} from '../../components/acp/attention'

import {BindingBoard, BindingCard, listBoards, listInbox} from '../../bindings/boards'
import MobileInbox from './mobileInbox'
import MobileCards from './mobileCards'

import './mobilePage.scss'

// The board on a phone, and deliberately not the board.
//
// A phone is not where columns are dragged or a description is written. It is
// where you find out that something arrived or that an agent is stuck, and do
// the one thing that settles it. So the page is four screens and a row of
// buttons at the bottom, which is where a thumb reaches:
//
//   «Входящие»  — what a source left and nobody has looked at, moved onto a
//                 board from here, which is the whole point of an inbox;
//   «Карточки»  — one board's cards as a list, to find out where something got
//                 to without walking to the desk;
//   «Ждут»      — what is asking for a person, answered in place, because a
//                 question carries its own options;
//   «Терминалы» — which are alive, so the one that went quiet can be typed in.
//
// «Ждут» is what opens, because it is the only one of the four that cannot
// wait; the others say how many are there on their own button.
//
// It needs nothing from the board's own API: everything on it comes from the
// bindings, which the front door serves to a phone exactly as it serves them to
// the window (main.App.* over /wails/runtime) — including the board itself, see
// bindings/boards.ts. What it does need besides is the event socket, since the
// Wails bus does not leave the machine — see components/acp/agentEvents.

type Tab = 'inbox' | 'cards' | 'waiting' | 'terminals'

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
    const [tab, setTab] = createSignal<Tab>('waiting')

    // The inbox and the boards are read here rather than inside the tab that
    // shows them, because the number on a tab has to be right before anybody
    // opens it — a tab that only counts once you are looking at it counts
    // nothing. The boards are read once and lent to both tabs that need them.
    const [inbox, setInbox] = createSignal<BindingCard[]>([])
    const [boards, setBoards] = createSignal<BindingBoard[]>([])

    const refreshInbox = async () => setInbox(await listInbox())

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
        refreshInbox()
        listBoards().then(setBoards)
        const off = onAgentEvent('acp:terminal', () => refreshTerminals())

        // A card being written is a card that may have arrived, so the event
        // that redraws a board also asks the inbox to look again.
        const offSession = onAgentEvent('acp:session', () => {
            refreshTerminals()
            refreshInbox()
        })
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

            <Show when={tab() === 'inbox'}>
                <MobileInbox
                    cards={inbox()}
                    boards={boards()}
                    onMoved={refreshInbox}
                />
            </Show>

            <Show when={tab() === 'cards'}>
                <MobileCards boards={boards()}/>
            </Show>

            <Show when={tab() === 'waiting'}>
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
            </Show>

            <Show when={tab() === 'terminals'}>
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
            </Show>

            {/* The row of buttons is at the bottom because that is where a
                thumb is, and it is fixed because the lists above it scroll. */}
            <nav class='MobilePage__tabs'>
                <For each={tabs(intl, inbox().length, waiting().length, terminals().length)}>
                    {(entry) => (
                        <button
                            type='button'
                            class={`MobilePage__tab${tab() === entry.id ? ' MobilePage__tab--on' : ''}`}
                            aria-current={tab() === entry.id}
                            onClick={() => setTab(entry.id)}
                        >
                            <span class='MobilePage__tab-name'>{entry.name}</span>
                            <Show when={entry.count > 0}>
                                <span class='MobilePage__tab-count'>{entry.count}</span>
                            </Show>
                        </button>
                    )}
                </For>
            </nav>
        </div>
    )
}

// tabs is the bar, in the order things happen: something arrives, it becomes a
// card, an agent asks about it, and a terminal is where you answer by hand.
// Each carries how many are behind it, so a tab that is not open can still say
// that it wants attention.
function tabs(intl: IntlShape, inbox: number, waiting: number, terminals: number) {
    return [
        {id: 'inbox' as Tab, name: intl.formatMessage({id: 'Mobile.inbox', defaultMessage: 'Inbox'}), count: inbox},
        {id: 'cards' as Tab, name: intl.formatMessage({id: 'Mobile.cards', defaultMessage: 'Cards'}), count: 0},
        {id: 'waiting' as Tab, name: intl.formatMessage({id: 'Mobile.waiting-tab', defaultMessage: 'Waiting'}), count: waiting},
        {id: 'terminals' as Tab, name: intl.formatMessage({id: 'Mobile.terminals', defaultMessage: 'Terminals'}), count: terminals},
    ]
}

export default MobilePage
