// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {Board, IPropertyTemplate, IPropertyOption} from '../../blocks/board'
import mutator from '../../mutator'
import {Utils, IDType} from '../../utils'
import Button from '../../widgets/buttons/button'
import Dialog from '../dialog'
import {sendFlashMessage} from '../flashMessages'

import {agentBindings} from './agentProjectsDialog'
import ProxiesPanel, {ProxyEntry, isProxiesAvailable} from './proxiesPanel'

import './agentsDialog.scss'

// The dedicated card property whose (single-)select option names route a card
// to a registered agent. Synced by "Sync to board"; matched in resolveAgent.
const AGENT_PROPERTY_NAME = 'Agent'

// The standard MCP client shape, so a server can be pasted straight from its
// README: a name mapped to the command that starts it.
type AgentMCPServer = {
    command?: string
    args?: string[]
    env?: {[key: string]: string}
    type?: string
    url?: string
}

type AgentMCPServers = {[name: string]: AgentMCPServer}

// What the field expects, shown when it is empty: the browser server a test
// session needs, in the form its own README gives it.
const mcpServersPlaceholder = JSON.stringify({
    mcpServers: {
        playwright: {command: 'npx', args: ['-y', '@playwright/mcp@latest', '--headless', '--browser', 'chrome']},
    },
}, null, 2)

type AgentEntry = {
    name: string
    kind: string
    binPath?: string
    model?: string
    prompt?: string
    env?: {[key: string]: string}
    args?: string[]
    command?: string[]
    mcpServers?: AgentMCPServers
    proxyName?: string

    // The agent's own settings: an ACP config option id mapped to the value
    // asked for ({"fast": "on"}). Which ones exist is the agent's answer, not
    // a list of ours — see AgentOption below.
    options?: {[id: string]: string}

    // Arguments for the CLI behind the agent's adapter, for what ACP has no
    // word for. Remote Control is the reason it exists.
    cliArgs?: string[]
}

// One setting the agent itself declares (Fast mode, effort, permission mode),
// as the manager reports it after asking the agent. An agent that has none is
// offered none: there is nothing to choose from.
export type AgentOption = {
    id: string
    name: string
    description?: string
    type: 'select' | 'boolean'
    category?: string
    current: string
    values?: Array<{value: string, name?: string, description?: string}>
}

// The Model field above is the same setting as the agent's "model" option, so
// the options list leaves it to the field rather than asking twice.
const MODEL_OPTION_ID = 'model'

// A boolean option is drawn as the same dropdown as a select, so "leave it as
// the agent has it" stays expressible alongside on and off.
const booleanValues = [{value: 'on'}, {value: 'off'}]

// Kinds whose adapter hands arguments on to a CLI behind it (session/new's
// `_meta`). For every other kind the agent *is* the CLI, so "Extra CLI args"
// above already reaches it and this field would be a second way to say it.
const CLI_HANDOFF_KINDS = ['claude']

// Remote Control — driving this agent's sessions from claude.ai or the phone —
// is a flag of the CLI and nothing in ACP, so the probe cannot find it and it is
// named here. The rest of the CLI's flags stay hand-typed: keeping a list of
// somebody else's releases in step is not something to promise.
const REMOTE_CONTROL_FLAG = '--remote-control'
const REMOTE_CONTROL_NAME_FLAG = '--remote-control-session-name-prefix'

// remoteControlOf reads the toggle and the name back out of the arguments, so
// there is one place the setting lives and the raw field stays the truth.
export function remoteControlOf(cliArgs?: string[]): {on: boolean, name: string} {
    const argv = cliArgs || []
    const at = argv.indexOf(REMOTE_CONTROL_NAME_FLAG)
    return {
        on: argv.includes(REMOTE_CONTROL_FLAG),
        name: at >= 0 ? (argv[at + 1] || '') : '',
    }
}

// withRemoteControl writes the toggle and the name back into the arguments,
// leaving everything else the user typed exactly where it was.
export function withRemoteControl(cliArgs: string[] | undefined, on: boolean, name: string): string[] {
    const rest: string[] = []
    const argv = cliArgs || []
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === REMOTE_CONTROL_FLAG) {
            continue
        }
        if (argv[i] === REMOTE_CONTROL_NAME_FLAG) {
            i++ // its value goes with it
            continue
        }
        rest.push(argv[i])
    }
    if (!on) {
        return rest
    }

    // The name is kept exactly as typed — trimming it here would eat the space
    // the moment somebody types one, since every keystroke goes back through
    // the arguments. Whitespace is dropped when the entry is saved.
    const named = name.trim() ? [REMOTE_CONTROL_NAME_FLAG, name] : []
    return [REMOTE_CONTROL_FLAG, ...named, ...rest]
}

