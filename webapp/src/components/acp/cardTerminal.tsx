// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, Suspense, createSignal, lazy, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {Board} from '../../blocks/board'
import CompassIcon from '../../widgets/icons/compassIcon'

import {agentBindings} from './bindings'
import {cardAgentState, refreshCardAgent, type CardConversation} from './cardAgentState'
import {isCardTerminalAvailable} from './liveTerminals'
import AgentQuickAdd from './agentQuickAdd'
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
// What is left is the terminal and nothing else, in a panel of its own beside
// the card. The branch and the worktree are on the stamp under the card's
// title, which says the same thing in a line rather than a block.
//
// **This panel is the card's own conversation, and only that.** It is where a
// person thinks about the card — the wording, the plan, the brief — and it
// needs nothing of the card to open: no folder, no route, no agent assigned.
// It is kept, so tomorrow it carries on where it stopped.
//
// The route's conversations are not this. A card travels its stages, each of
// which opens a CLI of its own with the card's task in it, and those are listed
// as chips under the head rather than shown here. The two used to share a key,
// and a stage starting while somebody was talking typed the card's task into
// their conversation.
//
// The panel starts the terminal as it opens, because opening it *is* the ask —
// there is nothing else in here to look at first.

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

    // The head says what this panel is showing, and this panel always shows the
    // card's own conversation — the stages are listed beside it.
    const stageChips = () => conversations().filter((c) => !c.brainstorm)

    // The chips exist once there is more than the card's own conversation to
    // tell apart: one conversation is the whole story and needs no row about
    // itself.
    const showsStages = () => stageChips().length > 0

    const stageLabel = (c: CardConversation) => {
        if (c.brainstorm) {
            return intl.formatMessage({id: 'CardTerminal.brainstorm', defaultMessage: 'Discussion'})
        }
        return c.column || intl.formatMessage({id: 'CardTerminal.no-stage', defaultMessage: 'before the route'})
    }
    const stageTitle = (c: CardConversation) => {
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

    return (
        <div class='CardTerminal'>
            <div class='CardTerminal__head'>
                <span class='CardTerminal__title'>
                    {intl.formatMessage({id: 'CardTerminal.title', defaultMessage: 'Terminal'})}
                    <span class='CardTerminal__stage'>
                        {` · ${intl.formatMessage({id: 'CardTerminal.brainstorm', defaultMessage: 'Discussion'})}`}
                    </span>
                </span>
                <Show when={state().session?.status}>
                    <span class='CardTerminal__status'>{state().session?.status}</span>
                </Show>
                <div class='CardTerminal__actions'>
                    {/* Only once there is a terminal to hand over: a window
                        onto a conversation that has not started is a window
                        onto nothing. The glyph is the compass font's own
                        open-in-new — the app's icons come from there, and a
                        unicode arrow was the one stranger among them. */}
                    <Show when={terminalId()}>
                        <button
                            type='button'
                            class='CardTerminal__button'
                            title={intl.formatMessage({id: 'CardTerminal.window', defaultMessage: 'Open in a separate window'})}
                            aria-label={intl.formatMessage({id: 'CardTerminal.window', defaultMessage: 'Open in a separate window'})}
                            disabled={busy()}
                            onClick={() => start(true)}
                        >
                            <CompassIcon icon='open-in-new'/>
                        </button>
                    </Show>
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

            {/* The route's conversations, one per stage the card was worked on.
                Chips, not buttons: this panel is the card's own conversation,
                and these say where the route has taken it — a running one is
                reached from the card's own terminal button, which turns amber
                when its agent is waiting. */}
            <Show when={showsStages()}>
                <div class='CardTerminal__stages'>
                    <For each={stageChips()}>
                        {(c) => (
                            <span
                                class='CardTerminal__stageChip'
                                classList={{
                                    'CardTerminal__stageChip--current': Boolean(c.current),
                                    'CardTerminal__stageChip--running': Boolean(c.running) && !c.current,
                                }}
                                title={stageTitle(c)}
                            >
                                {stageLabel(c)}
                                <Show when={c.agent}>
                                    <span class='CardTerminal__stageAgent'>{` — ${c.agent}`}</span>
                                </Show>
                            </span>
                        )}
                    </For>
                </div>
            </Show>

            <Show when={terminalId()}>
                {(id) => (
                    <div class='CardTerminal__screen'>
                        <Suspense fallback={null}>
                            <InlineTerminal terminalId={id()}/>
                        </Suspense>
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
