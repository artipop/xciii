// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {Board} from '../../blocks/board'
import {UserSettings} from '../../userSettings'
import Button from '../../widgets/buttons/button'
import Dialog from '../dialog'

import {agentBindings} from './agentProjectsDialog'
import {AGENT_KINDS, textToServers, AdapterStatus} from './agentsDialog'

import './boardSetupWizard.scss'

// A board made from the template arrives knowing how the work is organised —
// its columns, its routes, the fields a card picks a project and an agent
// with. What it cannot know is the machine: which agent runs, in which
// project, where it deploys, what it tests with. That lives in the desktop
// registries, and until now the only way to find out it was empty was to drag a
// card and read the complaint afterwards.
//
// This asks for it once, in the order the work needs it.

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

export function isBoardSetupAvailable(): boolean {
    return Boolean(agentBindings()?.ListAgentProjects)
}

// boardCarriesAutomation reports whether this board was made from a template
// that ships columns and routes — there is nothing to set up for a board that
// runs nothing.
export function boardCarriesAutomation(board?: Board): boolean {
    return Boolean(board?.properties && board.properties.acpFlows !== undefined)
}

// setupNeeded says the board runs something this machine cannot run yet. It is
// true for as long as that is the case, which is what the reminder in the
// header is for — it is not, on its own, a reason to open anything.
export function setupNeeded(board: Board | undefined, registry: Registry | null): boolean {
    if (!board || !isBoardSetupAvailable() || !boardCarriesAutomation(board)) {
        return false
    }
    return Boolean(registry) && (registry!.agents.length === 0 || registry!.projects.length === 0)
}

// shouldOfferSetup is the rule for opening the wizard by itself, and it fires
// once per board — on the first board you open after making it. It used to fire
// on every launch until the setup was finished or refused, which meant the app
// greeted you with a modal every morning for as long as you had not got round
// to it. A thing you have already seen and closed is a reminder, not a dialog.
export function shouldOfferSetup(board: Board | undefined, registry: Registry | null): boolean {
    return setupNeeded(board, registry) && !offeredFor(board!.id)
}

// Remembered per board, so a board you have seen the wizard for is not the
// answer for the next one you make. The stored value predates this and meant
// "dismissed"; having dismissed it is having been offered it, so old settings
// carry over without a migration.
export function offeredFor(boardId: string): boolean {
    return Boolean(UserSettings.acpSetupDismissed[boardId])
}

export function rememberOffered(boardId: string): void {
    UserSettings.setAcpSetupDismissed(boardId)
}

export async function readRegistry(): Promise<Registry | null> {
    const bindings = agentBindings()
    if (!bindings?.ListAgentProjects || !bindings.ListAgents) {
        return null
    }
    const [projects, agents] = await Promise.all([bindings.ListAgentProjects(), bindings.ListAgents()])
    return {projects: JSON.parse(projects) || [], agents: JSON.parse(agents) || []}
}

type Props = {
    board: Board
    onClose: () => void
}

const STEP_REPO = 0
const STEP_AGENT = 1
const STEP_DEPLOY = 2
const STEP_BROWSER = 3
const STEP_DONE = 4