// Whether a kind can be started on this machine, as the manager reports it.
export type AdapterStatus = {
    kind: string
    package?: string
    path?: string
    ready: boolean
    viaNpx?: boolean
    detail?: string
}

// Launch command placeholders per kind. Every kind is an ACP agent spawned over
// stdio; the command replaces the adapter binary, which is how a wrapper (a
// proxy launcher, a per-account shim) gets in front of it.
const commandPlaceholders: {[kind: string]: string} = {
    claude: 'proxychains4 -q -f /etc/myproxy.conf claude-agent-acp',
    codex: 'proxychains4 -q -f /etc/myproxy.conf codex-acp',
    antigravity: 'antigravity --acp',
    copilot: 'copilot --acp',
    junie: 'junie --acp=true',
    acp: 'gemini --acp',
}

// The agent kinds the manager knows, in the order they are offered. Exported
// because the setup wizard asks the same question.
export const AGENT_KINDS = [
    {value: 'claude', label: 'Claude'},
    {value: 'codex', label: 'Codex'},
    {value: 'antigravity', label: 'Antigravity'},
    {value: 'copilot', label: 'GitHub Copilot'},
    {value: 'junie', label: 'JetBrains Junie'},
    {value: 'acp', label: 'ACP (other)'},
]

export function isAgentsAvailable(): boolean {
    return Boolean(agentBindings()?.ListAgents)
}

// envToText / textToEnv convert between the KEY=VALUE textarea and the env map.
// Exported: the deploy-target dialog edits an env map the same way.
export function envToText(env?: {[key: string]: string}): string {
    if (!env) {
        return ''
    }
    return Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n')
}

// serversToText / textToServers convert between the textarea and the map, in
// the JSON every MCP client uses. The mcpServers wrapper is written on the way
// out and accepted but not required on the way in, which is what lets a block
// be pasted from a server's README as it is. Invalid JSON throws: the caller
// says so instead of silently saving an empty list.
export function serversToText(servers?: AgentMCPServers): string {
    if (!servers || Object.keys(servers).length === 0) {
        return ''
    }
    return JSON.stringify({mcpServers: servers}, null, 2)
}

export function textToServers(text: string): AgentMCPServers {
    if (!text.trim()) {
        return {}
    }
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('mcpServers must be an object')
    }
    const servers = (!Array.isArray(parsed) && parsed.mcpServers !== undefined) ? parsed.mcpServers : parsed
    if (!servers || typeof servers !== 'object') {
        throw new Error('mcpServers must be an object')
    }

    // Some clients list the servers instead of keying them by name, and that is
    // what somebody copying from one of them will paste. The config file reads
    // both shapes, so the dialog does too.
    if (Array.isArray(servers)) {
        const named: AgentMCPServers = {}
        for (const entry of servers) {
            const {name, ...server} = entry || {}
            if (!name) {
                throw new Error('every server in the list needs a "name"')
            }
            named[name] = server
        }
        return named
    }
    return servers
}

export function textToEnv(text: string): {[key: string]: string} {
    const env: {[key: string]: string} = {}
    for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) {
            continue
        }
        const eq = trimmed.indexOf('=')
        if (eq <= 0) {
            continue
        }
        env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
    }
    return env
}

// splitArgv / joinArgv convert between the single-line argv inputs and the
// string arrays sent to Go, honouring quotes so paths with spaces survive
// (a config under "~/Library/Application Support/…" is one argument).
function splitArgv(text: string): string[] {
    const argv: string[] = []
    const token = /"([^"]*)"|'([^']*)'|(\S+)/g
    let match = token.exec(text)
    while (match) {
        const [, doubleQuoted, singleQuoted, bare] = match
        const arg = [doubleQuoted, singleQuoted, bare].find((v) => v !== undefined)
        argv.push(arg as string)
        match = token.exec(text)
    }
    return argv
}

function joinArgv(argv?: string[]): string {
    const whitespace = (/\s/)
    return (argv || []).map((a) => (whitespace.test(a) ? `"${a}"` : a)).join(' ')
}

// optionValues are the values a setting can be given. A boolean is offered as
// on/off, which is also how it is stored, so the whole panel is one control.
export function optionValues(option: AgentOption): Array<{value: string, name?: string}> {
    if (option.type === 'boolean') {
        return booleanValues
    }
    return option.values || []
}

