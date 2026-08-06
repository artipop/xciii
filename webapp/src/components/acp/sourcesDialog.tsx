// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onMount} from 'solid-js'

import {Board} from '../../blocks/board'
import {useIntl} from '../../intl'

import Button from '../../widgets/buttons/button'
import Dialog from '../dialog'

import {agentBindings} from './agentProjectsDialog'

import './sourcesDialog.scss'

// Where the cards on this board come from besides a person typing them: a
// phone, a script, a service. A source belongs to the board it was created on,
// so this dialog only ever shows and creates that board's own.
//
// The address a source is fed on is this page's own origin — the front door
// serves both — so it is composed here rather than asked for. Which door you
// are looking through is which address you get, which is exactly right: a phone
// opens the board over the tailnet and sees the tailnet address.

export type SourceRule = {
    name?: string
    when: {title?: string, body?: string, labels?: string[], props?: {[key: string]: string}}
    then: string
    column?: string
    props?: {[key: string]: string}
    agent?: string
}

export type Source = {
    name: string
    plugin?: string
    boardId?: string
    global?: boolean
    enabled: boolean
    property?: string
    inbox?: string
    noisy?: boolean
    update?: string
    rules?: SourceRule[]
}

export type SourceEvent = {
    id: number
    source: string
    externalId?: string
    rule?: string
    outcome: string
    cardId?: string
    detail?: string
    createdAt: string
}

export function isSourcesAvailable(): boolean {
    return Boolean(agentBindings()?.ListSources)
}

// ingestURL is the address to post to. encodeURIComponent, because a source is
// named in the user's own words and those are usually Russian.
export function ingestURL(origin: string, name: string): string {
    return `${origin}/sources/ingest/${encodeURIComponent(name)}`
}

type Props = {
    board: Board
    onClose: () => void
}

