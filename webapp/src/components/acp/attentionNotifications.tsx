import {For, Show, createMemo, createSignal} from 'solid-js'

import {useIntl} from '../../intl'

import CompassIcon from '../../widgets/icons/compassIcon'

import {
    Attention,
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

// A dismissal is of one wait, not of one card: the same agent asking again is a
// new question, and a person who waved the last one away still wants to hear
// about this one. "Since" is what tells the two apart.
const waitKey = (target: Attention) => `${keyOf(target)}@${target.since || ''}`

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
    const [dismissed, setDismissed] = createSignal<string[]>([])
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
            if (!dismissed().includes(waitKey(a))) {
                byKey.set(keyOf(a), a)
            }
        }
        return [...byKey.values()]
    })
    const shown = createMemo(() => pending().slice(0, stackLimit))
    const hidden = createMemo(() => Math.max(0, pending().length - stackLimit))

    const dismiss = (target: Attention) => {
        // Waits that are over cannot be shown again, so remembering that they
        // were waved away is only a list that grows.
        setDismissed((current) => [
            ...current.filter((key) => waiting().some((a) => waitKey(a) === key)),
            waitKey(target),
        ])
    }

    // Going to the terminal is the whole of what this offers, and it dismisses
    // the notification: somebody who is now looking at the agent has been told.
    const open = async (target: Attention) => {
        setBusy(waitKey(target))
        try {
            await openWait(target)
            dismiss(target)
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
                                <button
                                    type='button'
                                    class='AttentionNotifications__action'
                                    disabled={busy() === waitKey(target)}
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
                                onClick={() => dismiss(target)}
                            >
                                <CompassIcon icon='close'/>
                            </button>
                        </div>
                    )}
                </For>
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
