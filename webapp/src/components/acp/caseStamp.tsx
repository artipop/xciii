import {For, Show, onMount} from 'solid-js'

import {agentBindings} from './bindings'
import {cardAgentState, refreshCardAgent} from './cardAgentState'

import './caseStamp.scss'

// The line of provenance under a card's title: which branch the work is on,
// which worktree it happened in, what the session did last.
//
// The product knew all of this already — `GetCardAgent` returns it and the
// agent's own row further down the card renders parts of it — but a person
// opening a card had to scroll to find out where the work lives. Here it reads
// as what it is: the stamp on a case file saying where and when.
//
// It shows nothing at all until there is something to say. A card nobody has
// run an agent on is not a case yet.

export function isCaseStampAvailable(): boolean {
    return Boolean(agentBindings()?.GetCardAgent)
}

type Props = {
    cardId: string
}

// The worktree is an absolute path and usually long; what identifies it is the
// last component, and the full path stays in the title attribute.
function worktreeName(path: string): string {
    const parts = path.split('/').filter(Boolean)
    return parts[parts.length - 1] || path
}

const CaseStamp = (props: Props) => {
    const state = cardAgentState(props.cardId)

    // The stamp asks for itself rather than relying on the agent's row further
    // down the card: that row is hidden on a read-only board, and the stamp is
    // not. The shared refresh folds the two requests into one when both mount.
    onMount(() => {
        refreshCardAgent(props.cardId)
    })

    const branch = () => state().session?.branch || state().resume?.branch || ''
    const worktree = () => state().session?.worktree || state().resume?.cwd || ''
    const status = () => state().session?.status || ''

    const fields = () => {
        const out: Array<{key: string, label: string, value: string, title?: string}> = []
        if (branch()) {
            out.push({key: 'branch', label: 'branch', value: branch()})
        }
        if (worktree()) {
            out.push({key: 'worktree', label: 'worktree', value: worktreeName(worktree()), title: worktree()})
        }
        if (status()) {
            out.push({key: 'session', label: 'session', value: status()})
        }
        if (state().running) {
            out.push({key: 'terminal', label: 'terminal', value: 'open'})
        }
        return out
    }

    return (
        <Show when={fields().length > 0}>
            <div class='CaseStamp'>
                <For each={fields()}>
                    {(field) => (
                        <span
                            class={`CaseStamp__field CaseStamp__field--${field.key}`}
                            title={field.title}
                        >
                            <span class='CaseStamp__label'>{field.label}</span>
                            <span class='CaseStamp__value'>{field.value}</span>
                        </span>
                    )}
                </For>
            </div>
        </Show>
    )
}

export default CaseStamp
