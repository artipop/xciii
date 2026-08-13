// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onCleanup, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {Board} from '../../blocks/board'
import CompassIcon from '../../widgets/icons/compassIcon'
import Dialog from '../dialog'

import {agentBindings} from './bindings'
import {onAgentEvent} from './agentEvents'
import AgentQuickAdd from './agentQuickAdd'
import FolderChoices from './folderChoices'

import './planningDialog.scss'

// Talking a task through before it exists: the agent's own CLI, in a folder, in
// a window.
//
// This dialog used to hold the conversation itself — a transcript, a prompt box
// and a "create task" turn that boiled the discussion down into a card. The
// conversation now happens where the agent already has a good one, in its
// terminal, so what is left here is two things, in the order a person wants
// them: **the conversations already open**, because a terminal outlives its
// window and one with no card behind it has nothing else to be found through,
// and **a new one**, which is two questions — which agent, then which folder.
//
// The open ones come first on purpose. They used to be a line of buttons at the
// bottom, under the pick, each button labelled «агент · папка» — so the shorter
// path was the one below the longer one, and nothing said what any of those
// conversations was about. Now each is a row that can be read: its name, the
// recap the agent wrote for it (describe_conversation, the only board tool that
// is about the conversation rather than the board), and who is talking where.
// Opening one is an icon, renaming it is an icon, and ending it is an icon with
// a confirmation — a CLI somebody is using must not close on one stray click.
//
// The pick is the same stepped flow the card's terminal asks with
// (cardTerminal.tsx): one question per screen, the answers as things to click.

