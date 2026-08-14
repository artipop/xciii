// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Index, Show, Suspense, createSignal, lazy, onCleanup, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {Board} from '../../blocks/board'
import CompassIcon from '../../widgets/icons/compassIcon'

import {agentBindings} from './bindings'
import {onAgentEvent} from './agentEvents'
import {cardAgentState, refreshCardAgent, type CardConversation} from './cardAgentState'
import {isCardTerminalAvailable} from './liveTerminals'
import AgentQuickAdd from './agentQuickAdd'
import ConversationRow, {type ConversationAction} from './conversationRow'
import FolderChoices from './folderChoices'

import './cardTerminal.scss'

// The agent, beside the card rather than inside it.
//
// There was a row in the card's body once — the agent's name, the session
// status, the branch with a deploy button, a form asking which folder and which
// agent to use, and a chevron that opened the terminal downwards. All of it is
// gone, and for one reason: a card is a person's own writing, and every one of
// those was the machine talking in the middle of it. The card was overloaded,
// and the thing a person actually wanted there — the terminal — was the part
// hardest to find.
//
// What is left is the card's conversations and one of them open. **The card's
// own** — «Обсуждение» — is where a person thinks about the card: the wording,
// the plan, the brief. It needs nothing of the card to open (no folder, no
// route, no agent assigned), it is kept, so tomorrow it carries on where it
// stopped, and it is the only one that can be thrown away by hand. **The
// route's** are one per stage the card was worked on, opened by the route
// alone: a stage's conversation belongs to the stage, and it is listed here
// because a person watching a card wants to see it, not because this panel
// starts it.
//
// The two used to share a key, and a stage starting while somebody was talking
// typed the card's task into their conversation. They are separate now, and the
// list is what says so.
//
// The list is the same one «Обсудить с агентом» draws (conversationRow.tsx),
// because it lists the same thing. What the card's own list adds is the
// terminal underneath it: this panel sits beside a card and is read, not just
// picked from.

// Lazily, like the terminal's own route: xterm is a large chunk, and a card
// whose panel is never opened should not pay for the emulator.
const InlineTerminal = lazy(() => import('./terminalPage'))

// Re-exported so the dialog beside the card asks the panel it draws, not a
// module it otherwise has no reason to know about.
export {isCardTerminalAvailable}

type Props = {
    cardId: string

    // Whose folders to offer when the card cannot say which workdir it is
    // about — a workdir belongs to the board it was added on.
    board: Board
    onClose: () => void
}

