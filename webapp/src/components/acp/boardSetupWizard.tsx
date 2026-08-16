// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createEffect, createSignal, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {Board} from '../../blocks/board'
import Button from '../../widgets/buttons/button'
import Dialog from '../dialog'

import {sendFlashMessage} from '../flashMessages'

import {agentBindings} from './bindings'
import {invalidateBoardAgents} from './boardAgents'
import {textToServers} from './mcpServers'
import AgentQuickAdd from './agentQuickAdd'
import {agentColumn, checkSetupAnswer, createSetupPlan, recordSetupStep, SetupStep, SetupStepKind, stepRequires} from './boardSetup'
import {Workdir, syncWorkdirsToBoard, useWorkdirHere} from './workdirSync'

import './boardSetupWizard.scss'

// A board made from a template arrives knowing how the work is organised — its
// columns, its routes, the fields a card picks a folder and an agent with.
// What it cannot know is the machine: which agent runs, in which folder, where
// it deploys, what it tests with. That lives in the desktop registries, and
// until this existed the only way to find out one was empty was to drag a card
// and read the complaint afterwards.
//
// Which questions this board has is not decided here: Go resolves them into a
// plan (internal/acp/setup.go) out of what the board asks for, what its
// automation implies and what this machine already has. This walks that plan
// and knows how to ask each kind of question — nothing more.

// The playwright server, offered as the answer to "what tests with". It is the
// shape any MCP client takes, so it can also be replaced by a paste.
const BROWSER_SERVER = JSON.stringify({
    mcpServers: {
        playwright: {command: 'npx', args: ['-y', '@playwright/mcp@latest', '--headless']},
    },
}, null, 2)

type Registry = {
    agents: Array<{name: string, kind: string}>
    workdirs: Array<{name: string, path: string}>
}

// readRegistry is what the steps show back: the names already registered. The
// plan says whether a question is answered; this says what the answer was.
export async function readRegistry(boardId: string): Promise<Registry | null> {
    const bindings = agentBindings()
    if (!bindings?.ListAgentWorkdirs || !bindings.ListAgents) {
        return null
    }
    const [workdirs, agents] = await Promise.all([bindings.ListAgentWorkdirs(boardId), bindings.ListAgents()])
    return {workdirs: JSON.parse(workdirs) || [], agents: JSON.parse(agents) || []}
}

type Props = {
    board: Board
    onClose: () => void
}

const STEP_WORKDIR: SetupStepKind = 'project'
const STEP_AGENT: SetupStepKind = 'agent'
const STEP_DEPLOY: SetupStepKind = 'deploy'
const STEP_BROWSER: SetupStepKind = 'browser'
const STEP_SOURCE: SetupStepKind = 'source'
const STEP_DONE: SetupStepKind = 'done'