type NamedEntry = {name: string}
type LiveTerminal = {
    id: string
    agent: string
    cwd: string
    title?: string
    summary?: string
    boardFolder?: boolean
}

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

    const [agents, setAgents] = createSignal<NamedEntry[]>([])
    const [agentName, setAgentName] = createSignal('')
    const [addingAgent, setAddingAgent] = createSignal(false)
    const [terminals, setTerminals] = createSignal<LiveTerminal[]>([])
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal('')

    // Which row is being renamed, and which is being asked about before it is
    // ended. Both are one at a time: they are answers to a question about one
    // conversation.
    const [renaming, setRenaming] = createSignal('')
    const [draft, setDraft] = createSignal('')
    const [ending, setEnding] = createSignal('')

    // Which agent first, which folder second: the agent question is open while
    // nobody is named, and a single registered agent answers it without being
    // asked.
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

    const refreshAgents = async () => {
        if (!bindings?.ListAgents) {
            return
        }
        try {
            const parsed: NamedEntry[] = JSON.parse(await bindings.ListAgents()) || []
            setAgents(parsed)
            if (parsed.length === 1) {
                setAgentName(parsed[0].name)
            }
        } catch (e: any) {
            setError(String(e?.message || e))
        }
    }

    onMount(() => {
        refreshTerminals()
        refreshAgents()

        // The recap arrives while this is open — the agent writes it mid-turn —
        // and so does a terminal ending on its own. One subscription keeps the
        // list true rather than making a person close and reopen the dialog.
        onCleanup(onAgentEvent('acp:terminal', () => refreshTerminals()))
    })

    // The desktop app has already opened the window by the time the binding
    // returns; a server build has no windows, so the browser opens a tab.
    const openWindow = (handle: {windowed?: boolean, url?: string}) => {
        if (!handle.windowed && handle.url) {
            window.open(handle.url, '_blank', 'noopener')
        }
    }

    // Answering the folder question is what starts: a project by name, or '' for
    // the board's own drafts folder, resolved on the Go side.
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

    const beginRename = (terminal: LiveTerminal) => {
        setEnding('')
        setDraft(terminal.title || '')
        setRenaming(terminal.id)
    }

    // An empty name is a cancel, not a nameless conversation: Go refuses one
    // anyway, and the name it already has is the better answer.
    const commitRename = async (id: string) => {
        const title = draft().trim()
        setRenaming('')
        if (!title || !bindings?.RenameTerminal) {
            return
        }
        try {
            await bindings.RenameTerminal(id, title)
            await refreshTerminals()
        } catch (e: any) {
            setError(String(e?.message || e))
        }
    }

    // Ending a terminal ends the CLI in it, which is why it is asked about
    // first. There is no other way to take one off this list: the list *is* the
    // terminals that are running.
    const end = async (id: string) => {
        setEnding('')
        if (!bindings?.CloseTerminal) {
            return
        }
        try {
            await bindings.CloseTerminal(id)
        } catch (e: any) {
            setError(String(e?.message || e))
        }
        await refreshTerminals()
    }

    const terminalName = (t: LiveTerminal) => t.title || t.agent
    const terminalWhere = (t: LiveTerminal) => {
        if (t.boardFolder) {
            return intl.formatMessage({id: 'Terminal.board-drafts', defaultMessage: 'the board’s drafts'})
        }
        return t.cwd.split('/').filter(Boolean).pop() || t.cwd
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
                        defaultMessage: 'Opens the agent\'s CLI in the folder you choose. Nothing is committed without you, and the agent can create the cards you agree on right on this board.',
                    })}
                </p>

                {/* The conversations already open, first: continuing one is
                    shorter than starting another, and two terminals on the same
                    thing is what a list nobody reads leads to. */}
                <Show when={terminals().length > 0}>
                    <section class='PlanningDialog__section'>
                        <h4 class='PlanningDialog__sectionTitle'>
                            {intl.formatMessage({id: 'Planning.terminals-running', defaultMessage: 'Open terminals'})}
                        </h4>
                        <ul class='PlanningDialog__terminals'>
                            <For each={terminals()}>
                                {(t) => (
                                    <li class='PlanningDialog__terminal'>
                                        <div class='PlanningDialog__terminalMain'>
                                            <Show
                                                when={renaming() === t.id}
                                                fallback={
                                                    <button
                                                        type='button'
                                                        class='PlanningDialog__terminalName'
                                                        title={t.cwd}
                                                        onClick={() => show(t.id)}
                                                    >
                                                        {terminalName(t)}
                                                    </button>
                                                }
                                            >
                                                <input
                                                    class='PlanningDialog__terminalRename'
                                                    aria-label={intl.formatMessage({id: 'Planning.rename', defaultMessage: 'Rename the conversation'})}
                                                    value={draft()}
                                                    ref={(el) => queueMicrotask(() => el.focus())}
                                                    onInput={(e) => setDraft(e.currentTarget.value)}
                                                    onBlur={() => commitRename(t.id)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            commitRename(t.id)
                                                        }
                                                        if (e.key === 'Escape') {
                                                            setRenaming('')
                                                        }
                                                    }}
                                                />
                                            </Show>

                                            {/* What the agent said it is doing.
                                                Nothing else here can know it: a
                                                terminal is the vendor CLI in a
                                                pty, and no protocol carries a
                                                recap of one. */}
                                            <Show when={t.summary}>
                                                <div class='PlanningDialog__terminalSummary'>{t.summary}</div>
                                            </Show>
                                            <div class='PlanningDialog__terminalMeta'>
                                                {`${t.agent} · ${terminalWhere(t)}`}
                                            </div>
                                        </div>

                                        <Show
                                            when={ending() === t.id}
                                            fallback={
                                                <div class='PlanningDialog__terminalActions'>
                                                    <button
                                                        type='button'
                                                        class='PlanningDialog__iconButton'
                                                        title={intl.formatMessage({id: 'CardTerminal.window', defaultMessage: 'Open in a separate window'})}
                                                        aria-label={intl.formatMessage({id: 'CardTerminal.window', defaultMessage: 'Open in a separate window'})}
                                                        onClick={() => show(t.id)}
                                                    >
                                                        <CompassIcon icon='open-in-new'/>
                                                    </button>
                                                    <button
                                                        type='button'
                                                        class='PlanningDialog__iconButton'
                                                        title={intl.formatMessage({id: 'Planning.rename', defaultMessage: 'Rename the conversation'})}
                                                        aria-label={intl.formatMessage({id: 'Planning.rename', defaultMessage: 'Rename the conversation'})}
                                                        onClick={() => beginRename(t)}
                                                    >
                                                        <CompassIcon icon='pencil-outline'/>
                                                    </button>
                                                    <button
                                                        type='button'
                                                        class='PlanningDialog__iconButton'
                                                        title={intl.formatMessage({id: 'Planning.end', defaultMessage: 'End the terminal'})}
                                                        aria-label={intl.formatMessage({id: 'Planning.end', defaultMessage: 'End the terminal'})}
                                                        onClick={() => {
                                                            setRenaming('')
                                                            setEnding(t.id)
                                                        }}
                                                    >
                                                        <CompassIcon icon='close'/>
                                                    </button>
                                                </div>
                                            }
                                        >
                                            {/* Asked, because this stops a CLI
                                                somebody is using — and the list
                                                has no other way to shorten. */}
                                            <div class='PlanningDialog__terminalConfirm'>
                                                <span>{intl.formatMessage({id: 'Planning.end-ask', defaultMessage: 'End this terminal?'})}</span>
                                                <button
                                                    type='button'
                                                    class='PlanningDialog__confirmYes'
                                                    onClick={() => end(t.id)}
                                                >
                                                    {intl.formatMessage({id: 'Planning.end-yes', defaultMessage: 'End'})}
                                                </button>
                                                <button
                                                    type='button'
                                                    class='PlanningDialog__confirmNo'
                                                    onClick={() => setEnding('')}
                                                >
                                                    {intl.formatMessage({id: 'Planning.end-no', defaultMessage: 'Cancel'})}
                                                </button>
                                            </div>
                                        </Show>
                                    </li>
                                )}
                            </For>
                        </ul>
                    </section>
                </Show>

                <section class='PlanningDialog__section'>
                    <h4 class='PlanningDialog__sectionTitle'>
                        {intl.formatMessage({id: 'Planning.new-conversation', defaultMessage: 'A new conversation'})}
                    </h4>

                    <Show
                        when={askingAgent()}
                        fallback={
                            <>
                                <div class='PlanningDialog__ask'>
                                    {intl.formatMessage({id: 'CardTerminal.ask-folder', defaultMessage: 'Which folder will the agent work in?'})}
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

                                    <FolderChoices
                                        board={props.board}
                                        disabled={busy()}
                                        onPick={start}
                                    />
                                </div>
                            </>
                        }
                    >
                        <div class='PlanningDialog__ask'>
                            {intl.formatMessage({id: 'CardTerminal.ask-agent', defaultMessage: 'Choosing an agent'})}
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
                                        await refreshAgents()
                                        setAgentName(name)
                                    }}
                                    onCancel={() => setAddingAgent(false)}
                                />
                            </Show>
                        </div>
                    </Show>
                </section>

                <Show when={error()}>
                    <div class='PlanningDialog__error'>{error()}</div>
                </Show>
            </div>
        </Dialog>
    )
}

export default PlanningDialog
