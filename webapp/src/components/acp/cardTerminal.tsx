// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, Suspense, createSignal, lazy, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {Board} from '../../blocks/board'
import Button from '../../widgets/buttons/button'
import CompassIcon from '../../widgets/icons/compassIcon'
import Select from '../../widgets/select'

import {agentBindings} from './bindings'
import {cardAgentState, refreshCardAgent, type CardConversation} from './cardAgentState'
import {isCardTerminalAvailable} from './liveTerminals'
import AgentQuickAdd from './agentQuickAdd'

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
// **A conversation per stage.** A card travels its route, and different agents
// may work its different stages, so the terminal here is the conversation of
// the stage the card stands on — opening the panel opens that one, and the row
// of chips under the head lists the others. A passed stage's conversation is
// closed: it comes back when the card does, because the stage is then current
// again. Only Go knows that rule; there is deliberately no way to ask it for
// another stage's terminal.
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

    // Whose folders to offer when the card cannot say which project it is
    // about — a project belongs to the board it was added on.
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
    const [projects, setProjects] = createSignal<Array<{name: string}>>([])
    const [agents, setAgents] = createSignal<Array<{name: string}>>([])
    const [projectName, setProjectName] = createSignal('')
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
            const handle = JSON.parse(await bindings.OpenCardTerminal(props.cardId, projectName(), agentName(), inWindow))

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

    // What is on offer, fetched only when there is something to choose. One of
    // a kind needs no choosing and is filled in rather than asked for.
    const offerChoices = async () => {
        if (!bindings) {
            return
        }
        try {
            const [projectList, agentList] = await Promise.all([
                bindings.ListAgentProjects ? bindings.ListAgentProjects(props.board.id) : '[]',
                bindings.ListAgents ? bindings.ListAgents() : '[]',
            ])
            const parsedProjects = (JSON.parse(projectList) || []) as Array<{name: string}>
            const parsedAgents = (JSON.parse(agentList) || []) as Array<{name: string}>
            setProjects(parsedProjects)
            setAgents(parsedAgents)
            if (parsedProjects.length === 1) {
                setProjectName(parsedProjects[0].name)
            }
            if (parsedAgents.length === 1) {
                setAgentName(parsedAgents[0].name)
            }
        } catch (e) {
            // An empty registry is not an error to report here.
        }
    }

    // A folder is two answers — where it is and what to call it — and the
    // native picker gives both. It belongs to this board, like every project
    // added anywhere but the "on every board" checkbox.
    const addProject = async () => {
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
            await offerChoices()
            setProjectName(name)
        } catch (e: any) {
            setError(String(e?.message || e))
        }
    }

    onMount(() => {
        start(false)
    })

    const conversations = () => state().conversations || []
    const currentStage = () => conversations().find((c) => c.current)?.column || ''

    // The chips exist once the card has stages to tell apart: one node-less
    // conversation is the whole story and needs no row about itself.
    const showsStages = () => conversations().some((c) => c.nodeId)

    const stageLabel = (c: CardConversation) =>
        c.column || intl.formatMessage({id: 'CardTerminal.no-stage', defaultMessage: 'before the route'})
    const stageTitle = (c: CardConversation) => {
        if (c.current) {
            return intl.formatMessage({id: 'CardTerminal.stage-current', defaultMessage: 'The stage the card is on — this conversation is open here'})
        }
        if (c.running) {
            return intl.formatMessage({id: 'CardTerminal.stage-running', defaultMessage: 'Still running — reachable until its CLI exits'})
        }
        return intl.formatMessage({id: 'CardTerminal.stage-passed', defaultMessage: 'A passed stage — its conversation returns if the card does'})
    }

    return (
        <div class='CardTerminal'>
            <div class='CardTerminal__head'>
                <span class='CardTerminal__title'>
                    {intl.formatMessage({id: 'CardTerminal.title', defaultMessage: 'Terminal'})}
                    <Show when={currentStage()}>
                        <span class='CardTerminal__stage'>{` · ${currentStage()}`}</span>
                    </Show>
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

            {/* The card's conversations, one per stage. Chips, not buttons:
                only the current stage's conversation can be opened, and it is
                the one already open — the rest are the card's history saying
                where it has been worked. */}
            <Show when={showsStages()}>
                <div class='CardTerminal__stages'>
                    <For each={conversations()}>
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
                <div class='CardTerminal__ask'>
                    {intl.formatMessage({id: 'CardTerminal.ask', defaultMessage: 'The card does not say who should talk here — pick an agent. A folder is optional.'})}
                </div>

                {/* A form, not a strip: one question per row — who, then
                    where — each with its answer and its escape hatch aligned,
                    and the one action underneath. The agent comes first
                    because it is the only required answer; «— без папки —»
                    is a real choice, since a conversation needs no folder. */}
                <div class='CardTerminal__picker'>
                    <div class='CardTerminal__pickRow'>
                        <span class='CardTerminal__pickLabel'>
                            {intl.formatMessage({id: 'CardTerminal.agent', defaultMessage: 'Agent'})}
                        </span>
                        <div class='CardTerminal__pickControl'>
                            <Select
                                value={agentName()}
                                options={[
                                    {value: '', label: intl.formatMessage({id: 'CardTerminal.choose-agent', defaultMessage: 'Choose an agent…'})},
                                    ...agents().map((a) => ({value: a.name, label: a.name})),
                                ]}
                                onChange={setAgentName}
                                label={intl.formatMessage({id: 'CardTerminal.agent', defaultMessage: 'Agent'})}
                            />
                        </div>
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
                                setAgentName(name)
                            }}
                            onCancel={() => setAddingAgent(false)}
                        />
                    </Show>

                    <div class='CardTerminal__pickRow'>
                        <span class='CardTerminal__pickLabel'>
                            {intl.formatMessage({id: 'CardTerminal.project', defaultMessage: 'Folder'})}
                        </span>
                        <div class='CardTerminal__pickControl'>
                            <Select
                                value={projectName()}
                                options={[
                                    {value: '', label: intl.formatMessage({id: 'CardTerminal.choose-project', defaultMessage: '— no folder, just talk —'})},
                                    ...projects().map((r) => ({value: r.name, label: r.name})),
                                ]}
                                onChange={setProjectName}
                                label={intl.formatMessage({id: 'CardTerminal.project', defaultMessage: 'Folder'})}
                            />
                        </div>
                        <Show when={Boolean(bindings?.PickDirectory)}>
                            <button
                                type='button'
                                class='CardTerminal__pickAdd'
                                onClick={addProject}
                            >
                                {intl.formatMessage({id: 'CardTerminal.add-project', defaultMessage: 'Add a folder…'})}
                            </button>
                        </Show>
                    </div>

                    <div class='CardTerminal__pickActions'>
                        <Button
                            filled={true}
                            onClick={() => start(false)}
                            disabled={busy() || !agentName()}
                        >
                            {intl.formatMessage({id: 'CardTerminal.start', defaultMessage: 'Start the conversation'})}
                        </Button>
                    </div>
                </div>

                <Show when={error()}>
                    <div class='CardTerminal__reason'>{error()}</div>
                </Show>
            </Show>
        </div>
    )
}

export default CardTerminal
