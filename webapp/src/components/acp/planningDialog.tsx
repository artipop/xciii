// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {Board} from '../../blocks/board'
import Button from '../../widgets/buttons/button'
import Select from '../../widgets/select'
import Dialog from '../dialog'

import {agentBindings} from './bindings'

import './planningDialog.scss'

// Talking a task through before it exists: the agent's own CLI, in the project,
// in a window.
//
// This dialog used to hold the conversation itself — a transcript, a prompt box
// and a "create task" turn that boiled the discussion down into a card. The
// conversation now happens where the agent already has a good one, in its
// terminal, so what is left here is choosing where to open it and finding the
// ones already open: a terminal outlives its window, and one with no card
// behind it has nothing else to be found through.
//
// What such a terminal opens saying used to be edited here too, which made a
// setting of the machine look like part of the act of opening one. It is in
// Settings → This machine now, with the other things that are true of the
// install rather than of a board.

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
            // The conversation is about a project, not about the board it was
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

    const start = async () => {
        if (!bindings?.OpenPlanningTerminal) {
            return
        }
        setError('')
        setBusy(true)
        try {
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
            title={<div>{intl.formatMessage({id: 'Planning.title', defaultMessage: 'Talk it over with an agent'})}</div>}
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
                        {intl.formatMessage({id: 'Planning.project', defaultMessage: 'Folder'})}
                        <Select
                            value={projectName()}
                            options={[
                                {value: '', label: intl.formatMessage({id: 'Planning.choose', defaultMessage: 'Choose…'})},
                                ...projects().map((r) => ({value: r.name, label: r.name})),
                            ]}
                            onChange={setProjectName}
                            label={intl.formatMessage({id: 'Planning.project', defaultMessage: 'Folder'})}
                        />
                    </label>
                    <label>
                        {intl.formatMessage({id: 'Planning.agent', defaultMessage: 'Agent'})}
                        <Select
                            value={agentName()}
                            options={[
                                {value: '', label: intl.formatMessage({id: 'Planning.choose', defaultMessage: 'Choose…'})},
                                ...agents().map((a) => ({value: a.name, label: a.name})),
                            ]}
                            onChange={setAgentName}
                            label={intl.formatMessage({id: 'Planning.agent', defaultMessage: 'Agent'})}
                        />
                    </label>
                    <Button
                        filled={true}
                        onClick={start}
                        disabled={busy() || !agentName() || !projectName()}
                    >
                        {intl.formatMessage({id: 'Planning.start-terminal', defaultMessage: 'Open a terminal'})}
                    </Button>
                </div>

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