const BoardSetupWizard = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [step, setStep] = createSignal(STEP_REPO)
    const [registry, setRegistry] = createSignal<Registry>({agents: [], projects: []})
    const [error, setError] = createSignal('')
    const [busy, setBusy] = createSignal(false)

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
            const loaded = await readRegistry()
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

    const adapterStatus = () => adapters().find((a) => a.kind === agentKind())

    // Every step does its work through the same registry calls the dialogs use,
    // and shows what Go says when it refuses.
    const run = async (work: () => Promise<void>, next: number) => {
        setError('')
        setBusy(true)
        try {
            await work()
            await refresh()
            setStep(next)
        } catch (e) {
            setError(String(e))
        } finally {
            setBusy(false)
        }
    }

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

    const addRepo = () => run(async () => {
        await bindings!.AddAgentProject!(projectName().trim(), projectPath())
    }, STEP_AGENT)

    const addAgent = () => run(async () => {
        await bindings!.AddAgent!(JSON.stringify({name: agentName().trim(), kind: agentKind()}))
        if (bindings!.SyncAgentUsers) {
            // So the agent can be put in a card's "Assignee" like a teammate.
            await bindings!.SyncAgentUsers(props.board.id)
        }
    }, STEP_DEPLOY)

    const addDeploy = () => run(async () => {
        await bindings!.AddDeployTarget!(JSON.stringify({
            name: deploy().name.trim(),
            sshHost: deploy().sshHost.trim(),
            sshUser: deploy().sshUser.trim(),
            sshKey: deploy().sshKey.trim(),
            baseDomain: deploy().baseDomain.trim(),
        }))
    }, STEP_BROWSER)

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
    }, STEP_DONE)

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
        case STEP_REPO:
            return (
                <div class='BoardSetupWizard__step'>
                    <p>{intl.formatMessage({id: 'BoardSetup.project-why', defaultMessage: 'An agent works in a project on your machine. A card is matched to one by its "Projects" field, which this fills in for you.'})}</p>
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
                    <p>{intl.formatMessage({id: 'BoardSetup.done-how', defaultMessage: 'Drag a card into "In Progress" — creating it there does not start anything, the trigger is the move. Pick a route in the card’s "Workflow" field, or the card will only be worked on where it stands.'})}</p>
                    <p class='BoardSetupWizard__hint'>
                        {intl.formatMessage({id: 'BoardSetup.done-branch', defaultMessage: 'For transitions that wait for a branch to be merged, fill the card’s "branch" property: that is the branch being watched.'})}
                    </p>
                </div>
            )
        }
    }

    const actions = () => {
        switch (step()) {
        case STEP_REPO:
            return (
                <Button
                    emphasis='primary'
                    disabled={busy() || (!hasProject() && !(projectPath() && projectName().trim()))}
                    onClick={() => (projectPath() && projectName().trim() ? addRepo() : setStep(STEP_AGENT))}
                >
                    {intl.formatMessage({id: 'BoardSetup.next', defaultMessage: 'Next'})}
                </Button>
            )
        case STEP_AGENT:
            return (
                <Button
                    emphasis='primary'
                    disabled={busy() || (!hasAgent() && !agentName().trim())}
                    onClick={() => (agentName().trim() && !hasAgent() ? addAgent() : setStep(STEP_DEPLOY))}
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
                    <Button onClick={() => setStep(STEP_BROWSER)}>
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
                    <Button onClick={() => setStep(STEP_DONE)}>
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

    const titles = [
        intl.formatMessage({id: 'BoardSetup.step-project', defaultMessage: 'Project'}),
        intl.formatMessage({id: 'BoardSetup.step-agent', defaultMessage: 'Agent'}),
        intl.formatMessage({id: 'BoardSetup.step-deploy', defaultMessage: 'Deploy'}),
        intl.formatMessage({id: 'BoardSetup.step-browser', defaultMessage: 'Testing'}),
        intl.formatMessage({id: 'BoardSetup.step-done', defaultMessage: 'Ready'}),
    ]

    return (
        <Dialog
            class='BoardSetupWizard'
            title={<span>{intl.formatMessage({id: 'BoardSetup.title', defaultMessage: 'Set up this board: {step}'}, {step: titles[step()]})}</span>}
            subtitle={<span>{intl.formatMessage({id: 'BoardSetup.subtitle', defaultMessage: 'The board already knows how the work is organised. What it does not know is your machine.'})}</span>}
            onClose={props.onClose}
        >
            <div class='BoardSetupWizard__content'>
                <ol class='BoardSetupWizard__steps'>
                    <For each={titles}>
                        {(title, i) => (
                            <li
                                class={i() === step() ? 'BoardSetupWizard__stepName--current' : ''}
                            >{title}</li>
                        )}
                    </For>
                </ol>

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
