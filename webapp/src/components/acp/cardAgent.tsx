// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onCleanup, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import Button from '../../widgets/buttons/button'

import {agentBindings} from './agentReposDialog'

import './cardAgent.scss'

// What a card says about the agent working it — and it is deliberately little.
//
// There used to be a console here: a transcript of the session, a box to type
// follow-ups into, buttons answering the agent's permission prompts. All of it
// is gone. A session run by the board reports itself in the card's comments,
// and a person who wants to talk to the agent opens a terminal, where the agent
// has a UI of its own and asks its own questions.
//
// What is left is what the card cannot get anywhere else: the terminal, the
// branch the work is on with the button that deploys it, and — while the
// automation is running — a way to stop it.

type CardAgentState = {
    session?: {
        sessionId?: string
        status?: string
        branch?: string
        worktree?: string
        error?: string
    }
    running?: {id: string}
    resume?: {available?: boolean, branch?: string, cwd?: string}
}

export function isCardAgentAvailable(): boolean {
    return Boolean(agentBindings()?.GetCardAgent)
}

type Props = {
    cardId: string
}

const CardAgent = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [state, setState] = createSignal<CardAgentState>({})
    const [repos, setRepos] = createSignal<Array<{name: string}>>([])
    const [repoName, setRepoName] = createSignal('')
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal('')
    const [deployStatus, setDeployStatus] = createSignal('')

    const refresh = async () => {
        if (!bindings?.GetCardAgent) {
            return
        }
        try {
            setState(JSON.parse(await bindings.GetCardAgent(props.cardId)))
        } catch (e: any) {
            setError(String(e?.message || e))
        }
    }

    onMount(() => {
        refresh()
        const runtime = (window as unknown as import('../../types').IAppWindow).runtime
        const offSession = runtime?.EventsOn?.('acp:session', (payload: any) => {
            if (!payload?.cardId || payload.cardId === props.cardId) {
                refresh()
            }
        })
        const offTerminal = runtime?.EventsOn?.('acp:terminal', (payload: any) => {
            if (!payload?.cardId || payload.cardId === props.cardId) {
                refresh()
            }
        })
        onCleanup(() => {
            offSession?.()
            offTerminal?.()
        })
    })

    // A card that does not say which repository it is about cannot open a
    // terminal until somebody picks one; the list is only fetched then.
    const offerRepos = async () => {
        if (!bindings?.ListAgentRepos || repos().length > 0) {
            return
        }
        try {
            setRepos(JSON.parse(await bindings.ListAgentRepos()))
        } catch (e) {
            // An empty registry is not an error to report here.
        }
    }

    const openTerminal = async () => {
        if (!bindings?.OpenCardTerminal) {
            return
        }
        setBusy(true)
        setError('')
        try {
            const handle = JSON.parse(await bindings.OpenCardTerminal(props.cardId, repoName(), ''))

            // The desktop app has already opened the window by now; a server
            // build has no windows, so the browser opens a tab instead.
            if (!handle.windowed && handle.url) {
                window.open(handle.url, '_blank', 'noopener')
            }
            await refresh()
        } catch (e: any) {
            setError(String(e?.message || e))
            offerRepos()
        } finally {
            setBusy(false)
        }
    }

    const deploy = async () => {
        if (!bindings?.StartCardDeploy) {
            return
        }
        setBusy(true)
        setError('')
        setDeployStatus(intl.formatMessage({id: 'CardAgent.deploy-started', defaultMessage: 'started'}))
        try {
            await bindings.StartCardDeploy(props.cardId, state().session?.branch || '')
        } catch (e: any) {
            setDeployStatus('')
            setError(String(e?.message || e))
        } finally {
            setBusy(false)
        }
    }

    const cancel = async () => {
        if (!bindings?.CancelSession) {
            return
        }
        await bindings.CancelSession(props.cardId)
        await refresh()
    }

    const status = () => state().session?.status || ''
    const working = () => status() === 'running' || status() === 'queued'

    const terminalLabel = () => {
        if (state().running) {
            return intl.formatMessage({id: 'CardAgent.terminal-focus', defaultMessage: 'Show terminal'})
        }
        if (state().resume?.available) {
            return intl.formatMessage({id: 'CardAgent.terminal-resume', defaultMessage: 'Resume in terminal'})
        }
        return intl.formatMessage({id: 'CardAgent.terminal-open', defaultMessage: 'Open terminal'})
    }

    return (
        <div class='CardAgent'>
            <div class='CardAgent__row'>
                <span class='CardAgent__title'>
                    {intl.formatMessage({id: 'CardAgent.title', defaultMessage: 'Agent'})}
                </span>
                <Show when={status()}>
                    <span class={`CardAgent__status CardAgent__status--${status()}`}>{status()}</span>
                </Show>
                <div class='CardAgent__actions'>
                    <Button
                        onClick={openTerminal}
                        disabled={busy()}
                        title={state().resume?.cwd}
                    >
                        {terminalLabel()}
                    </Button>
                    <Show when={working()}>
                        <Button onClick={cancel}>
                            {intl.formatMessage({id: 'CardAgent.cancel', defaultMessage: 'Cancel session'})}
                        </Button>
                    </Show>
                </div>
            </div>

            <Show when={state().session?.branch}>
                <div class='CardAgent__branch'>
                    <span
                        class='CardAgent__branchName'
                        title={state().session?.worktree || undefined}
                    >
                        {state().session?.branch}
                    </span>
                    <Show when={deployStatus()}>
                        <span class='CardAgent__deployStatus'>
                            {intl.formatMessage({id: 'CardAgent.deploy-status', defaultMessage: 'deploy: {status}'}, {status: deployStatus()})}
                        </span>
                    </Show>
                    <Button
                        onClick={deploy}
                        disabled={busy() || !bindings?.StartCardDeploy}
                    >
                        {intl.formatMessage({id: 'CardAgent.deploy', defaultMessage: 'Deploy'})}
                    </Button>
                </div>
            </Show>

            <Show when={state().session?.error}>
                <div class='CardAgent__error'>{state().session?.error}</div>
            </Show>
            <Show when={error()}>
                <div class='CardAgent__error'>{error()}</div>
            </Show>

            <Show when={repos().length > 0}>
                <div class='CardAgent__repoPicker'>
                    <select
                        value={repoName()}
                        onChange={(e) => setRepoName(e.currentTarget.value)}
                    >
                        <option value=''>
                            {intl.formatMessage({id: 'CardAgent.choose-repo', defaultMessage: 'Choose a repository…'})}
                        </option>
                        <For each={repos()}>
                            {(r) => (
                                <option
                                    value={r.name}
                                >{r.name}</option>
                            )}
                        </For>
                    </select>
                    <Button
                        onClick={openTerminal}
                        disabled={busy() || !repoName()}
                    >
                        {intl.formatMessage({id: 'CardAgent.terminal-open', defaultMessage: 'Open terminal'})}
                    </Button>
                </div>
            </Show>
        </div>
    )
}

export default CardAgent