const BoardSetupWizard = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [plan, refreshPlan] = createSetupPlan(() => props.board)
    const [step, setStep] = createSignal<SetupStepKind>(STEP_WORKDIR)
    const [registry, setRegistry] = createSignal<Registry>({agents: [], workdirs: []})
    const [error, setError] = createSignal('')
    const [busy, setBusy] = createSignal(false)

    // The steps this board asks for, in the order it asks for them. A plan that
    // has not arrived yet is a dialog with one step, which is what it should
    // look like while it is loading: nothing to answer.
    const steps = (): SetupStep[] => plan()?.steps || []

    // Where the wizard goes on from a step: the next one this board asks for.
    const after = (current: SetupStepKind): SetupStepKind => {
        const order = steps()
        const next = order[order.findIndex((s) => s.kind === current) + 1]
        return next ? next.kind : STEP_DONE
    }

    // The step being shown, if this board asks for it at all — its own sentence
    // hangs off it.
    const stepAt = (kind: SetupStepKind) => steps().find((s) => s.kind === kind)

    // Skipping is the one answer no registry can be read for later, so it is
    // recorded; the plan reads it back as the step's status.
    const skip = (kind: SetupStepKind) => {
        recordSetupStep(props.board.id, kind, 'skipped').
            then(() => refreshPlan()).
            catch(() => undefined)
        setStep(after(kind))
    }

    // Step 1: a folder.
    const [workdirPath, setWorkdirPath] = createSignal('')
    const [workdirName, setWorkdirName] = createSignal('')

    // A folder already in the registry, picked again — offered rather than
    // refused (see the folders panel).
    const [taken, setTaken] = createSignal<Workdir | null>(null)
    const basename = (path: string) => path.split('/').filter(Boolean).pop() || ''

    // Step 2: who works this board, and another agent on a step that already
    // has one.
    const [addingAgent, setAddingAgent] = createSignal(false)
    const [boardAgents, setBoardAgents] = createSignal<string[]>([])

    // Whether the chips have been answered here, as opposed to filled in from
    // the plan. Nobody chosen is an answer — it takes the crew off — so "is the
    // list empty" cannot stand for "has anybody said anything".
    const [agentPicked, setAgentPicked] = createSignal(false)

    const chosenAgent = (name: string) => boardAgents().some((n) => n === name)

    // A chip is a toggle: clicking the one that is on takes it off, which is
    // how "nobody" is said. Several may be on — a column's crew is a list, and
    // the engine hands the card to whichever member is free.
    const toggleAgent = (name: string) => {
        setAgentPicked(true)
        setBoardAgents((chosen) => (chosen.includes(name) ? chosen.filter((n) => n !== name) : [...chosen, name]))
    }

    // Step 3: a Dokku host.
    const [deploy, setDeploy] = createSignal({name: '', sshHost: '', sshUser: '', sshKey: '', baseDomain: ''})

    // Step 4: who tests, and what it tests with. The two are one answer — a
    // test session runs the crew of the test column, and refuses to start
    // without a browser server on the agent it resolved — so the server is
    // given to the agent chosen here and that agent becomes the column's crew.
    const [serversText, setServersText] = createSignal(BROWSER_SERVER)
    const [testAgent, setTestAgent] = createSignal('')
    const [addingTestAgent, setAddingTestAgent] = createSignal(false)
    const [sourceName, setSourceName] = createSignal('')
    const [sourceToken, setSourceToken] = createSignal('')

    const refresh = async () => {
        try {
            const loaded = await readRegistry(props.board.id)
            if (loaded) {
                setRegistry(loaded)

                // One of a kind needs no choosing: the QA question is then
                // about the browser alone.
                if (!testAgent() && loaded.agents.length === 1) {
                    setTestAgent(loaded.agents[0].name)
                }
            }
        } catch (e) {
            setError(String(e))
        }
    }

    onMount(() => {
        refresh()
    })

    // Who the board's agent stages are already crewed with: the step opens on
    // the answer it was given last time rather than on nobody. Only until
    // somebody touches the chips — a plan is refetched after every answer, and
    // it must never reinstate a name just taken off.
    createEffect(() => {
        const named = plan()?.workAgents
        if (named?.length && !agentPicked()) {
            setBoardAgents(named)
        }
    })

    // The wizard opens on the first question this board still has. Walking
    // somebody through what they have already answered is how a setup dialog
    // earns being clicked through without reading. Only when the plan first
    // arrives, though: it is refetched after every answer, and moving the
    // person then would take the step out of their hands.
    let opened = false
    createEffect(() => {
        const list = steps()
        if (opened || list.length === 0) {
            return
        }
        opened = true
        setStep((list.find((s) => s.status === 'pending') || list[0]).kind)
    })

    // Every step does its work through the same registry calls the dialogs use,
    // and shows what Go says when it refuses. The step is recorded as answered
    // for *this board* — the registries are the machine's and say nothing about
    // whether this board has been through the questions.
    const run = async (work: () => Promise<void>, answering: SetupStepKind) => {
        setError('')
        setBusy(true)
        try {
            await work()
            await recordSetupStep(props.board.id, answering, 'done')
            await refresh()
            refreshPlan()
            setStep(after(answering))
        } catch (e) {
            setError(String(e))
        } finally {
            setBusy(false)
        }
    }

    // Passing a step the machine can already answer — there is a folder, an
    // agent — is answering it too, and has to be recorded as one.
    const pass = (answering: SetupStepKind) => run(async () => {}, answering)

    const pickWorkdir = async () => {
        if (!bindings?.PickDirectory) {
            return
        }
        setError('')
        try {
            const picked = await bindings.PickDirectory(intl.formatMessage({id: 'BoardSetup.pick-folder', defaultMessage: 'Choose a folder'}))
            if (picked) {
                // The name follows the folder while nobody has typed one: it
                // was filled in from the last pick, so picking again must
                // refill it — a second choice with the first one's name is a
                // folder registered under the wrong word. A name somebody
                // actually typed is theirs and survives the change.
                const previous = basename(workdirPath())
                setWorkdirName((current) => (!current || current === previous ? basename(picked) : current))
                setWorkdirPath(picked)
                setTaken(JSON.parse(await bindings.FindAgentWorkdir?.(picked) || 'null'))
            }
        } catch (e) {
            setError(String(e))
        }
    }

    // The folder is already somebody's: using it here is one call and no new
    // registry entry, and the step is answered by it just the same.
    const useTakenWorkdir = () => run(async () => {
        const entry = taken()
        if (entry) {
            await useWorkdirHere(entry, props.board.id)
            setTaken(null)
        }
        await syncWorkdirsToBoard(props.board, JSON.parse(await bindings!.ListAgentWorkdirs(props.board.id)) || [])
    }, STEP_WORKDIR)

    const addWorkdir = () => run(async () => {
        // Asked before it is filed: a board that publishes a branch needs a
        // folder under git, and this is where that can still be answered.
        await checkSetupAnswer(props.board.id, STEP_WORKDIR, workdirPath())

        // Filed as a repository when that is what was asked for, so the answer
        // outlives the question: a folder that stops being one later says so
        // instead of quietly becoming an ordinary folder on a board whose
        // every route waits for a branch.
        const kind = stepRequires(stepAt(STEP_WORKDIR), 'git') ? 'git' : ''
        await bindings!.AddAgentWorkdir!(workdirName().trim(), workdirPath(), props.board.id, kind, false)

        // And onto the board, because the registry alone is not an answer: a
        // card names its folder with an option of the board's own field, so a
        // folder added here and nowhere else left the person who had just
        // answered this question with nothing to pick on the card.
        await syncWorkdirsToBoard(props.board, JSON.parse(await bindings!.ListAgentWorkdirs(props.board.id)) || [])
    }, STEP_WORKDIR)

    const addDeploy = () => run(async () => {
        await bindings!.AddDeployTarget!(JSON.stringify({
            name: deploy().name.trim(),
            sshHost: deploy().sshHost.trim(),
            sshUser: deploy().sshUser.trim(),
            sshKey: deploy().sshKey.trim(),
            baseDomain: deploy().baseDomain.trim(),
        }))
    }, STEP_DEPLOY)

    // The token is shown here and only here: a hash is what is kept, so the
    // moment the source is created is the only moment it can be read.
    const addSource = () => run(async () => {
        const created = JSON.parse(await bindings!.AddSource!(JSON.stringify({
            name: sourceName().trim(),
            boardId: props.board.id,
            enabled: true,
            noisy: true,
        })))
        setSourceToken(created.token || '')
    }, STEP_SOURCE)

    // The answer is one call because it is one answer: Go puts the server on
    // the chosen agent — keeping the rest of its entry, which a rebuilt one
    // dropped — and writes that agent into the test column as its crew. Before
    // this the server went to whoever the registry listed first, and on a board
    // with two agents the column ran the other one and the session died saying
    // it had nothing to test with.
    const addBrowser = () => {
        let servers
        try {
            servers = textToServers(serversText())
        } catch {
            setError(intl.formatMessage({id: 'BoardSetup.browser-invalid', defaultMessage: 'The browser server must be valid JSON: a server name mapped to its command and args, the same block any MCP client takes.'}))
            return
        }
        run(async () => {
            await bindings!.SetBoardTestAgent!(props.board.id, testAgent(), JSON.stringify(servers))
        }, STEP_BROWSER)
    }

    const finish = async () => {
        // Take the board's own columns and routes now, so what it can do is
        // visible without waiting for the first card to be moved.
        if (bindings?.SeedBoardAutomation) {
            try {
                await bindings.SeedBoardAutomation(props.board.id)
            } catch (e) {
                setError(String(e))
                return
            }
        }
        props.onClose()
    }

    const hasWorkdir = () => registry().workdirs.length > 0
    const hasAgent = () => registry().agents.length > 0

    // Whether the folder step has something to answer with: one already on this
    // board, one picked and named, or one somebody else registered and offered
    // for use here.
    const workdirAnswered = () => Boolean(taken()) || hasWorkdir() || Boolean(workdirPath() && workdirName().trim())

    // Answering the agent step: what the chips show is written as the crew of
    // the board's agent stages — nobody included, which takes the crew off and
    // puts the board back to offering every agent on the machine.
    //
    // Only once somebody has touched them, though. Chips filled in from the
    // plan are a picture of what is already there, and «Дальше» pressed without
    // looking must not rewrite it — the plan shows nothing when two columns are
    // crewed differently, and that would flatten both into one.
    const takeAgent = () => {
        if (!agentPicked() || !bindings?.SetBoardWorkAgent) {
            return pass(STEP_AGENT)
        }
        return run(async () => {
            await bindings.SetBoardWorkAgent!(props.board.id, JSON.stringify(boardAgents()))

            // The card's assignee list is drawn from the same crew, and
            // nothing on the Go side announces the change.
            invalidateBoardAgents()
        }, STEP_AGENT)
    }

    const body = () => {
        switch (step()) {
        case STEP_WORKDIR:
            return (
                <div class='BoardSetupWizard__step'>
                    <p>{intl.formatMessage({id: 'BoardSetup.folder-why', defaultMessage: 'An agent works in a folder on your machine. A card is matched to one by its folder field, which this fills in for you.'})}</p>
                    <Show when={stepRequires(stepAt(STEP_WORKDIR), 'git')}>
                        <p class='BoardSetupWizard__hint'>
                            {intl.formatMessage({id: 'BoardSetup.folder-git', defaultMessage: 'This board publishes a branch or waits for one, so its folder has to be a git repository. A board that does neither takes any folder.'})}
                        </p>
                    </Show>
                    <Show when={hasWorkdir()}>
                        <div class='BoardSetupWizard__known'>
                            {intl.formatMessage({id: 'BoardSetup.folder-known', defaultMessage: 'Already registered: {names}'}, {names: registry().workdirs.map((r) => r.name).join(', ')})}
                        </div>
                    </Show>

                    {/* What passing costs, said where it can be acted on: a
                        card with no folder can still be talked over — that
                        conversation opens in the board's drafts folder — but a
                        stage of a route has nowhere to work and waits. */}
                    <Show when={!workdirAnswered()}>
                        <p class='BoardSetupWizard__hint'>
                            {intl.formatMessage({id: 'BoardSetup.folder-skip', defaultMessage: 'This can be answered later. Without a folder a card can still be discussed with an agent — in the board’s drafts folder — but a card on a route will wait at the stage that works it.'})}
                        </p>
                    </Show>
                    <Button onClick={pickWorkdir}>
                        {intl.formatMessage({id: 'BoardSetup.choose-folder', defaultMessage: 'Choose a folder…'})}
                    </Button>
                    {/* Already added, on this board or another: an offer, not
                        a refusal — the person picked the folder they meant. */}
                    <Show when={taken()}>
                        {(entry) => (
                            <div class='BoardSetupWizard__known'>
                                {intl.formatMessage(
                                    {id: 'Workdirs.already-added', defaultMessage: 'This folder is already added as "{name}". Use it on this board too?'},
                                    {name: entry().name},
                                )}
                            </div>
                        )}
                    </Show>
                    <Show when={workdirPath() && !taken()}>
                        <span class='BoardSetupWizard__path'>{workdirPath()}</span>
                        <label>
                            {intl.formatMessage({id: 'BoardSetup.folder-name', defaultMessage: 'Name'})}
                            <input
                                value={workdirName()}
                                onInput={(e) => setWorkdirName(e.currentTarget.value)}
                            />
                        </label>
                    </Show>
                </div>
            )
        case STEP_AGENT:
            return (
                <div class='BoardSetupWizard__step'>
                    <p>{intl.formatMessage({id: 'BoardSetup.agent-why', defaultMessage: 'The agent that picks a card up. It has to be logged in already; here it is only given a name.'})}</p>

                    {/* The question is asked however many agents there are,
                        one included. A single agent used to be taken as the
                        answer without being shown as one, and «выбрано» that
                        nobody chose is the kind of default a person cannot
                        argue with: the chip says what the board will do and
                        clicking it says otherwise. The registered names are the
                        chips themselves, so there is no list of them above. */}
                    <Show when={hasAgent()}>
                        <div class='BoardSetupWizard__ask'>
                            {intl.formatMessage({id: 'BoardSetup.agent-who', defaultMessage: 'Who works the cards on this board?'})}
                        </div>
                    </Show>

                    {/* The same two questions a card asks when it needs an
                        agent and has none, asked by the same component: a
                        second form here is how a kind ends up offered in one
                        place and not the other.

                        With nobody registered the form stands open — there is
                        nothing else on the step to do. Once somebody is, it
                        goes behind a link, because the step is then answered
                        and adding a second agent is an offer rather than the
                        question; the step used to show the names and no way to
                        add to them, which sent a person to the settings for the
                        one thing this screen exists for. Adding an extra one
                        stays on the step: «Дальше» is what moves on, and a
                        board is worked by a crew often enough. */}
                    <Show
                        when={!hasAgent() || addingAgent()}
                        fallback={

                            // In the row the QA step puts it in: on its own in
                            // the step's column the link stretched the width of
                            // the dialog and centred itself.
                            <div class='BoardSetupWizard__agentChoices'>
                                <For each={registry().agents}>
                                    {(a) => (
                                        <button
                                            type='button'
                                            class='BoardSetupWizard__agentChoice'
                                            classList={{'BoardSetupWizard__agentChoice--chosen': chosenAgent(a.name)}}
                                            aria-pressed={chosenAgent(a.name)}
                                            disabled={busy()}
                                            onClick={() => toggleAgent(a.name)}
                                        >
                                            {a.name}
                                        </button>
                                    )}
                                </For>
                                <button
                                    type='button'
                                    class='BoardSetupWizard__pickAdd'
                                    onClick={() => setAddingAgent(true)}
                                >
                                    {intl.formatMessage({id: 'BoardSetup.add-agent', defaultMessage: 'Add an agent…'})}
                                </button>
                            </div>
                        }
                    >
                        <AgentQuickAdd
                            board={props.board}
                            onAdded={async () => {
                                if (addingAgent()) {
                                    setAddingAgent(false)
                                    await refresh()
                                    return
                                }
                                run(async () => {}, STEP_AGENT)
                            }}
                            onCancel={addingAgent() ? () => setAddingAgent(false) : undefined}
                        />
                    </Show>

                    {/* What the choice does — both halves of it, because the
                        second is the one a person meets on a card: naming the
                        board's agents is also what narrows the assignee field
                        to them. Nobody chosen is a working answer and says so:
                        the board names none of them, so it offers all of them.
                        The crew is a membership list rather than a pin, so a
                        card assigned to somebody on it still decides. */}
                    <Show when={hasAgent()}>
                        <p class='BoardSetupWizard__hint'>
                            <Show
                                when={plan()?.agentColumn}
                                fallback={intl.formatMessage({id: 'BoardSetup.agent-note', defaultMessage: 'The chosen agents become the crew of the columns an agent works in, and the assignee field on a card offers them. With nobody chosen the board offers every agent on the machine, and a card is worked by whoever it is assigned to.'})}
                            >
                                {intl.formatMessage({id: 'BoardSetup.agent-column-note', defaultMessage: 'The chosen agents become the crew of the “{column}” column — cards that get there go to them, and the assignee field on a card offers them. With nobody chosen the board offers every agent on the machine, and a card is worked by whoever it is assigned to. This can be changed later in "Columns and routes…".'}, {column: plan()!.agentColumn})}
                            </Show>
                        </p>
                    </Show>
                </div>
            )
        case STEP_DEPLOY:
            return (
                <div class='BoardSetupWizard__step'>
                    <p>{intl.formatMessage({id: 'BoardSetup.deploy-why', defaultMessage: 'Where a card’s branch is published from the "Деплой" column. Skip it if nothing is deployed from here — everything else still works.'})}</p>
                    <label>
                        {intl.formatMessage({id: 'BoardSetup.deploy-name', defaultMessage: 'Name'})}
                        <input
                            value={deploy().name}
                            onInput={(e) => setDeploy({...deploy(), name: e.currentTarget.value})}
                        />
                    </label>
                    <label>
                        {intl.formatMessage({id: 'BoardSetup.deploy-host', defaultMessage: 'Dokku host'})}
                        <input
                            value={deploy().sshHost}
                            onInput={(e) => setDeploy({...deploy(), sshHost: e.currentTarget.value})}
                        />
                    </label>
                    <label>
                        {intl.formatMessage({id: 'BoardSetup.deploy-user', defaultMessage: 'SSH user (default dokku)'})}
                        <input
                            value={deploy().sshUser}
                            onInput={(e) => setDeploy({...deploy(), sshUser: e.currentTarget.value})}
                        />
                    </label>
                    <label>
                        {intl.formatMessage({id: 'BoardSetup.deploy-key', defaultMessage: 'SSH key (absolute path, optional)'})}
                        <input
                            value={deploy().sshKey}
                            onInput={(e) => setDeploy({...deploy(), sshKey: e.currentTarget.value})}
                        />
                    </label>
                    <label>
                        {intl.formatMessage({id: 'BoardSetup.deploy-domain', defaultMessage: 'Preview domain (optional)'})}
                        <input
                            value={deploy().baseDomain}
                            onInput={(e) => setDeploy({...deploy(), baseDomain: e.currentTarget.value})}
                        />
                    </label>
                </div>
            )
        case STEP_BROWSER:
            return (
                <div class='BoardSetupWizard__step'>
                    <p>{intl.formatMessage({id: 'BoardSetup.browser-why', defaultMessage: 'Testing is an agent clicking through a browser, which it gets from a browser MCP server. Without one a test session will not start; the configuration below usually fits.'})}</p>

                    {/* Who tests is asked the way a card and «обсудить с
                        агентом» ask it — the names as chips, quick-add beside
                        them — because it is the same question, and a wizard
                        that quietly took the first agent in the registry
                        answered it wrongly on every board with two. */}
                    <div class='BoardSetupWizard__ask'>
                        {intl.formatMessage({id: 'BoardSetup.browser-who', defaultMessage: 'Who tests?'})}
                    </div>
                    <div class='BoardSetupWizard__agentChoices'>
                        <For each={registry().agents}>
                            {(a) => (
                                <button
                                    type='button'
                                    class='BoardSetupWizard__agentChoice'
                                    classList={{'BoardSetupWizard__agentChoice--chosen': a.name === testAgent()}}
                                    aria-pressed={a.name === testAgent()}
                                    disabled={busy()}
                                    onClick={() => setTestAgent(a.name)}
                                >
                                    {a.name}
                                </button>
                            )}
                        </For>
                        <Show when={!addingTestAgent()}>
                            <button
                                type='button'
                                class='BoardSetupWizard__pickAdd'
                                onClick={() => setAddingTestAgent(true)}
                            >
                                {intl.formatMessage({id: 'BoardSetup.add-agent', defaultMessage: 'Add an agent…'})}
                            </button>
                        </Show>
                    </div>
                    <Show when={addingTestAgent()}>
                        <AgentQuickAdd
                            board={props.board}
                            onAdded={async (name) => {
                                setAddingTestAgent(false)
                                await refresh()
                                setTestAgent(name)
                            }}
                            onCancel={() => setAddingTestAgent(false)}
                        />
                    </Show>

                    {/* What the choice does beyond the server: the browser is
                        set up for the stage that tests, and this agent becomes
                        its crew — so the column that needs a browser has one
                        and the card being tested says who is on it. The server
                        goes to the stage rather than to the agent because
                        testing is what needs a browser: an agent given one here
                        would carry it on every other board too. */}
                    <p class='BoardSetupWizard__hint'>
                        <Show
                            when={plan()?.testColumn}
                            fallback={intl.formatMessage({id: 'BoardSetup.browser-agent-note', defaultMessage: 'The browser is set up for the column that tests, and this agent is who works it.'})}
                        >
                            {intl.formatMessage({id: 'BoardSetup.browser-column-note', defaultMessage: 'The browser is set up for the “{column}” column and this agent is who works it: a card that gets there is assigned to it and tested by it. Both can be changed later in "Columns and routes…".'}, {column: plan()!.testColumn})}
                        </Show>
                    </p>

                    <textarea
                        rows={7}
                        value={serversText()}
                        onInput={(e) => setServersText(e.currentTarget.value)}
                    />
                </div>
            )
        case STEP_SOURCE:
            return (
                <div class='BoardSetupWizard__step'>
                    <p>
                        {intl.formatMessage({
                            id: 'BoardSetup.source-why',
                            defaultMessage: 'A source puts cards on this board by itself — a notification from your phone, a script, a service. Records are sent to it over HTTP at the address the board is served on; from a phone that is the tailnet address.',
                        })}
                    </p>
                    <label class='BoardSetupWizard__field'>
                        <span>{intl.formatMessage({id: 'BoardSetup.source-name', defaultMessage: 'Name of the source'})}</span>
                        <input
                            type='text'
                            placeholder={intl.formatMessage({id: 'BoardSetup.source-name-example', defaultMessage: 'phone'})}
                            value={sourceName()}
                            onInput={(e) => setSourceName(e.currentTarget.value)}
                        />
                    </label>
                    <Show when={sourceToken()}>
                        <p class='BoardSetupWizard__hint'>
                            {intl.formatMessage({
                                id: 'BoardSetup.source-token',
                                defaultMessage: 'The token, shown once — only its hash is kept, so copy it now:',
                            })}
                        </p>
                        <code>{sourceToken()}</code>
                    </Show>
                </div>
            )
        default:
            return (
                <div class='BoardSetupWizard__step'>
                    <p>{intl.formatMessage({id: 'BoardSetup.done-how', defaultMessage: 'Drag a card into "{column}" — creating it there does not start anything, the trigger is the move. Pick a route in the card’s route field, or the card will only be worked on where it stands.'}, {column: agentColumn(plan())})}</p>
                    <p class='BoardSetupWizard__hint'>
                        {intl.formatMessage({id: 'BoardSetup.done-branch', defaultMessage: 'For transitions that wait for a branch to be merged, fill the card’s "branch" property: that is the branch being watched.'})}
                    </p>
                </div>
            )
        }
    }

    const actions = () => {
        switch (step()) {
        case STEP_WORKDIR:
            return (
                <>
                    <Button
                        emphasis='primary'
                        disabled={busy() || !workdirAnswered()}
                        onClick={() => {
                        // Three answers behind one button: use the folder that
                        // is already registered, add the one just picked, or —
                        // with a folder already on this board — pass the step.
                            if (taken()) {
                                return useTakenWorkdir()
                            }
                            return workdirPath() && workdirName().trim() ? addWorkdir() : pass(STEP_WORKDIR)
                        }}
                    >
                        {taken() ? intl.formatMessage({id: 'Workdirs.use-here', defaultMessage: 'Use it here'}) : intl.formatMessage({id: 'BoardSetup.next', defaultMessage: 'Next'})}
                    </Button>

                    {/* Offered exactly when there is no answer to give, which is
                    when «Дальше» is disabled: until this, somebody without the
                    folder to hand had to leave the whole wizard to reach the
                    questions after it. What a board gives up by passing is said
                    on the step itself. */}
                    <Show when={!workdirAnswered()}>
                        <Button onClick={() => skip(STEP_WORKDIR)}>
                            {intl.formatMessage({id: 'BoardSetup.skip', defaultMessage: 'Skip'})}
                        </Button>
                    </Show>
                </>
            )
        case STEP_AGENT:

            // The form above has its own button and moves the step itself, so
            // Next is offered only when there is nothing left to fill in.
            return (
                <Show when={hasAgent()}>
                    <Button
                        emphasis='primary'
                        disabled={busy()}
                        onClick={takeAgent}
                    >
                        {intl.formatMessage({id: 'BoardSetup.next', defaultMessage: 'Next'})}
                    </Button>
                </Show>
            )
        case STEP_DEPLOY:
            return (
                <>
                    <Button
                        emphasis='primary'
                        disabled={busy() || !deploy().name.trim() || !deploy().sshHost.trim()}
                        onClick={addDeploy}
                    >
                        {intl.formatMessage({id: 'BoardSetup.save', defaultMessage: 'Save'})}
                    </Button>
                    <Button onClick={() => skip(STEP_DEPLOY)}>
                        {intl.formatMessage({id: 'BoardSetup.skip', defaultMessage: 'Skip'})}
                    </Button>
                </>
            )
        case STEP_BROWSER:
            return (
                <>
                    {/* Nobody chosen is nothing to save: the server belongs to
                        an agent, and which one is the question. */}
                    <Button
                        emphasis='primary'
                        disabled={busy() || !testAgent()}
                        onClick={addBrowser}
                    >
                        {intl.formatMessage({id: 'BoardSetup.save', defaultMessage: 'Save'})}
                    </Button>
                    <Button onClick={() => skip(STEP_BROWSER)}>
                        {intl.formatMessage({id: 'BoardSetup.skip', defaultMessage: 'Skip'})}
                    </Button>
                </>
            )
        case STEP_SOURCE:
            return (
                <>
                    <Button
                        emphasis='primary'
                        disabled={busy() || !sourceName().trim()}
                        onClick={addSource}
                    >
                        {intl.formatMessage({id: 'BoardSetup.save', defaultMessage: 'Save'})}
                    </Button>
                    <Button onClick={() => skip(STEP_SOURCE)}>
                        {intl.formatMessage({id: 'BoardSetup.skip', defaultMessage: 'Skip'})}
                    </Button>
                </>
            )
        default:
            return (
                <Button
                    emphasis='primary'
                    onClick={finish}
                >
                    {intl.formatMessage({id: 'BoardSetup.finish', defaultMessage: 'Done'})}
                </Button>
            )
        }
    }

    const title = (of: SetupStepKind) => {
        switch (of) {
        case STEP_WORKDIR:
            return intl.formatMessage({id: 'BoardSetup.step-folder', defaultMessage: 'Folder'})
        case STEP_AGENT:
            return intl.formatMessage({id: 'BoardSetup.step-agent', defaultMessage: 'Agent'})
        case STEP_DEPLOY:
            return intl.formatMessage({id: 'BoardSetup.step-deploy', defaultMessage: 'Deploy'})
        case STEP_BROWSER:
            return intl.formatMessage({id: 'BoardSetup.step-browser', defaultMessage: 'QA'})
        case STEP_SOURCE:
            return intl.formatMessage({id: 'BoardSetup.step-source', defaultMessage: 'Source'})
        default:
            return intl.formatMessage({id: 'BoardSetup.step-done', defaultMessage: 'Ready'})
        }
    }

    return (
        <Dialog
            class='BoardSetupWizard'
            title={<span>{intl.formatMessage({id: 'BoardSetup.title', defaultMessage: 'Set up this board: {step}'}, {step: title(step())})}</span>}
            subtitle={<span>{intl.formatMessage({id: 'BoardSetup.subtitle', defaultMessage: 'The board\'s columns and routes are already in place. What is left is to say where things are on your machine.'})}</span>}
            onClose={props.onClose}
        >
            <div class='BoardSetupWizard__content'>
                <ol class='BoardSetupWizard__steps'>
                    <For each={steps()}>
                        {(entry) => (
                            <li
                                class={entry.kind === step() ? 'BoardSetupWizard__stepName--current' : ''}
                            >{title(entry.kind)}</li>
                        )}
                    </For>
                </ol>

                {/* The board's own sentence about this step, when it has one:
                    "the folder with your household notes" says more than any
                    wording of ours that has to fit every board. */}
                <Show when={stepAt(step())?.hint}>
                    <p class='BoardSetupWizard__hint'>{stepAt(step())!.hint}</p>
                </Show>

                {body()}

                <div class='BoardSetupWizard__actions'>{actions()}</div>

                <Show when={error()}>
                    <div class='BoardSetupWizard__error'>{error()}</div>
                </Show>

                {/* The soft way out, for somebody who would rather look around
                    first. Nothing here is mandatory any more — a board with no
                    deploy target is a board that does not deploy — so leaving
                    is fine, and the parting note says how to come back. The ✕
                    stays silent: it is the same leaving, chosen quietly.

                    Not on the last screen: there is nothing left to walk away
                    from there, so «Разберусь сам» beside «Готово» offered two
                    ways to do the same thing and made the finished wizard read
                    as though something were still being asked. */}
                <Show when={step() !== STEP_DONE}>
                    <button
                        type='button'
                        class='BoardSetupWizard__later'
                        onClick={() => {
                            sendFlashMessage({
                                content: intl.formatMessage({
                                    id: 'BoardSetup.come-back',
                                    defaultMessage: 'You can walk this again any time: the board’s ⋯ menu → “Walk the setup again…”.',
                                }),
                                severity: 'normal',
                                notice: true,

                                // Long enough to read a path of three menu
                                // names — and closable, for whoever does not
                                // need to.
                                milliseconds: 5000,
                            })
                            props.onClose()
                        }}
                    >
                        {intl.formatMessage({id: 'BoardSetup.later', defaultMessage: 'I’ll find my way around'})}
                    </button>
                </Show>
            </div>
        </Dialog>
    )
}

export default BoardSetupWizard
