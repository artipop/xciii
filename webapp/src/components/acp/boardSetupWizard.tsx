// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createEffect, createSignal, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {Board} from '../../blocks/board'
import Button from '../../widgets/buttons/button'
import Dialog from '../dialog'

import {agentBindings} from './agentProjectsDialog'
import {AGENT_KINDS, textToServers, AdapterStatus} from './agentsDialog'
import {agentColumn, checkSetupAnswer, createSetupPlan, recordSetupStep, SetupStep, SetupStepKind, stepRequires} from './boardSetup'

import './boardSetupWizard.scss'

// A board made from a template arrives knowing how the work is organised — its
// columns, its routes, the fields a card picks a project and an agent with.
// What it cannot know is the machine: which agent runs, in which project, where
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
    agents: Array<{name: string}>
    projects: Array<{name: string, path: string}>
}

// readRegistry is what the steps show back: the names already registered. The
// plan says whether a question is answered; this says what the answer was.
export async function readRegistry(boardId: string): Promise<Registry | null> {
    const bindings = agentBindings()
    if (!bindings?.ListAgentProjects || !bindings.ListAgents) {
        return null
    }
    const [projects, agents] = await Promise.all([bindings.ListAgentProjects(boardId), bindings.ListAgents()])
    return {projects: JSON.parse(projects) || [], agents: JSON.parse(agents) || []}
}

type Props = {
    board: Board
    onClose: () => void
}

const STEP_PROJECT: SetupStepKind = 'project'
const STEP_AGENT: SetupStepKind = 'agent'
const STEP_DEPLOY: SetupStepKind = 'deploy'
const STEP_BROWSER: SetupStepKind = 'browser'
const STEP_DONE: SetupStepKind = 'done'

