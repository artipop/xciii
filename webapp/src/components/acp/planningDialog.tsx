// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import Button from '../../widgets/buttons/button'
import Dialog from '../dialog'

import {agentBindings} from './agentProjectsDialog'
import PromptField from './promptField'

import './planningDialog.scss'

// Planning a task before it exists: the agent's own CLI, in the project, in
// a window.
//
// This dialog used to hold the conversation itself — a transcript, a prompt box
// and a "create task" turn that boiled the discussion down into a card. The
// conversation now happens where the agent already has a good one, in its
// terminal, so what is left here is choosing where to open it and finding the
// ones already open: a terminal outlives its window, and one with no card
// behind it has nothing else to be found through.

type NamedEntry = {name: string}
type LiveTerminal = {id: string, agent: string, cwd: string}

export function isPlanningAvailable(): boolean {
    return Boolean(agentBindings()?.OpenPlanningTerminal)
}

type Props = {

    // The board the dialog was opened from. Planning has no card, but it may
    // leave cards — and this is the only board it may leave them on.
    board: Board
    onClose: () => void
}

const PlanningDialog = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [projects, setProjects] = createSignal<NamedEntry[]>([])
    const [agents, setAgents] = createSignal<NamedEntry[]>([])
    const [projectName, setProjectName] = createSignal('')
    const [agentName, setAgentName] = createSignal('')
    const [terminals, setTerminals] = createSignal<LiveTerminal[]>([])
    const [prompt, setPrompt] = createSignal('')
    const [savedPrompt, setSavedPrompt] = createSignal('')
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal('')

    const refreshTerminals = async () => {
        if (!bindings?.ListTerminals) {
            return
        }
        try {
            const all = JSON.parse(await bindings.ListTerminals())
            setTerminals(all.filter((t: {cardId?: string}) => !t.cardId))
        } catch (e) {
            // Nothing running is the ordinary case, not a failure.
        }
    }

    onMount(async () => {
        refreshTerminals()
        if (!bindings) {
            return
        }
        try {
            if (bindings.GetPlanningPrompt) {
                const stored = await bindings.GetPlanningPrompt()
                setPrompt(stored)
                setSavedPrompt(stored)
            }

            // Planning is about a project, not about the board it was opened
            // from, so every project on the machine is offered. The board
            // bounds only where the cards may land.
            const [repoList, agentList] = await Promise.all([
                bindings.ListAgentProjects(''),
                bindings.ListAgents(),
            ])
            const parsedRepos: NamedEntry[] = JSON.parse(repoList) || []
            const parsedAgents: NamedEntry[] = JSON.parse(agentList) || []
            setProjects(parsedRepos)
            setAgents(parsedAgents)

            // One of a kind needs no choosing.
            if (parsedRepos.length === 1) {
                setProjectName(parsedRepos[0].name)
            }
            if (parsedAgents.length === 1) {
                setAgentName(parsedAgents[0].name)
            }
        } catch (e: any) {
            setError(String(e?.message || e))
        }
    })

    // The desktop app has already opened the window by the time the binding
    // returns; a server build has no windows, so the browser opens a tab.
    const openWindow = (handle: {windowed?: boolean, url?: string}) => {
        if (!handle.windowed && handle.url) {
            window.open(handle.url, '_blank', 'noopener')
        }
    }

    // The prompt is stored before the terminal starts rather than sent with it:
    // what a planning terminal opens with is a setting, and one edited in the
    // moment is still the one the next terminal should get.
    const savePrompt = async () => {
        if (!bindings?.SetPlanningPrompt || prompt() === savedPrompt()) {
            return
        }
        await bindings.SetPlanningPrompt(prompt())
        setSavedPrompt(prompt())
    }

    const saveOnly = async () => {
        setError('')
        try {
            await savePrompt()
        } catch (e: any) {
            setError(String(e?.message || e))
        }
    }

    const start = async () => {
        if (!bindings?.OpenPlanningTerminal) {
            return
        }
        setError('')
        setBusy(true)
        try {
            await savePrompt()
            openWindow(JSON.parse(await bindings.OpenPlanningTerminal(projectName(), agentName(), props.board.id)))
            await refreshTerminals()
        } catch (e: any) {
            setError(String(e?.message || e))
        } finally {
            setBusy(false)
        }
    }

    const show = async (id: string) => {
        if (!bindings?.ShowTerminal) {
            return
        }
        try {
            openWindow(JSON.parse(await bindings.ShowTerminal(id)))
        } catch (e: any) {
            setError(String(e?.message || e))
            refreshTerminals()
        }
    }

    return (
        <Dialog
            onClose={props.onClose}
            class='PlanningDialog'
            title={<div>{intl.formatMessage({id: 'Planning.title', defaultMessage: 'Plan a task'})}</div>}
        >
            <div class='PlanningDialog__body'>
                <p class='PlanningDialog__hint'>
                    {intl.formatMessage({
                        id: 'Planning.hint-terminal',
                        defaultMessage: 'Opens the agent\'s CLI in the project. This is a place to think out loud: nothing is committed for you, and the cards you agree on the agent can put on this board itself.',
                    })}
                </p>

                <div class='PlanningDialog__pickers'>
                    <label>
                        {intl.formatMessage({id: 'Planning.project', defaultMessage: 'Project'})}
                        <select
                            value={projectName()}
                            onChange={(e) => setProjectName(e.currentTarget.value)}
                        >
                            <option value=''>{intl.formatMessage({id: 'Planning.choose', defaultMessage: 'Choose…'})}</option>
                            <For each={projects()}>
                                {(r) => (
                                    <option
                                        value={r.name}
                                        selected={projectName() === r.name}
                                    >{r.name}</option>
                                )}
                            </For>
                        </select>
                    </label>
                    <label>
                        {intl.formatMessage({id: 'Planning.agent', defaultMessage: 'Agent'})}
                        <select
                            value={agentName()}
                            onChange={(e) => setAgentName(e.currentTarget.value)}
                        >
                            <option value=''>{intl.formatMessage({id: 'Planning.choose', defaultMessage: 'Choose…'})}</option>
                            <For each={agents()}>
                                {(a) => (
                                    <option
                                        value={a.name}
                                        selected={agentName() === a.name}
                                    >{a.name}</option>
                                )}
                            </For>
                        </select>
                    </label>
                    <Button
                        filled={true}
                        onClick={start}
                        disabled={busy() || !agentName() || !projectName()}
                    >
                        {intl.formatMessage({id: 'Planning.start-terminal', defaultMessage: 'Open a terminal'})}
                    </Button>
                </div>

                <Show when={Boolean(bindings?.GetPlanningPrompt)}>
                    <PromptField
                        label={intl.formatMessage({
                            id: 'Planning.prompt',
                            defaultMessage: 'What the agent is told to begin with (the board system prompt and the agent\'s own come before it, the project after)',
                        })}
                        value={prompt()}

                        // Ten rows: the default instructions are eight lines,
                        // and a box that cuts off its own default reads as a
                        // bug rather than as a setting.
                        rows={10}
                        onInput={setPrompt}
                    >
                        <Show when={prompt() !== savedPrompt()}>
                            <Button onClick={saveOnly}>
                                {intl.formatMessage({id: 'Planning.save-prompt', defaultMessage: 'Save the instructions'})}
                            </Button>
                        </Show>
                    </PromptField>
                </Show>

                <Show when={error()}>
                    <div class='PlanningDialog__error'>{error()}</div>
                </Show>

                <Show when={terminals().length > 0}>
                    <div class='Planning__terminals'>
                        <span>{intl.formatMessage({id: 'Planning.terminals-running', defaultMessage: 'Terminals still running:'})}</span>
                        <For each={terminals()}>
                            {(t) => (
                                <Button
                                    onClick={() => show(t.id)}
                                    title={t.cwd}
                                >
                                    {`${t.agent} · ${t.cwd.split('/').pop()}`}
                                </Button>
                            )}
                        </For>
                    </div>
                </Show>
            </div>
        </Dialog>
    )
}

export default PlanningDialog
