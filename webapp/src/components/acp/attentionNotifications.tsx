import {For, Show, createMemo, createSignal} from 'solid-js'

import {useIntl} from '../../intl'

import {
    Attention,
    agentNotificationsOn,
    answerQuestion,
    attentionHeading,
    keyOf,
    useAttention,
} from './attention'

import './attentionNotifications.scss'

// Being told, rather than having to look.
//
// An agent works on a card in a window nobody is watching, and now and then it
// needs a person: a tool it was not given, or a decision only somebody with the
// product in their head can make. The card grows a dot for that, but a dot is
// only seen by somebody already looking at the board — so the question says
// itself, here, and is answered here too. Its turn is open the whole time; the
// agent carries on the moment an answer arrives.
//
// It is a setting because it interrupts: a person who would rather find out by
// looking turns it off, and the card keeps its dot.

// stackLimit is how many waits are worth showing at once. Beyond that they stop
// being a notification and become a wall, so the rest are counted instead.
const stackLimit = 3

// A dismissal is of one wait, not of one card: the same agent asking again is a
// new question, and a person who waved the last one away still wants to hear
// about this one. "Since" is what tells the two apart.
const waitKey = (target: Attention) => `${keyOf(target)}@${target.since || ''}`

const AttentionNotifications = () => {
    const intl = useIntl()
    const waiting = useAttention()
    const [dismissed, setDismissed] = createSignal<string[]>([])
    const [typed, setTyped] = createSignal<Record<string, string>>({})
    const [busy, setBusy] = createSignal('')

    const pending = createMemo(() => (agentNotificationsOn() ? waiting().filter((a) => !dismissed().includes(waitKey(a))) : []))
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

    const answer = async (target: Attention, optionId: string) => {
        setBusy(waitKey(target))
        try {
            await answerQuestion(target, optionId, optionId ? '' : (typed()[waitKey(target)] || ''))
        } finally {
            setBusy('')
        }
    }

    return (
        <Show when={shown().length > 0}>
            <div class='AttentionNotifications'>
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

                                <Show when={target.reason === 'question'}>
                                    <span class='AttentionNotifications__question'>{target.text}</span>
                                    <div class='AttentionNotifications__options'>
                                        <For each={target.options || []}>
                                            {(option) => (
                                                <button
                                                    type='button'
                                                    class='AttentionNotifications__option'
                                                    title={option.description}
                                                    disabled={busy() === waitKey(target)}
                                                    onClick={() => answer(target, option.id)}
                                                >
                                                    {option.label}
                                                </button>
                                            )}
                                        </For>
                                    </div>
                                    <Show when={target.freeText}>
                                        <form
                                            class='AttentionNotifications__free'
                                            onSubmit={(e) => {
                                                e.preventDefault()
                                                answer(target, '')
                                            }}
                                        >
                                            <input
                                                type='text'
                                                placeholder={intl.formatMessage({id: 'Attention.free-text', defaultMessage: 'Answer in your own words…'})}
                                                value={typed()[waitKey(target)] || ''}
                                                onInput={(e) => setTyped((current) => ({...current, [waitKey(target)]: e.currentTarget.value}))}
                                            />
                                            <button
                                                type='submit'
                                                class='AttentionNotifications__option'
                                                disabled={!typed()[waitKey(target)]}
                                            >
                                                {intl.formatMessage({id: 'Attention.send', defaultMessage: 'Send'})}
                                            </button>
                                        </form>
                                    </Show>
                                </Show>
                            </div>
                            <button
                                type='button'
                                class='AttentionNotifications__close'
                                title={intl.formatMessage({id: 'Attention.dismiss', defaultMessage: 'Dismiss'})}
                                aria-label={intl.formatMessage({id: 'Attention.dismiss', defaultMessage: 'Dismiss'})}
                                onClick={() => dismiss(target)}
                            >
                                {'×'}
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