const CardTerminal = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()
    const state = cardAgentState(props.cardId)

    const [terminalId, setTerminalId] = createSignal('')
    const [error, setError] = createSignal('')
    const [busy, setBusy] = createSignal(true)

    // The pick, for the conversation Go could not resolve by itself. It lives
    // one conversation: choosing an agent here is «кто планирует со мной
    // сейчас», not an assignment — the card's «Кто занимается» stays whatever
    // a person set it to.
    const [choosing, setChoosing] = createSignal(false)
    const [agents, setAgents] = createSignal<Array<{name: string}>>([])
    const [workdirName, setWorkdirName] = createSignal('')
    const [agentName, setAgentName] = createSignal('')
    const [addingAgent, setAddingAgent] = createSignal(false)

    // inWindow asks for a screen of its own, which is the only thing a panel
    // beside a card cannot be. Go hands back the same terminal either way —
    // and the panel then bows out: two views of one pty fight over its size
    // (each tells the CLI its own columns, the CLI draws for whoever spoke
    // last), so «на весь экран» is a handover, not a copy.
    const start = async (inWindow: boolean) => {
        if (!bindings?.OpenCardTerminal) {
            return
        }
        setBusy(true)
        setError('')
        try {
            const handle = JSON.parse(await bindings.OpenCardTerminal(props.cardId, workdirName(), agentName(), inWindow))

            // The desktop app has already opened the window by now; a server
            // build has no windows, so the browser opens a tab instead.
            if (inWindow) {
                if (!handle.windowed && handle.url) {
                    window.open(handle.url, '_blank', 'noopener')
                }
                props.onClose()
                return
            }
            setChoosing(false)
            setTerminalId(handle.id || '')
            await refreshCardAgent(props.cardId)
        } catch (e: any) {
            setError(String(e?.message || e))

            // Go refused because it could not work out the folder or the agent
            // from the card. This is the moment the question is real — a card
            // in a pre-work column with nobody assigned — so it is asked here,
            // and the conversation it starts is planning in place: the CLI
            // opens on the card, with the board tools to fill it in.
            await offerChoices()
            setChoosing(true)
        } finally {
            setBusy(false)
        }
    }

    // Who is on offer, fetched only when there is something to choose. One of
    // a kind needs no choosing and is filled in rather than asked for. The
    // folder is deliberately never prefilled from the registry: every folder is
    // an answer a person clicks (FolderChoices), and one quietly filled in for
    // them would decide where an agent works without being asked.
    const offerChoices = async () => {
        if (!bindings?.ListAgents) {
            return
        }
        try {
            const parsedAgents = (JSON.parse(await bindings.ListAgents()) || []) as Array<{name: string}>
            setAgents(parsedAgents)
            if (parsedAgents.length === 1) {
                setAgentName(parsedAgents[0].name)
            }
        } catch (e) {
            // An empty registry is not an error to report here.
        }
    }

    // The agent question is open while nobody is named. When the folder is
    // known it is the *only* question the pick exists for, so it stays on
    // screen: a name whose start was refused is a question again, not an
    // answer.
    const askingAgent = () => !agentName() || Boolean(state().folder)

    // A click on a name is the answer. With the folder already known it is
    // also the start; otherwise the folder question follows.
    const chooseAgent = (name: string) => {
        setAgentName(name)
        if (state().folder) {
            start(false)
        }
    }

    // Answering the folder question is what starts the conversation: a folder of
    // the board's by name, or '' for the board's own drafts folder, which is what
    // Go resolves an empty name into. The answers themselves are FolderChoices,
    // shared with «Обсудить с агентом» — one question in one shape.
    const chooseFolder = async (name: string) => {
        setWorkdirName(name)
        await start(false)
    }

    onMount(async () => {
        // A stage of the route may start, end or be named while somebody is
        // reading this panel, and the list has to say so without being closed
        // and opened again. Subscribed before anything is awaited: what happens
        // in between is exactly what a card with a route running on it does.
        onCleanup(onAgentEvent('acp:terminal', () => refreshCardAgent(props.cardId)))

        // What is known about the card comes first, because «no folder» is a
        // question for the person sitting here, never a silent temp directory:
        // a conversation that exists (live or resumable on the current stage)
        // or a card that resolves a folder opens straight away; anything else
        // is the ask below, with «— без папки —» as one of its answers.
        await refreshCardAgent(props.cardId)
        const known = state()

        // The card's *own* conversation, not a stage's: a stage running on this
        // card is not a reason to skip asking where a new discussion should
        // happen.
        const hasConversation = (known.conversations || []).some((c) => c.brainstorm)
        if (known.running || hasConversation || known.folder) {
            start(false)
            return
        }
        await offerChoices()
        setChoosing(true)
        setBusy(false)
    })

    const conversations = () => state().conversations || []
    const brainstorm = () => conversations().find((c) => c.brainstorm)
    const stages = () => conversations().filter((c) => !c.brainstorm)

    // The card's own conversation is the panel's own subject, so it is drawn
    // even before it exists: the pick below is how it comes to.
    const rows = () => {
        const own = brainstorm()
        return own ? [own, ...stages()] : stages()
    }

    const rowName = (c: CardConversation) => {
        if (c.title) {
            return c.title
        }
        if (c.brainstorm) {
            return intl.formatMessage({id: 'CardTerminal.brainstorm', defaultMessage: 'Discussion'})
        }
        return c.column || intl.formatMessage({id: 'CardTerminal.no-stage', defaultMessage: 'before the route'})
    }

    // Who is talking and where, plus which stage this is — the one thing a
    // card's conversation has that a planning one has not.
    const rowMeta = (c: CardConversation) => {
        const where = c.boardFolder ? intl.formatMessage({id: 'Terminal.board-drafts', defaultMessage: 'the board’s drafts'}) : c.folder
        const parts = [c.agent, where].filter(Boolean)
        if (!c.brainstorm && c.title && c.column) {
            parts.push(c.column)
        }
        return parts.join(' · ')
    }

    const rowTitle = (c: CardConversation) => {
        if (c.brainstorm) {
            return intl.formatMessage({id: 'CardTerminal.brainstorm-hint', defaultMessage: 'The card’s own conversation — this panel opens it, and it is kept between sessions'})
        }
        if (c.running) {
            return intl.formatMessage({id: 'CardTerminal.stage-running', defaultMessage: 'A stage of the route, still running — reachable until its CLI exits'})
        }
        if (c.current) {
            return intl.formatMessage({id: 'CardTerminal.stage-current', defaultMessage: 'The stage the card is standing on'})
        }
        return intl.formatMessage({id: 'CardTerminal.stage-passed', defaultMessage: 'A passed stage — its conversation returns if the card does'})
    }

    // Which conversation the panel draws. The card's own starts (or resumes) on
    // a click, because that is what this panel is for; a stage's is shown while
    // its CLI runs and is otherwise nothing to open — the route opens those, and
    // a passed stage's comes back when the card does.
    const pick = (c: CardConversation) => {
        if (c.brainstorm) {
            setError('')
            start(false)
            return
        }
        if (c.terminalId) {
            setError('')
            setTerminalId(c.terminalId)
        }
    }

    const inWindow = async (c: CardConversation) => {
        if (c.brainstorm) {
            await start(true)
            return
        }
        if (!bindings?.ShowTerminal || !c.terminalId) {
            return
        }
        try {
            const handle = JSON.parse(await bindings.ShowTerminal(c.terminalId))
            if (!handle.windowed && handle.url) {
                window.open(handle.url, '_blank', 'noopener')
            }

            // Handed over: the panel must not draw a pty a window is now
            // drawing, or the two fight over its size.
            setTerminalId('')
        } catch (e: any) {
            setError(String(e?.message || e))
        }
        await refreshCardAgent(props.cardId)
    }

    const rename = async (c: CardConversation, title: string) => {
        if (!bindings?.RenameTerminal || !c.terminalId) {
            return
        }
        try {
            await bindings.RenameTerminal(c.terminalId, title)
        } catch (e: any) {
            setError(String(e?.message || e))
        }
        await refreshCardAgent(props.cardId)
    }

    // Asking the agent what to call the conversation it is having. Nothing else
    // knows: a terminal is a vendor CLI in a pty, and the request is typed into
    // it — the answer comes back through the board tools and lands on the row.
    const askName = async (c: CardConversation) => {
        if (!bindings?.AskTerminalName || !c.terminalId) {
            return
        }
        try {
            await bindings.AskTerminalName(c.terminalId)
        } catch (e: any) {
            setError(String(e?.message || e))
        }
    }

    // Throwing the card's own conversation away: the CLI ends and the record
    // goes with it, so the next one starts on a blank screen. It is the only
    // way this conversation ends — everything else about a terminal is kept.
    const discard = async (c: CardConversation) => {
        if (!bindings?.DeleteCardConversation) {
            return
        }
        setBusy(true)
        try {
            await bindings.DeleteCardConversation(props.cardId, c.nodeId || '')
            setTerminalId('')
            setError('')
            await refreshCardAgent(props.cardId)
            await offerChoices()
            setChoosing(true)
        } catch (e: any) {
            setError(String(e?.message || e))
        } finally {
            setBusy(false)
        }
    }

    // Which row the terminal below belongs to, and what to call it there. A
    // conversation that has just been started is drawn before the list has been
    // read back, so the name falls back to the card's own conversation — which
    // is the only one this panel starts.
    const openRow = () => rows().find((c) => c.terminalId && c.terminalId === terminalId())
    const openName = () => {
        const row = openRow()
        return row ? rowName(row) : intl.formatMessage({id: 'CardTerminal.brainstorm', defaultMessage: 'Discussion'})
    }

    const actionsFor = (c: CardConversation) => {
        const actions: ConversationAction[] = []
        if (c.brainstorm || c.terminalId) {
            actions.push({
                icon: 'open-in-new',
                title: intl.formatMessage({id: 'CardTerminal.window', defaultMessage: 'Open in a separate window'}),
                run: () => inWindow(c),
            })
        }
        if (c.running && c.tools) {
            actions.push({
                icon: 'auto-fix',
                title: intl.formatMessage({id: 'Conversation.ask-name', defaultMessage: 'Ask the agent to name this conversation'}),
                run: () => askName(c),
            })
        }
        if (c.brainstorm) {
            actions.push({
                icon: 'trash-can-outline',
                title: intl.formatMessage({id: 'Conversation.delete', defaultMessage: 'Delete the conversation'}),
                confirm: intl.formatMessage({id: 'Conversation.delete-ask', defaultMessage: 'Delete this conversation?'}),
                confirmYes: intl.formatMessage({id: 'Conversation.delete-yes', defaultMessage: 'Delete'}),
                run: () => discard(c),
            })
        }
        return actions
    }

    return (
        <div class='CardTerminal'>
            {/* The panel's own head, and it is about the panel rather than
                about whatever is open in it: «Терминалы», the list under it,
                and the conversation being read below that. The head used to say
                «Терминал» over a list of them, so its ✕ read as closing the
                terminal that was drawn further down. */}
            <div class='CardTerminal__head'>
                <span class='CardTerminal__title'>
                    {intl.formatMessage({id: 'CardTerminal.title', defaultMessage: 'Terminals'})}
                </span>
                <Show when={state().session?.status}>
                    <span class='CardTerminal__status'>{state().session?.status}</span>
                </Show>
                <div class='CardTerminal__actions'>
                    <button
                        type='button'
                        class='CardTerminal__button'
                        title={intl.formatMessage({id: 'CardTerminal.close', defaultMessage: 'Close the panel'})}
                        aria-label={intl.formatMessage({id: 'CardTerminal.close', defaultMessage: 'Close the panel'})}
                        onClick={props.onClose}
                    >
                        <CompassIcon icon='close'/>
                    </button>
                </div>
            </div>

            {/* The card's conversations: its own first, then one per stage the
                route worked it. A row says what the conversation is called, the
                line the agent wrote about it, and who is talking where — the
                same row «Обсудить с агентом» draws, because it is the same
                thing being listed. */}
            <Show when={rows().length > 0}>
                <ul
                    class='ConversationList CardTerminal__conversations'
                    classList={{'CardTerminal__conversations--capped': Boolean(terminalId())}}
                >
                    {/* Index, not For: the list is re-read whenever a terminal
                        starts, ends or is named, and For keys by identity — so
                        every refresh would replace the rows and take a rename
                        somebody was typing, or a delete they had been asked
                        about, with them. The order here is fixed (the card's
                        own conversation, then the stages), which is what makes
                        keying by position honest. */}
                    <Index each={rows()}>
                        {(c) => (
                            <ConversationRow
                                name={rowName(c())}
                                summary={c().summary}
                                meta={rowMeta(c())}
                                running={c().running}
                                selected={Boolean(c().terminalId) && c().terminalId === terminalId()}
                                onPick={c().brainstorm || c().terminalId ? () => pick(c()) : undefined}
                                onRename={c().terminalId ? (title) => rename(c(), title) : undefined}
                                actions={actionsFor(c())}
                                title={rowTitle(c())}
                            />
                        )}
                    </Index>
                </ul>
            </Show>

            {/* The conversation being read, under the list it was picked from,
                with a head of its own: which one this is, a window to move it
                to, and a ✕ that puts it away. That ✕ closes the *view* and
                nothing else — the CLI keeps running, and the row above keeps
                its green dot, because a person who wanted it ended has the bin
                on the row. */}
            <Show when={terminalId()}>
                {(id) => (
                    <div class='CardTerminal__open'>
                        <div class='CardTerminal__openHead'>
                            <span class='CardTerminal__openName'>{openName()}</span>
                            <Show when={openRow()}>
                                <button
                                    type='button'
                                    class='CardTerminal__button'
                                    title={intl.formatMessage({id: 'CardTerminal.window', defaultMessage: 'Open in a separate window'})}
                                    aria-label={intl.formatMessage({id: 'CardTerminal.window', defaultMessage: 'Open in a separate window'})}
                                    onClick={() => inWindow(openRow() as CardConversation)}
                                >
                                    <CompassIcon icon='open-in-new'/>
                                </button>
                            </Show>
                            <button
                                type='button'
                                class='CardTerminal__button'
                                title={intl.formatMessage({id: 'CardTerminal.collapse', defaultMessage: 'Put the terminal away'})}
                                aria-label={intl.formatMessage({id: 'CardTerminal.collapse', defaultMessage: 'Put the terminal away'})}
                                onClick={() => setTerminalId('')}
                            >
                                <CompassIcon icon='close'/>
                            </button>
                        </div>
                        <div class='CardTerminal__screen'>
                            <Suspense fallback={null}>
                                <InlineTerminal terminalId={id()}/>
                            </Suspense>
                        </div>
                    </div>
                )}
            </Show>

            {/* A refusal the picker answers is not an error to shout: the ask
                is the choice below, and the machinery's own words («ни тег
                карточки, ни исходная колонка…») are a technicality demoted to
                small print. Anything else — the app unreachable, a broken
                agent — stays red, because no choice here will fix it. */}
            <Show when={error() && !choosing()}>
                <div class='CardTerminal__error'>
                    <div>{error()}</div>
                </div>
            </Show>

            {/* Go could not work out which folder or which agent, and this is
                the one moment the question is real: a card before any work,
                with nobody assigned. The pick lives one conversation — it
                writes nothing to the card and nothing to the registries
                (except a folder added by hand, which is a registration like
                any other). This deliberately reverses an earlier decision to
                point at the settings instead: planning in place is the point,
                and an errand to the settings is where planning goes to die. */}
            <Show when={choosing()}>
                {/* One question at a time, in the order they are answered:
                    who first, where second. Mixing them drew «выбрать папку»
                    above the agent and the folder buttons below it — the
                    folder question interrupted by somebody else's. Picking an
                    agent is a click on a name, not a select, and when the
                    folder is already known that click is also the start. */}
                <Show
                    when={askingAgent()}
                    fallback={
                        <>
                            <div class='CardTerminal__ask'>
                                {intl.formatMessage({id: 'CardTerminal.ask-folder', defaultMessage: 'Which folder will the agent work in?'})}
                            </div>
                            <div class='CardTerminal__picker'>
                                {/* The answered question, kept in sight: the
                                    name is the way back to it. */}
                                <Show when={agents().length > 1}>
                                    <button
                                        type='button'
                                        class='CardTerminal__pickBack'
                                        title={intl.formatMessage({id: 'CardTerminal.change-agent', defaultMessage: 'Change the agent'})}
                                        onClick={() => setAgentName('')}
                                    >
                                        <CompassIcon icon='account-outline'/>
                                        {agentName()}
                                    </button>
                                </Show>

                                {/* Every answer is a chip, the board's drafts
                                    folder among them: clicking one starts the
                                    conversation, because the choice is the ask. */}
                                <FolderChoices
                                    board={props.board}
                                    disabled={busy()}
                                    onPick={chooseFolder}
                                />
                            </div>
                        </>
                    }
                >
                    <div class='CardTerminal__ask'>
                        {intl.formatMessage({id: 'CardTerminal.ask-agent', defaultMessage: 'Choosing an agent'})}
                    </div>
                    <div class='CardTerminal__picker'>
                        <div class='CardTerminal__agentChoices'>
                            <For each={agents()}>
                                {(a) => (
                                    <button
                                        type='button'
                                        class='CardTerminal__agentChoice'
                                        disabled={busy()}
                                        onClick={() => chooseAgent(a.name)}
                                    >
                                        {a.name}
                                    </button>
                                )}
                            </For>
                            <Show when={!addingAgent()}>
                                <button
                                    type='button'
                                    class='CardTerminal__pickAdd'
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
                                    await offerChoices()
                                    chooseAgent(name)
                                }}
                                onCancel={() => setAddingAgent(false)}
                            />
                        </Show>
                    </div>
                </Show>

                <Show when={error()}>
                    <div class='CardTerminal__reason'>{error()}</div>
                </Show>
            </Show>
        </div>
    )
}

export default CardTerminal
