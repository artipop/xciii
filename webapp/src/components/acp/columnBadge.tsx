// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {Accessor, Show, createMemo, createSignal, onCleanup, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {agentBindings} from './agentProjectsDialog'
import {onAgentEvent} from './agentEvents'
import {ColumnSpec, specFor} from './automation'

import './columnBadge.scss'

// What a column does, said on the column itself. Without this the whole
// mechanism is invisible on the board: you have to open a dialog to learn that
// cards dropped here are picked up by an agent.

// A board's columns are asked for once and shared by every header on it. The
// list is small and changes only when somebody edits it, so a module-level
// cache beats a request per column.
const cache = new Map<string, ColumnSpec[]>()
const listeners = new Set<() => void>()

// invalidateBoardColumns drops the cache — after an edit, or when a session
// starts or ends and the "2/2" may have changed.
export function invalidateBoardColumns(): void {
    cache.clear()
    listeners.forEach((notify) => notify())
}

async function loadColumns(boardId: string): Promise<ColumnSpec[]> {
    const bindings = agentBindings()
    if (!bindings?.ListBoardColumns) {
        return []
    }
    const cached = cache.get(boardId)
    if (cached) {
        return cached
    }
    const specs: ColumnSpec[] = JSON.parse(await bindings.ListBoardColumns(boardId)) || []
    cache.set(boardId, specs)
    return specs
}

// useBoardColumns gives a component the board's column settings, reloading them
// whenever anything invalidates the cache.
export function useBoardColumns(boardId: string): Accessor<ColumnSpec[]> {
    const [specs, setSpecs] = createSignal<ColumnSpec[]>([])

    let cancelled = false
    const refresh = () => {
        loadColumns(boardId).then((loaded) => {
            if (!cancelled) {
                setSpecs(loaded)
            }
        }).catch(() => setSpecs([]))
    }

    onMount(() => {
        refresh()
        listeners.add(refresh)

        // A session starting or ending changes what the badge counts.
        const off = onAgentEvent('acp:session', () => {
            cache.clear()
            refresh()
        })
        onCleanup(() => {
            cancelled = true
            listeners.delete(refresh)
            off?.()
        })
    })

    return specs
}

type Props = {
    boardId: string
    optionId: string
    columnName: string
}

// actionIcon is a one-glyph answer to "what happens here".
function actionIcon(action: string): string {
    switch (action) {
    case 'agent':
        return '🤖'
    case 'deploy':
        return '🚀'
    case 'test':
        return '🔍'
    default:
        return ''
    }
}

const ColumnBadge = (props: Props) => {
    const intl = useIntl()
    const specs = useBoardColumns(props.boardId)
    const spec = createMemo(() => specFor(specs(), {optionId: props.optionId, name: props.columnName}))

    const crew = () => spec()?.agents || []
    const limit = () => spec()?.maxRunning || 0
    const title = () => [
        actionTitle(intl, spec()!.action),
        crew().length > 0 ? intl.formatMessage({id: 'ColumnBadge.crew', defaultMessage: 'Worked by: {crew}'}, {crew: crew().join(', ')}) : '',
        limit() > 0 ? intl.formatMessage({id: 'ColumnBadge.limit', defaultMessage: 'At once: {limit}'}, {limit: limit()}) : '',
    ].filter(Boolean).join('\n')

    return (
        <Show when={spec() && spec()!.action !== 'none'}>
            <span
                class='ColumnBadge'
                title={title()}
            >
                <span class='ColumnBadge__icon'>{actionIcon(spec()!.action)}</span>
                <Show when={crew().length > 0}>
                    <span class='ColumnBadge__crew'>{crew().length === 1 ? crew()[0] : crew().length}</span>
                </Show>
                <Show when={limit() > 0}>
                    <span class='ColumnBadge__limit'>{limit()}</span>
                </Show>
            </span>
        </Show>
    )
}

function actionTitle(intl: {formatMessage: (d: {id: string, defaultMessage: string}) => string}, action: string): string {
    switch (action) {
    case 'agent':
        return intl.formatMessage({id: 'ColumnBadge.action-agent', defaultMessage: 'An agent works on cards dropped here'})
    case 'deploy':
        return intl.formatMessage({id: 'ColumnBadge.action-deploy', defaultMessage: 'A card dropped here is deployed'})
    case 'test':
        return intl.formatMessage({id: 'ColumnBadge.action-test', defaultMessage: 'A card dropped here is tested'})
    default:
        return ''
    }
}

export default ColumnBadge
