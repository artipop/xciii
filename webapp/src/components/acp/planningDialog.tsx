// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {Board} from '../../blocks/board'
import Button from '../../widgets/buttons/button'
import CompassIcon from '../../widgets/icons/compassIcon'
import Dialog from '../dialog'

import {agentBindings} from './bindings'
import AgentQuickAdd from './agentQuickAdd'

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
// The choosing is the same stepped flow the card's terminal asks with
// (cardTerminal.tsx): one question per screen, the answers as things to click —
// who first, then where — because two selects and a button asked both questions
// at once and neither plainly. «Папка доски» is an answer here exactly as it is
// there: planning with no code is how a board of briefs gets talked over.

type NamedEntry = {name: string}
type LiveTerminal = {id: string, agent: string, cwd: string, boardFolder?: boolean}

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
    const [agentName, setAgentName] = createSignal('')
    const [addingAgent, setAddingAgent] = createSignal(false)
    const [terminals, setTerminals] = createSignal<LiveTerminal[]>([])
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal('')

    // Who first, where second: the agent question is open while nobody is
    // named, and a single registered agent answers it without being asked.
    const askingAgent = () => !agentName()

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

    const refreshChoices = async () => {
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
            const parsedAgents: NamedEntry[] = JSON.parse(agentList) || []
            setProjects(JSON.parse(repoList) || [])
            setAgents(parsedAgents)
            if (parsedAgents.length === 1) {
                setAgentName(parsedAgents[0].name)
            }
        } catch (e: any) {
            setError(String(e?.message || e))
        }
    }

    onMount(() => {
        refreshTerminals()
        refreshChoices()
    })

    // The desktop app has already opened the window by the time the binding
    // returns; a server build has no windows, so the browser opens a tab.
    const openWindow = (handle: {windowed?: boolean, url?: string}) => {
        if (!handle.windowed && handle.url) {
            window.open(handle.url, '_blank', 'noopener')
        }
    }

    // Clicking an answer is what starts: a project by name, or '' for «папка
    // доски» — the board's own folder, resolved on the Go side.
    const start = async (projectName: string) => {
        if (!bindings?.OpenPlanningTerminal) {
            return
        }
        setError('')
        setBusy(true)
        try {
            openWindow(JSON.parse(await bindings.OpenPlanningTerminal(projectName, agentName(), props.board.id)))
            await refreshTerminals()
        } catch (e: any) {
            setError(String(e?.message || e))
        } finally {
            setBusy(false)
        }
    }

    // A folder is two answers — where it is and what to call it — and the
    // native picker gives both; picking is the answer, so the terminal opens
    // with it.
    const pickFolderAndStart = async () => {
        if (!bindings?.PickDirectory || !bindings.AddAgentProject) {
            return
        }
        try {
            const path = await bindings.PickDirectory(intl.formatMessage({id: 'CardTerminal.pick-project', defaultMessage: 'Choose a folder to work in'}))
            if (!path) {
                return
            }
            const name = path.split('/').filter(Boolean).pop() || path
            await bindings.AddAgentProject(name, path, props.board.id, false)
            await refreshChoices()
            await start(name)
        } catch (e: any) {
            setError(String(e?.message || e))
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

    const terminalLabel = (t: LiveTerminal) => {
        const where = t.boardFolder ?
            intl.formatMessage({id: 'Terminal.board-folder', defaultMessage: 'the board’s folder'}) :
            t.cwd.split('/').pop()
        return `${t.agent} · ${where}`
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
                        defaultMessage: 'Opens the agent\'s CLI in the project folder. Nothing is committed without you, and the agent can create the cards you agree on right on this board.',
                    })}
                </p>

                <Show
                    when={askingAgent()}
                    fallback={
                        <>
                            <div class='PlanningDialog__ask'>
                                {intl.formatMessage({id: 'Planning.where', defaultMessage: 'Where should the conversation live?'})}
                            </div>
                            <div class='PlanningDialog__picker'>
                                {/* The answered question, kept in sight: the
                                    name is the way back to it. */}
                                <Show when={agents().length > 1}>
                                    <button
                                        type='button'
                                        class='PlanningDialog__pickBack'
                                        title={intl.formatMessage({id: 'CardTerminal.change-agent', defaultMessage: 'Change the agent'})}
                                        onClick={() => setAgentName('')}
                                    >
                                        <CompassIcon icon='account-outline'/>
                                        {agentName()}
                                    </button>
                                </Show>

                                {/* The machine's projects are answers here,
                                    not options in a list: planning has no
                                    card to name one for it. */}
                                <Show when={projects().length > 0}>
                                    <div class='PlanningDialog__folderChoices'>
                                        <For each={projects()}>
                                            {(r) => (
                                                <button
                                                    type='button'
                                                    class='PlanningDialog__folderChoice'
                                                    disabled={busy()}
                                                    onClick={() => start(r.name)}
                                                >
                                                    {r.name}
                                                </button>
                                            )}
                                        </For>
                                    </div>
                                </Show>

                                <div class='PlanningDialog__pickActions'>
                                    <Button
                                        filled={true}
                                        onClick={() => start('')}
                                        disabled={busy()}
                                    >
                                        {intl.formatMessage({id: 'CardTerminal.board-folder', defaultMessage: 'Use the board’s folder'})}
                                    </Button>
                                    <Show when={Boolean(bindings?.PickDirectory)}>
                                        <Button
                                            onClick={pickFolderAndStart}
                                            disabled={busy()}
                                        >
                                            {intl.formatMessage({id: 'CardTerminal.pick-folder', defaultMessage: 'Choose a folder…'})}
                                        </Button>
                                    </Show>
                                </div>
                                <div class='PlanningDialog__pickNote'>
                                    {intl.formatMessage({id: 'CardTerminal.board-folder-note', defaultMessage: 'The board’s folder is where its agents keep what they write for the board’s cards — briefs, drafts, notes. There is no code in it.'})}
                                </div>
                            </div>
                        </>
                    }
                >
                    <div class='PlanningDialog__ask'>
                        {intl.formatMessage({id: 'CardTerminal.ask-agent', defaultMessage: 'Who talks here?'})}
                    </div>
                    <div class='PlanningDialog__picker'>
                        <div class='PlanningDialog__agentChoices'>
                            <For each={agents()}>
                                {(a) => (
                                    <button
                                        type='button'
                                        class='PlanningDialog__agentChoice'
                                        disabled={busy()}
                                        onClick={() => setAgentName(a.name)}
                                    >
                                        {a.name}
                                    </button>
                                )}
                            </For>
                            <Show when={!addingAgent()}>
                                <button
                                    type='button'
                                    class='PlanningDialog__pickAdd'
                                    onClick={() => setAddingAgent(true)}
                                >
                                    {intl.formatMessage({id: 'CardTerminal.add-agent', defaultMessage: 'Add an agent…'})}
                                </button>
                            </Show>
                        </div>
                        <Show when={addingAgent()}>
                            <AgentQuickAdd
                                board={props.board}
                                onAdded={async (name) => {
                                    setAddingAgent(false)
                                    await refreshChoices()
                                    setAgentName(name)
                                }}
                                onCancel={() => setAddingAgent(false)}
                            />
                        </Show>
                    </div>
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
                                    {terminalLabel(t)}
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