const BoardSetupWizard = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [plan, refreshPlan] = createSetupPlan(() => props.board)
    const [step, setStep] = createSignal<SetupStepKind>(STEP_PROJECT)
    const [registry, setRegistry] = createSignal<Registry>({agents: [], projects: []})
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

    // Step 1: a project.
    const [projectPath, setProjectPath] = createSignal('')
    const [projectName, setProjectName] = createSignal('')

    // Step 2: an agent.
    const [agentName, setAgentName] = createSignal('claude')
    const [agentKind, setAgentKind] = createSignal('claude')

    // Step 3: a Dokku host.
    const [deploy, setDeploy] = createSignal({name: '', sshHost: '', sshUser: '', sshKey: '', baseDomain: ''})

    // Step 4: what tests with.
    const [serversText, setServersText] = createSignal(BROWSER_SERVER)
    const [adapters, setAdapters] = createSignal<AdapterStatus[]>([])

    const refresh = async () => {
        try {
            const loaded = await readRegistry(props.board.id)
            if (loaded) {
                setRegistry(loaded)
            }

            // A fresh machine is exactly where the agent's adapter is missing,
            // so the step that asks for an agent is where that has to be said.
            if (bindings?.ListAgentAdapters) {
                setAdapters(JSON.parse(await bindings.ListAgentAdapters()) || [])
            }
        } catch (e) {
            setError(String(e))
        }
    }

    onMount(() => {
        refresh()
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

    const adapterStatus = () => adapters().find((a) => a.kind === agentKind())

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

    // Passing a step the machine can already answer — there is a project, an
    // agent — is answering it too, and has to be recorded as one.
    const pass = (answering: SetupStepKind) => run(async () => {}, answering)

    const pickProject = async () => {
        if (!bindings?.PickDirectory) {
            return
        }
        setError('')
        try {
            const picked = await bindings.PickDirectory(intl.formatMessage({id: 'BoardSetup.pick-project', defaultMessage: 'Choose a project folder'}))
            if (picked) {
                setProjectPath(picked)
                setProjectName((current) => current || picked.split('/').filter(Boolean).pop() || '')
            }
        } catch (e) {
            setError(String(e))
        }
    }

    const addProject = () => run(async () => {
        // Asked before it is filed: a board that publishes a branch needs a
        // project under git, and this is where that can still be answered.
        await checkSetupAnswer(props.board.id, STEP_PROJECT, projectPath())
        await bindings!.AddAgentProject!(projectName().trim(), projectPath(), props.board.id, false)
    }, STEP_PROJECT)

    const addAgent = () => run(async () => {
        await bindings!.AddAgent!(JSON.stringify({name: agentName().trim(), kind: agentKind()}))
        if (bindings!.SyncAgentUsers) {
            // So the agent can be put in a card's "Assignee" like a teammate.
            await bindings!.SyncAgentUsers(props.board.id)
        }
    }, STEP_AGENT)

    const addDeploy = () => run(async () => {
        await bindings!.AddDeployTarget!(JSON.stringify({
            name: deploy().name.trim(),
            sshHost: deploy().sshHost.trim(),
            sshUser: deploy().sshUser.trim(),
            sshKey: deploy().sshKey.trim(),
            baseDomain: deploy().baseDomain.trim(),
        }))
    }, STEP_DEPLOY)

    const addBrowser = () => run(async () => {
        const agent = registry().agents[0]
        if (!agent) {
            return
        }
        await bindings!.UpdateAgent!(JSON.stringify({
            name: agent.name,
            kind: agentKind(),
            mcpServers: textToServers(serversText()),
        }))
    }, STEP_BROWSER)

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

    const hasProject = () => registry().projects.length > 0
    const hasAgent = () => registry().agents.length > 0

    const body = () => {
        switch (step()) {
        case STEP_PROJECT:
            return (
                <div class='BoardSetupWizard__step'>
                    <p>{intl.formatMessage({id: 'BoardSetup.project-why', defaultMessage: 'An agent works in a project on your machine. A card is matched to one by its "Projects" field, which this fills in for you.'})}</p>
                    <Show when={stepRequires(stepAt(STEP_PROJECT), 'git')}>
                        <p class='BoardSetupWizard__hint'>
                            {intl.formatMessage({id: 'BoardSetup.project-git', defaultMessage: 'This board publishes a branch or waits for one, so its project has to be under git. A board that does neither takes any folder.'})}
                        </p>
                    </Show>
                    <Show when={hasProject()}>
                        <div class='BoardSetupWizard__known'>
                            {intl.formatMessage({id: 'BoardSetup.project-known', defaultMessage: 'Already registered: {names}'}, {names: registry().projects.map((r) => r.name).join(', ')})}
                        </div>
                    </Show>
                    <Button onClick={pickProject}>
                        {intl.formatMessage({id: 'BoardSetup.choose-folder', defaultMessage: 'Choose a folder…'})}
                    </Button>
                    <Show when={projectPath()}>
                        <span class='BoardSetupWizard__path'>{projectPath()}</span>
                        <label>
                            {intl.formatMessage({id: 'BoardSetup.project-name', defaultMessage: 'Name'})}
                            <input
                                value={projectName()}
                                onInput={(e) => setProjectName(e.currentTarget.value)}
                            />
                        </label>
                    </Show>
                </div>
            )
        case STEP_AGENT:
            return (
                <div class='BoardSetupWizard__step'>
                    <p>{intl.formatMessage({id: 'BoardSetup.agent-why', defaultMessage: 'The agent that picks a card up. It has to be logged in already; here it is only given a name.'})}</p>
                    <Show when={hasAgent()}>
                        <div class='BoardSetupWizard__known'>
                            {intl.formatMessage({id: 'BoardSetup.agent-known', defaultMessage: 'Already registered: {names}'}, {names: registry().agents.map((a) => a.name).join(', ')})}
                        </div>
                    </Show>
                    <label>
                        {intl.formatMessage({id: 'BoardSetup.agent-name', defaultMessage: 'Name'})}
                        <input
                            value={agentName()}
                            onInput={(e) => setAgentName(e.currentTarget.value)}
                        />
                    </label>
                    <label>
                        {intl.formatMessage({id: 'BoardSetup.agent-kind', defaultMessage: 'Kind'})}
                        <select
                            value={agentKind()}
                            onChange={(e) => setAgentKind(e.currentTarget.value)}
                        >
                            <For each={AGENT_KINDS}>
                                {(kind) => (
                                    <option
                                        value={kind.value}
                                        selected={agentKind() === kind.value}
                                    >{kind.label}</option>
                                )}
                            </For>
                        </select>
                    </label>
                    <Show when={adapterStatus() && !adapterStatus()!.ready}>
                        <div class='BoardSetupWizard__warning'>{adapterStatus()!.detail}</div>
                    </Show>
                </div>
            )
        case STEP_DEPLOY:
            return (
                <div class='BoardSetupWizard__step'>
                    <p>{intl.formatMessage({id: 'BoardSetup.deploy-why', defaultMessage: 'Where a card’s branch is published from the "Deploy" column. Skip it if nothing is deployed from here — everything else still works.'})}</p>
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
                    <p>{intl.formatMessage({id: 'BoardSetup.browser-why', defaultMessage: 'The "To Test" column drives a browser the agent brings itself. Without a browser MCP server a test session refuses to start; the one below is the usual answer.'})}</p>
                    <textarea
                        rows={7}
                        value={serversText()}
                        onInput={(e) => setServersText(e.currentTarget.value)}
                    />
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
        case STEP_PROJECT:
            return (
                <Button
                    emphasis='primary'
                    disabled={busy() || (!hasProject() && !(projectPath() && projectName().trim()))}
                    onClick={() => (projectPath() && projectName().trim() ? addProject() : pass(STEP_PROJECT))}
                >
                    {intl.formatMessage({id: 'BoardSetup.next', defaultMessage: 'Next'})}
                </Button>
            )
        case STEP_AGENT:
            return (
                <Button
                    emphasis='primary'
                    disabled={busy() || (!hasAgent() && !agentName().trim())}
                    onClick={() => (agentName().trim() && !hasAgent() ? addAgent() : pass(STEP_AGENT))}
                >
                    {intl.formatMessage({id: 'BoardSetup.next', defaultMessage: 'Next'})}
                </Button>
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
                    <Button
                        emphasis='primary'
                        disabled={busy() || !hasAgent()}
                        onClick={addBrowser}
                    >
                        {intl.formatMessage({id: 'BoardSetup.save', defaultMessage: 'Save'})}
                    </Button>
                    <Button onClick={() => skip(STEP_BROWSER)}>
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
        case STEP_PROJECT:
            return intl.formatMessage({id: 'BoardSetup.step-project', defaultMessage: 'Project'})
        case STEP_AGENT:
            return intl.formatMessage({id: 'BoardSetup.step-agent', defaultMessage: 'Agent'})
        case STEP_DEPLOY:
            return intl.formatMessage({id: 'BoardSetup.step-deploy', defaultMessage: 'Deploy'})
        case STEP_BROWSER:
            return intl.formatMessage({id: 'BoardSetup.step-browser', defaultMessage: 'Testing'})
        default:
            return intl.formatMessage({id: 'BoardSetup.step-done', defaultMessage: 'Ready'})
        }
    }

    return (
        <Dialog
            class='BoardSetupWizard'
            title={<span>{intl.formatMessage({id: 'BoardSetup.title', defaultMessage: 'Set up this board: {step}'}, {step: title(step())})}</span>}
            subtitle={<span>{intl.formatMessage({id: 'BoardSetup.subtitle', defaultMessage: 'The board already knows how the work is organised. What it does not know is your machine.'})}</span>}
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
            </div>
        </Dialog>
    )
}

export default BoardSetupWizard
