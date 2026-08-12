// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onCleanup, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {Board} from '../../blocks/board'
import Button from '../../widgets/buttons/button'
import Select from '../../widgets/select'

import {agentBindings} from './bindings'
import {onAgentEvent} from './agentEvents'
import {cardAgentState, refreshCardAgent} from './cardAgentState'
import {answerQuestion, attentionHeading, useCardAttention} from './attention'
import AgentQuickAdd from './agentQuickAdd'

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
//
// Which agent and which folder is asked here too, but only when it has to be:
// a card on an ordinary board has neither, and a row of empty dropdowns on
// every card would say the opposite. So the choice appears when the terminal is
// asked for and the answer is not already known, and each list ends with the
// short form that registers a new one — because sending somebody to the
// settings and back is how a two-field answer becomes an errand.

export function isCardAgentAvailable(): boolean {
    return Boolean(agentBindings()?.GetCardAgent)
}

type Props = {
    cardId: string

    // The board this card is on: whose projects to offer when the card names
    // none (a project belongs to the board it was added on), and where an agent
    // registered from here has to become nameable.
    board: Board
}

const CardAgent = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()

    // Shared with the case stamp above the title, so the two never disagree
    // and the card asks Go once.
    const state = cardAgentState(props.cardId)
    const [projects, setProjects] = createSignal<Array<{name: string}>>([])
    const [agents, setAgents] = createSignal<Array<{name: string}>>([])
    const [projectName, setProjectName] = createSignal('')
    const [agentName, setAgentName] = createSignal('')
    const [choosing, setChoosing] = createSignal(false)
    const [addingAgent, setAddingAgent] = createSignal(false)
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal('')
    const [deployStatus, setDeployStatus] = createSignal('')
    const [answerText, setAnswerText] = createSignal('')

    const refresh = async () => {
        try {
            await refreshCardAgent(props.cardId)
        } catch (e: any) {
            setError(String(e?.message || e))
        }
    }

    onMount(() => {
        refresh()
        const offSession = onAgentEvent('acp:session', (payload: any) => {
            if (!payload?.cardId || payload.cardId === props.cardId) {
                refresh()
            }
        })
        const offTerminal = onAgentEvent('acp:terminal', (payload: any) => {
            if (!payload?.cardId || payload.cardId === props.cardId) {
                refresh()
            }
        })
        onCleanup(() => {
            offSession?.()
            offTerminal?.()
        })
    })

    // What is on offer, fetched only when somebody is about to choose. One of a
    // kind needs no choosing, and is filled in rather than asked for.
    const offerChoices = async () => {
        if (!bindings) {
            return
        }
        try {
            const [projectList, agentList] = await Promise.all([
                bindings.ListAgentProjects ? bindings.ListAgentProjects(props.board.id) : '[]',
                bindings.ListAgents ? bindings.ListAgents() : '[]',
            ])
            const parsedProjects = JSON.parse(projectList) || []
            const parsedAgents = JSON.parse(agentList) || []
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
    // native picker gives both, so it needs no form of its own. It belongs to
    // this board, like every project added anywhere but the "on every board"
    // checkbox.
    const addProject = async () => {
        if (!bindings?.PickDirectory || !bindings.AddAgentProject) {
            return
        }
        setError('')
        try {
            const path = await bindings.PickDirectory(intl.formatMessage({id: 'CardAgent.pick-project', defaultMessage: 'Choose a folder to work in'}))
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

    const start = async () => {
        if (!bindings?.OpenCardTerminal) {
            return
        }
        setBusy(true)
        setError('')
        try {
            const handle = JSON.parse(await bindings.OpenCardTerminal(props.cardId, projectName(), agentName()))

            // The desktop app has already opened the window by now; a server
            // build has no windows, so the browser opens a tab instead.
            if (!handle.windowed && handle.url) {
                window.open(handle.url, '_blank', 'noopener')
            }
            setChoosing(false)
            await refresh()
        } catch (e: any) {
            setError(String(e?.message || e))

            // Go refused because it could not work out the project or the
            // agent from the card. Asking is the answer, and this is the moment
            // it is worth asking — not on every card that was ever opened.
            await offerChoices()
            setChoosing(true)
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

    // The same wait the board shows a dot for, said in words on the card it
    // belongs to — next to the button that opens the terminal it is waiting in.
    const attention = useCardAttention(() => props.cardId)

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
                <Show when={attention()}>
                    <span
                        class='CardAgent__waiting'
                        title={attentionHeading(intl, attention()!)}
                    >
                        {attention()!.reason === 'question' ? intl.formatMessage({id: 'CardAgent.asking', defaultMessage: 'asking you'}) : intl.formatMessage({id: 'CardAgent.waiting', defaultMessage: 'waiting for you'})}
                    </span>
                </Show>
                <div class='CardAgent__actions'>
                    <Button
                        onClick={start}
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

            {/* The agent's question, on the card it is about. The same thing the
                notification carries — answered in either place, whichever the
                person is looking at. */}
            <Show when={attention()?.reason === 'question' && attention()}>
                {(question) => (
                    <div class='CardAgent__question'>
                        <div class='CardAgent__questionText'>{question().text}</div>
                        <div class='CardAgent__questionOptions'>
                            <For each={question().options || []}>
                                {(option) => (
                                    <Button
                                        onClick={() => answerQuestion(question(), option.id, '')}
                                        title={option.description}
                                    >
                                        {option.label}
                                    </Button>
                                )}
                            </For>
                        </div>
                        <Show when={question().freeText}>
                            <form
                                class='CardAgent__questionFree'
                                onSubmit={(e) => {
                                    e.preventDefault()
                                    answerQuestion(question(), '', answerText())
                                    setAnswerText('')
                                }}
                            >
                                <input
                                    type='text'
                                    placeholder={intl.formatMessage({id: 'Attention.free-text', defaultMessage: 'Answer in your own words…'})}
                                    value={answerText()}
                                    onInput={(e) => setAnswerText(e.currentTarget.value)}
                                />
                                <Button
                                    submit={true}
                                    disabled={!answerText()}
                                >
                                    {intl.formatMessage({id: 'Attention.send', defaultMessage: 'Send'})}
                                </Button>
                            </form>
                        </Show>
                    </div>
                )}
            </Show>

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

            {/* Only after the terminal was asked for and could not be worked
                out — never as a standing row on every card. */}
            <Show when={choosing()}>
                <div class='CardAgent__picker'>
                    <label>
                        {intl.formatMessage({id: 'CardAgent.project', defaultMessage: 'Folder'})}
                        <Select
                            value={projectName()}
                            options={[
                                {value: '', label: intl.formatMessage({id: 'CardAgent.choose-project', defaultMessage: 'Choose a folder…'})},
                                ...projects().map((r) => ({value: r.name, label: r.name})),
                            ]}
                            onChange={setProjectName}
                            label={intl.formatMessage({id: 'CardAgent.project', defaultMessage: 'Folder'})}
                        />
                    </label>

                    {/* Beside the list rather than the last entry in it: a
                        sentinel option is a value a folder could one day be
                        called, and a button cannot be picked by mistake. */}
                    <Show when={Boolean(bindings?.PickDirectory)}>
                        <Button onClick={addProject}>
                            {intl.formatMessage({id: 'CardAgent.add-project', defaultMessage: 'Add a folder…'})}
                        </Button>
                    </Show>

                    <label>
                        {intl.formatMessage({id: 'CardAgent.agent', defaultMessage: 'Agent'})}
                        <Select
                            value={agentName()}
                            options={[
                                {value: '', label: intl.formatMessage({id: 'CardAgent.choose-agent', defaultMessage: 'Choose an agent…'})},
                                ...agents().map((a) => ({value: a.name, label: a.name})),
                            ]}
                            onChange={setAgentName}
                            label={intl.formatMessage({id: 'CardAgent.agent', defaultMessage: 'Agent'})}
                        />
                    </label>
                    <Show when={!addingAgent()}>
                        <Button onClick={() => setAddingAgent(true)}>
                            {intl.formatMessage({id: 'CardAgent.add-agent', defaultMessage: 'Add an agent…'})}
                        </Button>
                    </Show>

                    <Button
                        onClick={start}
                        disabled={busy() || !projectName() || !agentName()}
                    >
                        {intl.formatMessage({id: 'CardAgent.terminal-open', defaultMessage: 'Open terminal'})}
                    </Button>
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
            </Show>
        </div>
    )
}

export default CardAgent
