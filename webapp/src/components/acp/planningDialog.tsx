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
import ConversationRow from './conversationRow'
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
// recap the agent wrote for it (describe_conversation, one of the two board
// tools that are about the conversation rather than the board), and who is
// talking where. The row is conversationRow.tsx, shared with the panel beside a
// card, which lists the same thing — opening is an icon, renaming is an icon,
// asking the agent for a name is an icon, and ending is an icon with a
// confirmation, since a CLI somebody is using must not close on a stray click.
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

    // Whether the CLI was handed the board tools, and therefore whether it can
    // answer «как назвать этот разговор».
    tools?: boolean
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

    // Answering the folder question is what starts: a workdir by name, or '' for
    // the board's own drafts folder, resolved on the Go side.
    const start = async (workdirName: string) => {
        if (!bindings?.OpenPlanningTerminal) {
            return
        }
        setError('')
        setBusy(true)
        try {
            openWindow(JSON.parse(await bindings.OpenPlanningTerminal(workdirName, agentName(), props.board.id)))
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

    const rename = async (id: string, title: string) => {
        if (!bindings?.RenameTerminal) {
            return
        }
        try {
            await bindings.RenameTerminal(id, title)
            await refreshTerminals()
        } catch (e: any) {
            setError(String(e?.message || e))
        }
    }

    // Asking the agent what to call the conversation it is having. Nothing else
    // knows: a terminal is a vendor CLI in a pty, so the request is typed into
    // the conversation itself and the answer comes back through the board
    // tools, landing on this row.
    const askName = async (id: string) => {
        if (!bindings?.AskTerminalName) {
            return
        }
        try {
            await bindings.AskTerminalName(id)
        } catch (e: any) {
            setError(String(e?.message || e))
        }
    }

    // Ending a terminal ends the CLI in it, which is why it is asked about
    // first. There is no other way to take one off this list: the list *is* the
    // terminals that are running.
    const end = async (id: string) => {
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
                        <ul class='ConversationList'>
                            <For each={terminals()}>
                                {(t) => (
                                    <ConversationRow

                                        // Every conversation here is a
                                        // discussion: this list is the ones
                                        // with no card behind them.
                                        icon='message-text-outline'
                                        iconTitle={intl.formatMessage({id: 'Conversation.kind-talk', defaultMessage: 'A discussion'})}
                                        name={terminalName(t)}
                                        summary={t.summary}
                                        meta={`${t.agent} · ${terminalWhere(t)}`}
                                        title={t.cwd}
                                        running={true}
                                        onPick={() => show(t.id)}
                                        onRename={(title) => rename(t.id, title)}
                                        actions={[
                                            {
                                                icon: 'open-in-new',
                                                title: intl.formatMessage({id: 'CardTerminal.window', defaultMessage: 'Open in a separate window'}),
                                                run: () => show(t.id),
                                            },
                                            ...(t.tools ? [{
                                                icon: 'auto-fix',
                                                title: intl.formatMessage({id: 'Conversation.ask-name', defaultMessage: 'Ask the agent to name this conversation'}),
                                                run: () => askName(t.id),
                                            }] : []),
                                            {
                                                icon: 'close',
                                                title: intl.formatMessage({id: 'Planning.end', defaultMessage: 'End the terminal'}),
                                                confirm: intl.formatMessage({id: 'Planning.end-ask', defaultMessage: 'End this terminal?'}),
                                                confirmYes: intl.formatMessage({id: 'Planning.end-yes', defaultMessage: 'End'}),
                                                run: () => end(t.id),
                                            },
                                        ]}
                                    />
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
