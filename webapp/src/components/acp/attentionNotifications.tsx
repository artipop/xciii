import {For, Show, createMemo, createSignal} from 'solid-js'

import {useIntl} from '../../intl'

import CompassIcon from '../../widgets/icons/compassIcon'

import AttentionAnswers from './attentionAnswers'

import {
    Attention,
    ackWait,
    agentNotificationsOn,
    attentionHeading,
    keyOf,
    openWait,
    useAttention,
} from './attention'

import './attentionNotifications.scss'

// Being told, rather than having to look.
//
// An agent works on a card in a window nobody is watching, and now and then it
// needs a person: a decision only somebody with the product in their head can
// make, or permission for something it was not given. The card grows an amber
// button for that, but a button is only seen by somebody already looking at the
// board — so the wait says itself, here.
//
// It says it and does not answer it. The agent is asking inside its own CLI, in
// the card's terminal, and that is where the answer belongs: a copy of the
// question with a row of our buttons under it was a second interface for one
// exchange, and the one that could not show what the agent had already drawn on
// the screen. So this carries what is being asked and one way to act on it —
// open the terminal.
//
// It is a setting because it interrupts: a person who would rather find out by
// looking turns it off, and the card keeps its button.

// stackLimit is how many waits are worth showing at once. Beyond that they stop
// being a notification and become a wall, so the rest are counted instead.
const stackLimit = 3

// Being told is a thing that happens once, and what remembers that is the Go
// side (attention.ts, internal/acp/attentionack.go) — not a list kept here.
//
// It was kept here, keyed by the wait and when it was raised, and that was the
// spam: a stage's wait is the CLI drawing nothing, opening the terminal to look
// at it makes the CLI redraw, so the wait ended and was raised again forty-five
// seconds later under a timestamp this page had never dismissed. Going to look
// at an agent guaranteed a fresh notification about it a minute afterwards, for
// as long as the agent stood there. A list in one page was wrong twice over
// besides: the board's window, a second window and the phone each drew their own
// copy, and a reload brought back everything a person had already dealt with.

// terminalScreen is a window that draws one terminal and nothing else — the
// desktop app's own, and «Терминалы» on a phone.
//
// This stack is outside the router, which is what puts it wherever in the app a
// person happens to be — and a terminal window is the app too, so every one of
// them drew the whole stack as well. Two conversations waiting meant the same
// notification in the board's window and in each terminal window: it read as
// the first one being announced twice.
//
// One of those copies was worse than a repeat. A terminal window drawing «агент
// ждёт ответа» about the terminal it is *showing* covers the question with a
// box saying there is one — the same reason nothing of ours is drawn over that
// screen (terminalPage.tsx). So the stack belongs to the window with the board
// in it, and a terminal window is left to draw the CLI.
//
// Read once rather than watched: a window opened on a terminal stays on it, and
// the board's window never navigates there — the button opens a window of its
// own.
const terminalScreen = (): boolean => (/^\/(acp|m)\/terminal\//).test(window.location.pathname)

const AttentionNotifications = () => {
    const intl = useIntl()
    const waiting = useAttention()
    const [busy, setBusy] = createSignal('')

    // Deduped by what identifies a wait, not by the object: the list is rebuilt
    // from events and from a full reload when the socket reconnects, and one
    // wait drawn twice is the notification a person cannot tell from a second
    // agent asking the same thing.
    const pending = createMemo(() => {
        if (!agentNotificationsOn() || terminalScreen()) {
            return []
        }
        const byKey = new Map<string, Attention>()
        for (const a of waiting()) {
            if (!a.acked) {
                byKey.set(keyOf(a), a)
            }
        }
        return [...byKey.values()]
    })
    const shown = createMemo(() => pending().slice(0, stackLimit))
    const hidden = createMemo(() => Math.max(0, pending().length - stackLimit))

    // Going to the terminal is the whole of what this offers, and it counts as
    // having been told: somebody now looking at the agent does not need a box
    // saying it is there.
    const open = async (target: Attention) => {
        setBusy(keyOf(target))
        try {
            await openWait(target)
            await ackWait(target)
        } finally {
            setBusy('')
        }
    }

    return (
        <Show when={shown().length > 0}>
            <div class='AttentionNotifications'>
                {/* Said once, above the stack, as soon as there is more than
                    one: two cards waiting used to be two cards' worth of
                    notification with nothing saying they were two. */}
                <Show when={pending().length > 1}>
                    <div class='AttentionNotifications__count'>
                        {intl.formatMessage({id: 'Attention.waiting-count', defaultMessage: '{count, plural, one {# agent is waiting} other {# agents are waiting}}'}, {count: pending().length})}
                    </div>
                </Show>
                {/* The waits scroll inside the stack rather than the stack
                    growing past the top of the window: a question carries its
                    own answers, so two or three of them are already taller than
                    a laptop screen, and what ran off the top was the oldest
                    wait — the one that has gone unanswered longest. */}
                <div class='AttentionNotifications__list'>
                    <For each={shown()}>
                        {(target) => (
                            <div
                                class='AttentionNotifications__item'
                                role='alert'
                            >
                                <div class='AttentionNotifications__body'>
                                    <span class='AttentionNotifications__heading'>
                                        {attentionHeading(intl, target)}
                                    </span>
                                    <span class='AttentionNotifications__card'>
                                        {target.title || intl.formatMessage({id: 'Attention.untitled', defaultMessage: 'Untitled card'})}
                                    </span>

                                    <Show when={target.text}>
                                        <span class='AttentionNotifications__question'>{target.text}</span>
                                    </Show>

                                    {/* A question the agent's CLI asked through its
                                        permission hook can be answered here — the
                                        CLI's own box is on its screen at the same
                                        time, so this is a second place to answer
                                        rather than the only one (attentionAnswers). */}
                                    <AttentionAnswers target={target}/>
                                    <button
                                        type='button'
                                        class='AttentionNotifications__action'
                                        disabled={busy() === keyOf(target)}
                                        onClick={() => open(target)}
                                    >
                                        {intl.formatMessage({id: 'Attention.open', defaultMessage: 'Open the terminal'})}
                                    </button>
                                </div>
                                <button
                                    type='button'
                                    class='AttentionNotifications__close'
                                    title={intl.formatMessage({id: 'Attention.dismiss', defaultMessage: 'Dismiss'})}
                                    aria-label={intl.formatMessage({id: 'Attention.dismiss', defaultMessage: 'Dismiss'})}
                                    onClick={() => ackWait(target)}
                                >
                                    <CompassIcon icon='close'/>
                                </button>
                            </div>
                        )}
                    </For>
                </div>
                <Show when={hidden() > 0}>
                    <div class='AttentionNotifications__more'>
                        {intl.formatMessage({id: 'Attention.more', defaultMessage: '…and {count} more waiting'}, {count: hidden()})}
                    </div>
                </Show>
            </div>
        </Show>
    )
}

export default AttentionNotifications
