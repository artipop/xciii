import {For, Show, createSignal} from 'solid-js'

import {useIntl} from '../../intl'

import CompassIcon from '../../widgets/icons/compassIcon'

import './conversationRow.scss'

// One conversation in a list of them.
//
// Two screens list conversations — «Обсудить с агентом», where they have no
// card behind them, and the panel beside a card, where they are the card's own
// and its route's — and they list the same thing: what the conversation is
// called, the line the agent wrote about what is going on in it, and who is
// talking where. They were two shapes of one list for a while, which is how a
// list drifts: the card's said «Разработка — клаус» in a chip and the planning
// screen said everything else.
//
// What a row can *do* differs, so that is the caller's: an action is an icon, a
// title and something to run, and one that cannot be taken back asks first —
// ending a CLI somebody is using, or throwing a conversation away, must not
// happen on a stray click. Renaming is the row's own business, because it
// replaces the name with an input and that is a state nobody outside cares
// about.

export type ConversationAction = {
    icon: string
    title: string

    // Set to ask before running: the question, and the word on the button that
    // answers it. Anything that ends a CLI or forgets a conversation has one.
    confirm?: string
    confirmYes?: string
    run: () => void | Promise<void>
}

type Props = {
    name: string
    summary?: string

    // What this row is, in a sentence, for whoever hovers it: which stage, and
    // whether it is the one the card is standing on.
    title?: string

    // Who is talking and where — one line under the name.
    meta: string

    // Whether a CLI is running in it, which is what the dot says.
    running?: boolean

    // What kind of conversation this is, as a glyph before the name: work on
    // the card, or thinking about it. Two shapes rather than a word, because
    // the row's words are already the conversation's own — its name and the
    // agent's recap — and the kind is the one thing about a row that never
    // changes while somebody reads it.
    icon?: string
    iconTitle?: string

    // Whether this is the conversation the panel is drawing below the list.
    selected?: boolean

    // Clicking the name. A row with none is one there is nothing to open — a
    // stage the route has already passed.
    onPick?: () => void
    onRename?: (title: string) => void
    actions?: ConversationAction[]
    disabled?: boolean
}

const ConversationRow = (props: Props) => {
    const intl = useIntl()

    const [renaming, setRenaming] = createSignal(false)
    const [draft, setDraft] = createSignal('')
    const [asking, setAsking] = createSignal(-1)

    const beginRename = () => {
        setAsking(-1)
        setDraft(props.name)
        setRenaming(true)
    }

    // An empty name is a cancel rather than a nameless conversation: Go refuses
    // one anyway, and the name it already has is the better answer.
    const commitRename = () => {
        const title = draft().trim()
        setRenaming(false)
        if (title && title !== props.name) {
            props.onRename?.(title)
        }
    }

    const run = (action: ConversationAction, index: number) => {
        if (action.confirm && asking() !== index) {
            setRenaming(false)
            setAsking(index)
            return
        }
        setAsking(-1)
        action.run()
    }

    // The whole row is the click, not just the name: aiming at a line of text
    // inside a card-shaped row read as the row being broken. The controls stop
    // the click on themselves, so acting on a row is never also opening it.
    const pickRow = (e: MouseEvent) => {
        if (!props.onPick || renaming()) {
            return
        }
        const target = e.target as HTMLElement
        if (target.closest('button, input')) {
            return
        }
        props.onPick()
    }

    return (
        <li
            class='ConversationRow'
            classList={{
                'ConversationRow--selected': Boolean(props.selected),
                'ConversationRow--pickable': Boolean(props.onPick),
            }}
            title={props.title}
            onClick={pickRow}
        >
            <div class='ConversationRow__main'>
                <Show
                    when={renaming()}
                    fallback={
                        <div class='ConversationRow__nameLine'>
                            <Show when={props.icon}>
                                <span
                                    class='ConversationRow__kind'
                                    title={props.iconTitle}
                                >
                                    <CompassIcon icon={props.icon!}/>
                                </span>
                            </Show>
                            <span
                                class='ConversationRow__dot'
                                classList={{'ConversationRow__dot--running': Boolean(props.running)}}
                                title={props.running ? intl.formatMessage({id: 'Conversation.running', defaultMessage: 'A CLI is running in it'}) : intl.formatMessage({id: 'Conversation.idle', defaultMessage: 'Nothing is running in it'})}
                            />
                            <Show
                                when={props.onPick}
                                fallback={<span class='ConversationRow__name'>{props.name}</span>}
                            >
                                <button
                                    type='button'
                                    class='ConversationRow__name ConversationRow__name--pick'
                                    disabled={props.disabled}
                                    onClick={() => props.onPick?.()}
                                >
                                    {props.name}
                                </button>
                            </Show>
                        </div>
                    }
                >
                    <input
                        class='ConversationRow__rename'
                        aria-label={intl.formatMessage({id: 'Planning.rename', defaultMessage: 'Rename the conversation'})}
                        value={draft()}
                        ref={(el) => queueMicrotask(() => el.focus())}
                        onInput={(e) => setDraft(e.currentTarget.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                commitRename()
                            }
                            if (e.key === 'Escape') {
                                setRenaming(false)
                            }
                        }}
                    />
                </Show>

                {/* What the agent said it is doing. Nothing else here can know
                    it: a terminal is the vendor CLI in a pty, and no protocol
                    carries a recap of one. */}
                <Show when={props.summary}>
                    <div class='ConversationRow__summary'>{props.summary}</div>
                </Show>
                <div class='ConversationRow__meta'>{props.meta}</div>
            </div>

            <Show
                when={asking() >= 0}
                fallback={
                    <div class='ConversationRow__actions'>
                        <Show when={props.onRename}>
                            <button
                                type='button'
                                class='ConversationRow__iconButton'
                                title={intl.formatMessage({id: 'Planning.rename', defaultMessage: 'Rename the conversation'})}
                                aria-label={intl.formatMessage({id: 'Planning.rename', defaultMessage: 'Rename the conversation'})}
                                disabled={props.disabled}
                                onClick={beginRename}
                            >
                                <CompassIcon icon='pencil-outline'/>
                            </button>
                        </Show>
                        <For each={props.actions || []}>
                            {(action, index) => (
                                <button
                                    type='button'
                                    class='ConversationRow__iconButton'
                                    title={action.title}
                                    aria-label={action.title}
                                    disabled={props.disabled}
                                    onClick={() => run(action, index())}
                                >
                                    <CompassIcon icon={action.icon}/>
                                </button>
                            )}
                        </For>
                    </div>
                }
            >
                {/* Asked, because what is behind this button cannot be taken
                    back: a CLI somebody is using, or a conversation that will
                    not come back once it is forgotten. */}
                <div class='ConversationRow__confirm'>
                    <span>{(props.actions || [])[asking()]?.confirm}</span>
                    <button
                        type='button'
                        class='ConversationRow__confirmYes'
                        onClick={() => run((props.actions || [])[asking()], asking())}
                    >
                        {(props.actions || [])[asking()]?.confirmYes}
                    </button>
                    <button
                        type='button'
                        class='ConversationRow__confirmNo'
                        onClick={() => setAsking(-1)}
                    >
                        {intl.formatMessage({id: 'Planning.end-no', defaultMessage: 'Cancel'})}
                    </button>
                </div>
            </Show>
        </li>
    )
}

export default ConversationRow
