import {For, Show, createMemo, createSignal} from 'solid-js'

import {useIntl} from '../../intl'

import CompassIcon from '../../widgets/icons/compassIcon'

import {useAppSelector} from '../../store/hooks'
import {getMe} from '../../store/users'
import {getTeamMode} from '../../store/clientConfig'
import {getUserBlockSubscriptions} from '../../store/initialLoad'
import {getCards} from '../../store/cards'
import {getBoards} from '../../store/boards'
import {IUser} from '../../user'
import {Subscription} from '../../wsclient'

import {
    Attention,
    ackWait,
    agentNotificationsOn,
    attentionHeading,
    keyOf,
    openWait,
    useAttention,
} from './attention'
import AttentionAnswers from './attentionAnswers'

import {waitAudience, waitIsMine} from './attentionAudience'

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
// the card's terminal, and that is where the answer belongs — a copy of the
// question with our own buttons under it is a second interface for one
// exchange, and the one that cannot show what the agent has already drawn. So
// this carries what is being asked and one way to act on it: open the terminal.
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
// The stack is outside the router, so it follows a person wherever they are in
// the app — and a terminal window is the app too. It belongs to the window with
// the board in it: drawn in a terminal window it announces the same wait twice,
// and the copy drawn over the terminal it is *about* covers the question with a
// box saying there is one (the reason nothing of ours is drawn on that screen —
// terminalPage.tsx).
//
// Read once rather than watched: a window opened on a terminal stays on it, and
// the board's window never navigates there — the button opens a window of its
// own.
const terminalScreen = (): boolean => (/^\/(acp|m)\/terminal\//).test(window.location.pathname)

const AttentionNotifications = () => {
    const intl = useIntl()
    const waiting = useAttention()
    const [busy, setBusy] = createSignal('')

    // Whose wait this is. On an install of one person the question does not
    // arise; in a team a box saying "an agent is waiting" about somebody else's
    // card is the noise this is meant to be the opposite of
    // (attentionAudience.ts, docs/teamwork.md).
    const teamMode = useAppSelector<boolean>(getTeamMode)
    const me = useAppSelector<IUser|null>(getMe)
    const cards = useAppSelector(getCards)
    const boards = useAppSelector(getBoards)
    const following = useAppSelector<Subscription[]>(getUserBlockSubscriptions)

    const mine = (a: Attention): boolean => waitIsMine({
        teamMode: teamMode(),
        myId: me()?.id,
        audience: waitAudience(a.cardId ? cards()[a.cardId] : undefined, a.boardId ? boards()[a.boardId] : undefined),
        following: Boolean(a.cardId) && following().some((s) => s.blockId === a.cardId),
    })

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
            if (!a.acked && mine(a)) {
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
