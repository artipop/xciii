// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal} from 'solid-js'

import {useIntl} from '../../intl'

import {Attention, ackWait} from './attention'
import {agentBindings} from './bindings'

import './attentionAnswers.scss'

// Answering the agent where the card is.
//
// This was taken off every screen once, and the reason it is back is that what
// arrives has changed. It used to be the only place an agent's question could be
// answered: a copy of the question with a row of our buttons under it, drawn
// over a terminal in which the agent had already drawn its own — a second
// interface for one exchange, and the one that could not show what the CLI had
// on the screen.
//
// Now the CLI keeps its own box. A stage's question reaches us through the
// vendor's permission hook (internal/acp/toolhook.go), and it was measured that
// the CLI draws its prompt at the same moment it asks us — so this is a second
// *place* to answer rather than a second interface: whoever is looking at the
// board answers here, whoever is looking at the terminal answers there, and the
// first answer wins. Nothing of ours covers the agent's screen, and nothing on
// this screen is the only way through.
//
// Which is also why a failure here is quiet. Not answering leaves the question
// exactly where it already was.

// Shared by the notification stack and «Ждут» on a phone, because they show the
// same wait and are the two surfaces that had already drifted apart once.
const AttentionAnswers = (props: {target: Attention}) => {
    const intl = useIntl()
    const [busy, setBusy] = createSignal('')
    const [failed, setFailed] = createSignal(false)

    const answer = async (optionId: string) => {
        const questionId = props.target.questionId
        if (!questionId) {
            return
        }
        setBusy(optionId)
        setFailed(false)
        try {
            await agentBindings()?.AnswerQuestion?.(questionId, optionId, '')

            // Answered is a stronger form of seen: the wait itself ends when the
            // agent hears back, and this takes the notification down now rather
            // than a round trip later.
            await ackWait(props.target)
        } catch {
            // The agent stopped waiting — its own box was answered, or it gave
            // up. Saying so is worth one line, because the button visibly did
            // nothing.
            setFailed(true)
        } finally {
            setBusy('')
        }
    }

    return (
        <Show when={props.target.questionId && (props.target.options || []).length > 0}>
            <div class='AttentionAnswers'>
                <For each={props.target.options}>
                    {(option) => (
                        <button
                            type='button'
                            class='AttentionAnswers__option'
                            classList={{'AttentionAnswers__option--deny': option.kind?.startsWith('reject')}}
                            disabled={busy() !== ''}
                            title={option.description}
                            onClick={() => answer(option.id)}
                        >
                            {option.label}
                        </button>
                    )}
                </For>
                <Show when={failed()}>
                    <span class='AttentionAnswers__gone'>
                        {intl.formatMessage({id: 'Attention.answer-gone', defaultMessage: 'The agent is no longer waiting for this answer'})}
                    </span>
                </Show>
            </div>
        </Show>
    )
}

export default AttentionAnswers