// optionValueLabel names the value the agent already holds, for the "leave it
// alone" entry. A boolean arrives as true/false and reads as on/off.
export function optionValueLabel(option: AgentOption, value: string): string {
    if (option.type === 'boolean') {
        return value === 'true' ? 'on' : 'off'
    }
    const known = (option.values || []).find((v) => v.value === value)
    return known?.name || value
}

// keptOptions drops the settings this agent does not offer: switching an entry
// from an agent that has Fast mode to one that has not would otherwise leave a
// value in the config that nothing shows and nothing applies.
export function keptOptions(
    chosen: {[id: string]: string} | undefined,
    offered: AgentOption[],
): {[id: string]: string} {
    const kept: {[id: string]: string} = {}
    for (const option of offered) {
        const value = chosen?.[option.id]
        if (value) {
            kept[option.id] = value
        }
    }
    return kept
}

const emptyForm: AgentEntry = {name: '', kind: 'claude'}

type Props = {
    board: Board
    onClose: () => void
}

const AgentsDialog = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [agents, setAgents] = createSignal<AgentEntry[]>([])
    const [proxies, setProxies] = createSignal<ProxyEntry[]>([])
    const [systemPrompt, setSystemPrompt] = createSignal('')
    const [form, setForm] = createSignal<AgentEntry | null>(null)
    const [envText, setEnvText] = createSignal('')
    const [serversText, setServersText] = createSignal('')
    const [argsText, setArgsText] = createSignal('')
    const [commandText, setCommandText] = createSignal('')

    // Arguments for the CLI behind the adapter, kept as the text the user typed:
    // the Remote Control switch below edits this and nothing else, so there is
    // one place the setting lives.
    const [cliArgsText, setCliArgsText] = createSignal('')
    const [editingName, setEditingName] = createSignal<string | null>(null)
    const [adapters, setAdapters] = createSignal<AdapterStatus[]>([])
    const [installing, setInstalling] = createSignal('')
    const [error, setError] = createSignal('')

    // What the agent being edited says it can be configured with. Empty until
    // it has been asked, and empty for good if it declares nothing.
    const [agentOptions, setAgentOptions] = createSignal<AgentOption[]>([])
    const [probing, setProbing] = createSignal(false)
    const [probed, setProbed] = createSignal(false)
    const [probeError, setProbeError] = createSignal('')

    const refresh = async () => {
        if (!bindings?.ListAgents) {
            return
        }
        try {
            setAgents(JSON.parse(await bindings.ListAgents()) || [])
            if (bindings.ListProxies) {
                setProxies(JSON.parse(await bindings.ListProxies()) || [])
            }
            if (bindings.GetAgentSystemPrompt) {
                setSystemPrompt(await bindings.GetAgentSystemPrompt())
            }

            // Whether the chosen kind can start at all is knowable here, and
            // the alternative is finding out on a card an hour later.
            if (bindings.ListAgentAdapters) {
                setAdapters(JSON.parse(await bindings.ListAgentAdapters()) || [])
            }
        } catch (e) {
            setError(String(e))
            return
        }

        // Every registered agent is kept assignable on the board being looked
        // at: the accounts and memberships are created here, so a person field
        // can name an agent. Idempotent, so it rides along with every refresh —
        // opening the dialog, adding, editing or removing an agent — and stays
        // quiet unless an account actually appears. A failure is reported but
        // never hides the registry itself.
        if (!bindings.SyncAgentUsers) {
            return
        }
        try {
            const synced = (JSON.parse(await bindings.SyncAgentUsers(props.board.id)) || []) as Array<{created?: boolean}>
            const created = synced.filter((u) => u.created).length
            if (created > 0) {
                sendFlashMessage({
                    content: intl.formatMessage(
                        {id: 'Agents.users-synced', defaultMessage: 'Created {created} agent account(s); agents can now be assigned to cards'},
                        {created},
                    ),
                    severity: 'normal',
                })
            }
        } catch (e) {
            setError(String(e))
        }
    }

    onMount(() => {
        refresh()
    })

    // The adapter for the kind being edited, and the one action that fixes it.
    const adapter = () => adapters().find((a) => a.kind === form()?.kind)
    const installAdapter = async () => {
        if (!bindings?.InstallAgentAdapter || !form()?.kind) {
            return
        }
        setInstalling(form()!.kind)
        setError('')
        try {
            await bindings.InstallAgentAdapter(form()!.kind)
            sendFlashMessage({
                content: intl.formatMessage(
                    {id: 'Agents.adapter-installed', defaultMessage: 'Adapter installed: {package}'},
                    {package: adapter()?.package || form()!.kind},
                ),
                severity: 'normal',
            })
            await refresh()
        } catch (e) {
            setError(String(e))
        } finally {
            setInstalling('')
        }
    }

    // Which settings an agent has is the agent's own answer: it is started the
    // way a session would start it and asked, over ACP, what it can be
    // configured with. So Fast mode appears for an agent that has Fast mode and
    // for no other, and an agent that grows a setting shows it here without
    // anything being taught about it.
    //
    // probeToken drops an answer that arrives after the form moved on to
    // another agent, which is easy to do while a probe takes a second or two.
    let probeToken = 0
    const forgetOptions = () => {
        probeToken++
        setAgentOptions([])
        setProbed(false)
        setProbeError('')
        setProbing(false)
    }

    const probeAgent = async (entry: AgentEntry, recheck: boolean) => {
        if (!bindings?.AgentOptions) {
            return
        }

        // Nothing has been said yet about what to start.
        if (entry.kind === 'acp' && (entry.command || []).length === 0) {
            forgetOptions()
            return
        }
        const token = ++probeToken
        setProbing(true)
        setProbeError('')
        try {
            const reported = JSON.parse(await bindings.AgentOptions(JSON.stringify(entry), recheck)) || []
            if (token !== probeToken) {
                return
            }
            setAgentOptions(reported)
            setProbed(true)
        } catch (e) {
            if (token !== probeToken) {
                return
            }

            // Not an error of the form: the agent could not be asked (no
            // adapter, no account), and everything else here still saves.
            setAgentOptions([])
            setProbed(false)
            setProbeError(String(e))
        } finally {
            if (token === probeToken) {
                setProbing(false)
            }
        }
    }

    // The entry as the form currently describes it, which is what the probe
    // starts and what "Save" writes.
    const formEntry = (): AgentEntry => ({
        ...(form() || emptyForm),
        name: (form()?.name || '').trim(),
        env: textToEnv(envText()),
        args: splitArgv(argsText()),
        command: splitArgv(commandText()),
        cliArgs: splitArgv(cliArgsText()),
    })

    // The agent is asked when the form opens and when the kind changes — the
    // moments its answer can differ. The launch details (binary, command,
    // environment) are re-read on "Recheck" alone, so typing a path does not
    // start an agent on every keystroke.
    const startAdd = () => {
        setForm({...emptyForm})
        setEnvText('')
        setServersText('')
        setArgsText('')
        setCommandText('')
        setCliArgsText('')
        setEditingName(null)
        setError('')
        forgetOptions()
        probeAgent({...emptyForm}, false)
    }

    const startEdit = (agent: AgentEntry) => {
        setForm({...agent})
        setEnvText(envToText(agent.env))
        setServersText(serversToText(agent.mcpServers))
        setArgsText(joinArgv(agent.args))
        setCommandText(joinArgv(agent.command))
        setCliArgsText(joinArgv(agent.cliArgs))
        setEditingName(agent.name)
        setError('')
        forgetOptions()
        probeAgent(agent, false)
    }

    // Another kind is another agent, with settings of its own.
    const changeKind = (kind: string) => {
        setForm((f) => (f ? {...f, kind} : f))
        forgetOptions()
        probeAgent({...formEntry(), kind}, false)
    }

    const closeForm = () => {
        setForm(null)
        forgetOptions()
    }

    const saveForm = async () => {
        if (!bindings || !form()) {
            return
        }
        setError('')
        let mcpServers: AgentMCPServers
        try {
            mcpServers = textToServers(serversText())
        } catch (e) {
            setError(intl.formatMessage({id: 'Agents.mcp-servers-invalid', defaultMessage: 'MCP servers must be valid JSON: a server name mapped to its command and args, the same block any MCP client takes.'}))
            return
        }
        const entry: AgentEntry = {
            ...formEntry(),

            // Settings the agent no longer offers are dropped rather than kept
            // as a line in the config nobody can see or unset — switching the
            // kind is how they get there. Only a probe that answered may do
            // this: an agent that could not be asked keeps what it has.
            options: probed() ? keptOptions(form()!.options, agentOptions()) : form()!.options,
            mcpServers,
        }
        try {
            if (editingName()) {
                await bindings.UpdateAgent!(JSON.stringify(entry))
            } else {
                await bindings.AddAgent!(JSON.stringify(entry))
            }
            closeForm()
            await refresh()
        } catch (e) {
            setError(String(e))
        }
    }

    const removeAgent = async (name: string) => {
        if (!bindings?.RemoveAgent) {
            return
        }
        setError('')
        try {
            await bindings.RemoveAgent(name)
            await refresh()
        } catch (e) {
            setError(String(e))
        }
    }

    const saveSystemPrompt = async () => {
        if (!bindings?.SetAgentSystemPrompt) {
            return
        }
        setError('')
        try {
            await bindings.SetAgentSystemPrompt(systemPrompt())
            sendFlashMessage({content: intl.formatMessage({id: 'Agents.system-prompt-saved', defaultMessage: 'Saved board system prompt'}), severity: 'normal'})
        } catch (e) {
            setError(String(e))
        }
    }

    // syncToBoard adds every registered agent name as an option of the board's
    // "Agent" (single-)select property, creating the property when absent.
    // Add-only: existing options (which cards may reference) are never removed.
    const syncToBoard = async () => {
        setError('')
        try {
            const board = props.board
            const newProperties: IPropertyTemplate[] = board.cardProperties.map((p) => ({
                ...p,
                options: [...p.options],
            }))
            let property = newProperties.find((p) =>
                p.name.trim().toLowerCase() === AGENT_PROPERTY_NAME.toLowerCase() &&
                (p.type === 'select' || p.type === 'multiSelect'))
            if (!property) {
                property = {
                    id: Utils.createGuid(IDType.BlockID),
                    name: AGENT_PROPERTY_NAME,
                    type: 'select',
                    options: [],
                }
                newProperties.push(property)
            }

            const existing = new Set(property.options.map((o: IPropertyOption) => o.value.trim().toLowerCase()))
            const missing = agents().filter((a) => !existing.has(a.name.trim().toLowerCase()))
            for (const agent of missing) {
                property.options.push({
                    id: Utils.createGuid(IDType.BlockID),
                    value: agent.name,
                    color: 'propColorDefault',
                })
            }

            await mutator.updateBoardCardProperties(board.id, board.cardProperties, newProperties, 'sync agents')
            sendFlashMessage({
                content: intl.formatMessage(
                    {id: 'Agents.options-added', defaultMessage: 'Synced {count} agent option(s) to "{property}"'},
                    {count: missing.length, property: AGENT_PROPERTY_NAME},
                ),
                severity: 'normal',
            })
        } catch (e) {
            setError(String(e))
        }
    }

    const updateForm = (patch: Partial<AgentEntry>) => setForm((f) => (f ? {...f, ...patch} : f))

    // The model is asked for by the field above, so it is not asked for twice.
    const tunableOptions = () => agentOptions().filter((o) => o.id !== MODEL_OPTION_ID)
    const modelOption = () => agentOptions().find((o) => o.id === MODEL_OPTION_ID)

    // The switch is a reading of the arguments rather than a state of its own,
    // so typing the flag by hand and ticking the box are the same thing.
    const remoteControl = () => remoteControlOf(splitArgv(cliArgsText()))
    const setRemoteControl = (on: boolean, name: string) =>
        setCliArgsText(joinArgv(withRemoteControl(splitArgv(cliArgsText()), on, name)))

    return (
        <Dialog
            class='AgentsDialog'
            title={<span>{intl.formatMessage({id: 'Agents.title', defaultMessage: 'Agents'})}</span>}
            subtitle={<span>{intl.formatMessage({id: 'Agents.subtitle', defaultMessage: 'Register coding agents (Claude, Codex, Antigravity, GitHub Copilot, JetBrains Junie or any other ACP agent) with their own prompt, model, launch command, environment and proxy. Cards route to an agent by their assignee or the "Agent" field.'})}</span>}
            onClose={props.onClose}
        >
            <div class='AgentsDialog__content'>
                <Show when={agents().length === 0 && !form()}>
                    <div class='AgentsDialog__empty'>
                        {intl.formatMessage({id: 'Agents.empty', defaultMessage: 'No agents registered yet.'})}
                    </div>
                </Show>

                <For each={agents()}>
                    {(agent) => (
                        <div
                            class='AgentsDialog__row'
                        >
                            <span class='AgentsDialog__name'>{agent.name}</span>
                            <span class='AgentsDialog__kind'>{agent.kind}</span>
                            <Button onClick={() => startEdit(agent)}>
                                {intl.formatMessage({id: 'Agents.edit', defaultMessage: 'Edit'})}
                            </Button>
                            <Button onClick={() => removeAgent(agent.name)}>
                                {intl.formatMessage({id: 'Agents.remove', defaultMessage: 'Remove'})}
                            </Button>
                        </div>
                    )}
                </For>

                <Show when={form()}>
                    <div class='AgentsDialog__form'>
                        <label>
                            {intl.formatMessage({id: 'Agents.name', defaultMessage: 'Name'})}
                            <input
                                value={form()!.name}
                                disabled={Boolean(editingName())}
                                placeholder={intl.formatMessage({id: 'Agents.name-placeholder', defaultMessage: 'Name (matches the "Agent" option)'})}
                                onInput={(e) => updateForm({name: e.currentTarget.value})}
                            />
                        </label>
                        <label>
                            {intl.formatMessage({id: 'Agents.kind', defaultMessage: 'Kind'})}
                            <select
                                value={form()!.kind}
                                onChange={(e) => changeKind(e.currentTarget.value)}
                            >
                                <For each={AGENT_KINDS}>
                                    {(kind) => (
                                        <option
                                            value={kind.value}
                                            selected={form()!.kind === kind.value}
                                        >{kind.label}</option>
                                    )}
                                </For>
                            </select>
                        </label>
                        <Show when={adapter() && (!adapter()!.ready || adapter()!.viaNpx)}>
                            <div class={`AgentsDialog__adapter${adapter()!.ready ? '' : ' AgentsDialog__adapter--missing'}`}>
                                <span>{adapter()!.detail}</span>
                                <Show when={adapter()!.package && bindings?.InstallAgentAdapter}>
                                    <Button
                                        onClick={installAdapter}
                                        disabled={Boolean(installing())}
                                    >
                                        {installing() === adapter()!.kind ? intl.formatMessage({id: 'Agents.adapter-installing', defaultMessage: 'Installing…'}) : intl.formatMessage({id: 'Agents.adapter-install', defaultMessage: 'Install adapter'})}
                                    </Button>
                                </Show>
                            </div>
                        </Show>
                        <label>
                            {intl.formatMessage({id: 'Agents.model', defaultMessage: 'Model (optional)'})}
                            {/* Free text still, because an agent may take a
                                model it does not list; the list is what this
                                one said it has. */}
                            <input
                                value={form()!.model || ''}
                                list={modelOption() ? 'AgentsDialog__models' : undefined}
                                onInput={(e) => updateForm({model: e.currentTarget.value})}
                            />
                            <Show when={modelOption()}>
                                <datalist id='AgentsDialog__models'>
                                    <For each={modelOption()!.values || []}>
                                        {(value) => (
                                            <option
                                                value={value.value}
                                            >{value.name}</option>
                                        )}
                                    </For>
                                </datalist>
                            </Show>
                        </label>
                        <label>
                            {intl.formatMessage({id: 'Agents.binPath', defaultMessage: 'Binary path (optional)'})}
                            <input
                                value={form()!.binPath || ''}
                                onInput={(e) => updateForm({binPath: e.currentTarget.value})}
                            />
                        </label>
                        <label>
                            {intl.formatMessage({id: 'Agents.command', defaultMessage: 'Launch command (argv) — overrides the binary path; wrap the CLI to route it through a proxy. Required for "ACP (other)".'})}
                            <input
                                value={commandText()}
                                placeholder={commandPlaceholders[form()!.kind] || ''}
                                onInput={(e) => setCommandText(e.currentTarget.value)}
                            />
                        </label>

                        {/* What this agent can be told beyond the task, asked
                            of the agent itself. Nothing is drawn for an agent
                            that declares nothing — there is no choice to make. */}
                        <div class='AgentsDialog__options'>
                            <div class='AgentsDialog__optionsHeader'>
                                <span>{intl.formatMessage({id: 'Agents.options', defaultMessage: 'Agent settings'})}</span>
                                <Show when={bindings?.AgentOptions}>
                                    <Button
                                        onClick={() => probeAgent(formEntry(), true)}
                                        disabled={probing()}
                                    >
                                        {probing() ? intl.formatMessage({id: 'Agents.options-probing', defaultMessage: 'Asking the agent…'}) : intl.formatMessage({id: 'Agents.options-recheck', defaultMessage: 'Recheck'})}
                                    </Button>
                                </Show>
                            </div>
                            <For each={tunableOptions()}>
                                {(option) => (
                                    <div
                                        class='AgentsDialog__option'
                                    >
                                        <label>
                                            {option.name || option.id}
                                            <select
                                                value={form()!.options?.[option.id] || ''}
                                                onChange={(e) => updateForm({options: {...form()!.options, [option.id]: e.currentTarget.value}})}
                                            >
                                                <option
                                                    value=''
                                                    selected={!form()!.options?.[option.id]}
                                                >
                                                    {intl.formatMessage(
                                                        {id: 'Agents.option-default', defaultMessage: 'As the agent has it ({current})'},
                                                        {current: optionValueLabel(option, option.current)},
                                                    )}
                                                </option>
                                                <For each={optionValues(option)}>
                                                    {(value) => (
                                                        <option
                                                            value={value.value}
                                                            selected={(form()!.options?.[option.id] || '') === value.value}
                                                        >{value.name || value.value}</option>
                                                    )}
                                                </For>
                                            </select>
                                        </label>
                                        <Show when={option.description}>
                                            <div class='AgentsDialog__hint'>{option.description}</div>
                                        </Show>
                                    </div>
                                )}
                            </For>
                            <Show when={probing() && tunableOptions().length === 0}>
                                <div class='AgentsDialog__hint'>
                                    {intl.formatMessage({id: 'Agents.options-asking', defaultMessage: 'Starting the agent to ask what it supports…'})}
                                </div>
                            </Show>
                            <Show when={probed() && !probing() && tunableOptions().length === 0}>
                                <div class='AgentsDialog__hint'>
                                    {intl.formatMessage({id: 'Agents.options-none', defaultMessage: 'This agent has no settings of its own.'})}
                                </div>
                            </Show>
                            <Show when={probeError() && !probing()}>
                                <div class='AgentsDialog__hint'>
                                    {intl.formatMessage({id: 'Agents.options-failed', defaultMessage: 'Could not ask the agent what it supports: {error}'}, {error: probeError()})}
                                </div>
                            </Show>
                        </div>

                        {/* What the CLI behind the adapter can do and the
                            protocol has no word for. Only for the kinds whose
                            adapter passes arguments on: for the rest the agent
                            is the CLI, and "Extra CLI args" already reaches it. */}
                        <Show when={CLI_HANDOFF_KINDS.includes(form()!.kind)}>
                            <div class='AgentsDialog__options'>
                                <div class='AgentsDialog__optionsHeader'>
                                    <span>{intl.formatMessage({id: 'Agents.cli', defaultMessage: 'What the protocol has no word for'})}</span>
                                </div>
                                <label class='AgentsDialog__checkbox'>
                                    <input
                                        type='checkbox'
                                        checked={remoteControl().on}
                                        onChange={(e) => setRemoteControl(e.currentTarget.checked, remoteControl().name)}
                                    />
                                    {intl.formatMessage({id: 'Agents.remote-control', defaultMessage: 'Remote control — drive this agent\'s sessions from claude.ai or the Claude app'})}
                                </label>
                                <Show when={remoteControl().on}>
                                    <label>
                                        {intl.formatMessage({id: 'Agents.remote-control-name', defaultMessage: 'Session name prefix in claude.ai (optional)'})}
                                        <input
                                            value={remoteControl().name}
                                            placeholder={props.board.title}
                                            onInput={(e) => setRemoteControl(true, e.currentTarget.value)}
                                        />
                                    </label>
                                </Show>
                                <label>
                                    {intl.formatMessage({id: 'Agents.cli-args', defaultMessage: 'Arguments for the CLI behind the adapter'})}
                                    <input
                                        value={cliArgsText()}
                                        placeholder={'--fallback-model sonnet'}
                                        onInput={(e) => setCliArgsText(e.currentTarget.value)}
                                    />
                                </label>
                                <div class='AgentsDialog__hint'>
                                    {intl.formatMessage({id: 'Agents.cli-args-hint', defaultMessage: 'Handed to the CLI at session start. An argument it does not know shows up here as its own error when the agent is rechecked, not later on a card.'})}
                                </div>
                            </div>
                        </Show>

                        <label>
                            {intl.formatMessage({id: 'Agents.prompt', defaultMessage: 'Agent system prompt'})}
                            <textarea
                                rows={3}
                                value={form()!.prompt || ''}
                                onInput={(e) => updateForm({prompt: e.currentTarget.value})}
                            />
                        </label>
                        <label>
                            {intl.formatMessage({id: 'Agents.proxyName', defaultMessage: 'Proxy configuration'})}
                            <select
                                value={form()!.proxyName || ''}
                                onChange={(e) => updateForm({proxyName: e.currentTarget.value})}
                            >
                                <option
                                    value=''
                                    selected={!form()!.proxyName}
                                >
                                    {intl.formatMessage({id: 'Agents.proxy-none', defaultMessage: 'No proxy (inherit the app environment)'})}
                                </option>
                                <For each={proxies()}>
                                    {(p) => (
                                        <option
                                            value={p.name}
                                            selected={(form()!.proxyName || '') === p.name}
                                        >
                                            {p.proxy ? `${p.name} — ${p.proxy}` : p.name}
                                        </option>
                                    )}
                                </For>
                            </select>
                        </label>
                        <Show when={proxies().length === 0}>
                            <div class='AgentsDialog__hint'>
                                {intl.formatMessage({id: 'Agents.proxy-hint', defaultMessage: 'Configurations are added under "Proxy configurations" at the bottom of this dialog.'})}
                            </div>
                        </Show>
                        <label>
                            {intl.formatMessage({id: 'Agents.env', defaultMessage: 'Environment (KEY=VALUE per line — e.g. CODEX_HOME, OPENAI_API_KEY)'})}
                            <textarea
                                rows={3}
                                value={envText()}
                                placeholder={'CODEX_HOME=/Users/me/.codex-work'}
                                onInput={(e) => setEnvText(e.currentTarget.value)}
                            />
                        </label>
                        <label>
                            {intl.formatMessage({id: 'Agents.mcp-servers', defaultMessage: 'MCP servers (the JSON any MCP client takes) — offered to this agent in every session'})}
                            <textarea
                                rows={7}
                                value={serversText()}
                                placeholder={mcpServersPlaceholder}
                                onInput={(e) => setServersText(e.currentTarget.value)}
                            />
                        </label>
                        <div class='AgentsDialog__hint'>
                            {intl.formatMessage({id: 'Agents.mcp-servers-hint', defaultMessage: 'Their tools run without asking: wiring a server here is consent to use it. A browser server (Playwright, say) is what the "To Test" column runs on.'})}
                        </div>
                        <label>
                            {intl.formatMessage({id: 'Agents.args', defaultMessage: 'Extra CLI args (space-separated)'})}
                            <input
                                value={argsText()}
                                placeholder={'--sandbox workspace-write'}
                                onInput={(e) => setArgsText(e.currentTarget.value)}
                            />
                        </label>
                        <div class='AgentsDialog__formActions'>
                            <Button
                                emphasis='primary'
                                onClick={saveForm}
                            >
                                {intl.formatMessage({id: 'Agents.save', defaultMessage: 'Save'})}
                            </Button>
                            <Button onClick={closeForm}>
                                {intl.formatMessage({id: 'Agents.cancel', defaultMessage: 'Cancel'})}
                            </Button>
                        </div>
                    </div>
                </Show>

                <Show when={!form()}>
                    <div class='AgentsDialog__actions'>
                        <Button
                            emphasis='primary'
                            onClick={startAdd}
                        >
                            {intl.formatMessage({id: 'Agents.add', defaultMessage: 'Add agent…'})}
                        </Button>
                        <Show when={agents().length > 0}>
                            <Button onClick={syncToBoard}>
                                {intl.formatMessage({id: 'Agents.sync', defaultMessage: 'Sync to board'})}
                            </Button>
                        </Show>
                    </div>
                </Show>

                <Show when={!form() && agents().length > 0 && Boolean(bindings?.SyncAgentUsers)}>
                    <div class='AgentsDialog__hint'>
                        {intl.formatMessage({id: 'Agents.assignable-hint', defaultMessage: 'Every agent above is a member of this board under its own name, so you can pick it in a person field such as "Assignee".'})}
                    </div>
                </Show>

                <div class='AgentsDialog__systemPrompt'>
                    <label>
                        {intl.formatMessage({id: 'Agents.system-prompt', defaultMessage: 'Board system prompt (prepended to every agent prompt)'})}
                        <textarea
                            rows={3}
                            value={systemPrompt()}
                            onInput={(e) => setSystemPrompt(e.currentTarget.value)}
                        />
                    </label>
                    <Button onClick={saveSystemPrompt}>
                        {intl.formatMessage({id: 'Agents.save-system-prompt', defaultMessage: 'Save system prompt'})}
                    </Button>
                </div>

                {/* Proxies exist only to be referenced by an agent, so they live
                    here, folded away until someone needs one. */}
                <Show when={isProxiesAvailable()}>
                    <details class='AgentsDialog__proxies'>
                        <summary>
                            {intl.formatMessage({id: 'Proxies.title', defaultMessage: 'Proxy configurations'})}
                        </summary>
                        <ProxiesPanel onChange={refresh}/>
                    </details>
                </Show>

                <Show when={error()}>
                    <div class='AgentsDialog__error'>{error()}</div>
                </Show>
            </div>
        </Dialog>
    )
}

export default AgentsDialog