const SourcesDialog = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [sources, setSources] = createSignal<Source[]>([])
    const [events, setEvents] = createSignal<SourceEvent[]>([])
    const [selected, setSelected] = createSignal('')
    const [name, setName] = createSignal('')
    const [noisy, setNoisy] = createSignal(true)

    // Shown once, when it is issued: only its hash is kept, so there is no
    // second chance to read it.
    const [token, setToken] = createSignal('')
    const [error, setError] = createSignal('')
    const [busy, setBusy] = createSignal(false)

    const refresh = async () => {
        if (!bindings?.ListSources) {
            return
        }
        try {
            setSources(JSON.parse(await bindings.ListSources(props.board.id)) || [])
        } catch (e: any) {
            setError(String(e?.message || e))
        }
    }

    const showEvents = async (source: string) => {
        setSelected(source)
        setEvents([])
        if (!bindings?.SourceEvents) {
            return
        }
        try {
            setEvents(JSON.parse(await bindings.SourceEvents(source, 20)) || [])
        } catch (e: any) {
            setError(String(e?.message || e))
        }
    }

    onMount(refresh)

    const add = async () => {
        const title = name().trim()
        if (!title || !bindings?.AddSource) {
            return
        }
        setBusy(true)
        setError('')
        try {
            const created = JSON.parse(await bindings.AddSource(JSON.stringify({
                name: title,
                boardId: props.board.id,
                enabled: true,
                noisy: noisy(),

                // A source with no rule at all would file everything in the
                // inbox, which is the safe half of the two defaults and the one
                // to start from.
                rules: [],
            })))
            setToken(created.token || '')
            setName('')
            await refresh()
            await showEvents(title)
        } catch (e: any) {
            setError(String(e?.message || e))
        } finally {
            setBusy(false)
        }
    }

    const remove = async (source: string) => {
        if (!bindings?.RemoveSource) {
            return
        }
        setBusy(true)
        setError('')
        try {
            await bindings.RemoveSource(source)
            if (selected() === source) {
                setSelected('')
                setEvents([])
            }
            await refresh()
        } catch (e: any) {
            setError(String(e?.message || e))
        } finally {
            setBusy(false)
        }
    }

    const resetToken = async (source: string) => {
        if (!bindings?.ResetSourceToken) {
            return
        }
        setBusy(true)
        setError('')
        try {
            const issued = JSON.parse(await bindings.ResetSourceToken(source))
            setToken(issued.token || '')
        } catch (e: any) {
            setError(String(e?.message || e))
        } finally {
            setBusy(false)
        }
    }

    const outcomeText = (outcome: string) => {
        switch (outcome) {
        case 'created':
            return intl.formatMessage({id: 'Sources.outcome-created', defaultMessage: 'card created'})
        case 'inbox':
            return intl.formatMessage({id: 'Sources.outcome-inbox', defaultMessage: 'no rule matched, filed in the inbox'})
        case 'commented':
            return intl.formatMessage({id: 'Sources.outcome-commented', defaultMessage: 'changed, commented on its card'})
        case 'dropped':
            return intl.formatMessage({id: 'Sources.outcome-dropped', defaultMessage: 'dropped'})
        default:
            return intl.formatMessage({id: 'Sources.outcome-failed', defaultMessage: 'failed'})
        }
    }

    return (
        <Dialog
            class='SourcesDialog'
            title={<span>{intl.formatMessage({id: 'Sources.title', defaultMessage: 'Sources'})}</span>}
            subtitle={
                <span>
                    {intl.formatMessage({
                        id: 'Sources.subtitle',
                        defaultMessage: 'What turns into cards on this board on its own: a notification from your phone, a script, a service. Anything that can make an HTTP request can feed a source.',
                    })}
                </span>
            }
            onClose={props.onClose}
        >
            <div class='SourcesDialog__content'>
                <Show when={sources().length === 0}>
                    <p class='SourcesDialog__hint'>
                        {intl.formatMessage({id: 'Sources.empty', defaultMessage: 'This board has no sources yet.'})}
                    </p>
                </Show>

                <For each={sources()}>
                    {(source) => (
                        <div class='SourcesDialog__source'>
                            <div class='SourcesDialog__sourceHead'>
                                <span class='SourcesDialog__sourceName'>{source.name}</span>
                                <span class='SourcesDialog__sourceMode'>
                                    {source.noisy ? intl.formatMessage({id: 'Sources.mode-noisy', defaultMessage: 'only what a rule matches'}) : intl.formatMessage({id: 'Sources.mode-quiet', defaultMessage: 'everything, unmatched to the inbox'})}
                                </span>
                                <Button
                                    disabled={busy()}
                                    onClick={() => showEvents(source.name)}
                                >
                                    {intl.formatMessage({id: 'Sources.log', defaultMessage: 'Log'})}
                                </Button>
                                <Button
                                    disabled={busy()}
                                    onClick={() => resetToken(source.name)}
                                >
                                    {intl.formatMessage({id: 'Sources.new-token', defaultMessage: 'New token'})}
                                </Button>
                                <Button
                                    disabled={busy()}
                                    onClick={() => remove(source.name)}
                                >
                                    {intl.formatMessage({id: 'Sources.remove', defaultMessage: 'Remove'})}
                                </Button>
                            </div>
                            <code class='SourcesDialog__address'>{ingestURL(window.location.origin, source.name)}</code>
                        </div>
                    )}
                </For>

                <Show when={token()}>
                    <div class='SourcesDialog__token'>
                        <span class='SourcesDialog__tokenLabel'>
                            {intl.formatMessage({
                                id: 'Sources.token',
                                defaultMessage: 'The token, shown once — only its hash is kept, so copy it now',
                            })}
                        </span>
                        <code>{token()}</code>
                        <Button onClick={() => navigator.clipboard?.writeText(token())}>
                            {intl.formatMessage({id: 'Sources.copy', defaultMessage: 'Copy'})}
                        </Button>
                    </div>
                </Show>

                <div class='SourcesDialog__add'>
                    <input
                        type='text'
                        placeholder={intl.formatMessage({id: 'Sources.name', defaultMessage: 'Name of the source, e.g. phone'})}
                        value={name()}
                        disabled={busy()}
                        onInput={(e) => setName(e.currentTarget.value)}
                    />
                    <label class='SourcesDialog__noisy'>
                        <input
                            type='checkbox'
                            checked={noisy()}
                            disabled={busy()}
                            onChange={(e) => setNoisy(e.currentTarget.checked)}
                        />
                        <span>
                            {intl.formatMessage({
                                id: 'Sources.noisy',
                                defaultMessage: 'A stream of notifications: keep only what a rule asks for',
                            })}
                        </span>
                    </label>
                    <Button
                        filled={true}
                        submit={true}
                        disabled={busy() || !name().trim()}
                        onClick={add}
                    >
                        {intl.formatMessage({id: 'Sources.add', defaultMessage: 'Add'})}
                    </Button>
                </div>

                <Show when={selected()}>
                    <div class='SourcesDialog__log'>
                        <span class='SourcesDialog__logLabel'>
                            {intl.formatMessage({id: 'Sources.log-of', defaultMessage: 'What {name} has brought'}, {name: selected()})}
                        </span>
                        <Show
                            when={events().length > 0}
                            fallback={
                                <p class='SourcesDialog__hint'>
                                    {intl.formatMessage({id: 'Sources.log-empty', defaultMessage: 'Nothing yet.'})}
                                </p>
                            }
                        >
                            <For each={events()}>
                                {(event) => (
                                    <div class='SourcesDialog__event'>
                                        <span class={`SourcesDialog__outcome SourcesDialog__outcome--${event.outcome}`}>
                                            {outcomeText(event.outcome)}
                                        </span>
                                        <span class='SourcesDialog__eventDetail'>{event.detail || event.rule || event.externalId}</span>
                                    </div>
                                )}
                            </For>
                        </Show>
                    </div>
                </Show>

                <Show when={error()}>
                    <div class='SourcesDialog__error'>{error()}</div>
                </Show>
            </div>
        </Dialog>
    )
}

export default SourcesDialog
