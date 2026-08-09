// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {fireEvent, render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {chooseOption, optionsOf, wrapIntl} from '../../testUtils'

import AgentsPanel, {isAgentsAvailable, textToServers, keptOptions, remoteControlOf, withRemoteControl} from './agentsPanel'

const anyWindow = window as any

describe('components/acp/agentsPanel', () => {
    afterEach(() => {
        delete anyWindow.go
        vi.clearAllMocks()
    })

    test('isAgentsAvailable is false without desktop bindings', () => {
        expect(isAgentsAvailable()).toBe(false)
    })

    test('lists agents and adds a codex agent with env', async () => {
        const bindings = {
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'default-agent', kind: 'claude'}])),
            GetAgentSystemPrompt: vi.fn().mockResolvedValue(''),
            SetAgentSystemPrompt: vi.fn().mockResolvedValue(undefined),
            AddAgent: vi.fn().mockResolvedValue(JSON.stringify({name: 'codex-a', kind: 'codex'})),
            UpdateAgent: vi.fn(),
            RemoveAgent: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}
        expect(isAgentsAvailable()).toBe(true)

        render(() => wrapIntl(() =>
            <AgentsPanel/>,
        ))
        await waitFor(() => expect(screen.getByText('default-agent')).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Add agent…'}))

        // Two dropdowns in the form: the agent kind, then the proxy configuration.
        await waitFor(() => expect(screen.getByRole('button', {name: 'Kind'})).toBeInTheDocument())

        chooseOption(screen.getByRole('button', {name: 'Kind'}), 'Codex')
        userEvent.type(screen.getByPlaceholderText('Name'), 'codex-a')
        userEvent.type(screen.getByPlaceholderText('CODEX_HOME=/Users/me/.codex-work'), 'CODEX_HOME=/tmp/x')

        userEvent.click(screen.getByRole('button', {name: 'Save'}))
        await waitFor(() => expect(bindings.AddAgent).toHaveBeenCalled())
        const payload = JSON.parse(bindings.AddAgent.mock.calls[0][0])
        expect(payload).toMatchObject({name: 'codex-a', kind: 'codex', env: {CODEX_HOME: '/tmp/x'}})
    })

    test('saves a wrapped launch command and picks a registered proxy configuration', async () => {
        const bindings = {
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([])),
            ListProxies: vi.fn().mockResolvedValue(JSON.stringify([
                {name: 'office', proxy: 'http://proxy.example.com:8080'},
            ])),
            GetAgentSystemPrompt: vi.fn().mockResolvedValue(''),
            SetAgentSystemPrompt: vi.fn(),
            AddAgent: vi.fn().mockResolvedValue(JSON.stringify({name: 'proxied', kind: 'claude'})),
            UpdateAgent: vi.fn(),
            RemoveAgent: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =>
            <AgentsPanel/>,
        ))
        await waitFor(() => expect(screen.getByRole('button', {name: 'Add agent…'})).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Add agent…'}))
        await waitFor(() => expect(screen.getByRole('button', {name: 'Kind'})).toBeInTheDocument())

        userEvent.type(screen.getByPlaceholderText('Name'), 'proxied')

        // The launch command is offered for claude too, and quoted arguments
        // stay a single argv element.
        userEvent.type(screen.getByPlaceholderText('proxychains4 -q -f /etc/myproxy.conf claude-agent-acp'), 'proxychains4 -f "/etc/my conf.conf" claude-agent-acp')

        // The network settings themselves live in the proxy registry; the agent
        // only names one.
        chooseOption(screen.getByRole('button', {name: 'Proxy configuration'}), 'office — http://proxy.example.com:8080')

        userEvent.click(screen.getByRole('button', {name: 'Save'}))
        await waitFor(() => expect(bindings.AddAgent).toHaveBeenCalled())
        const payload = JSON.parse(bindings.AddAgent.mock.calls[0][0])
        expect(payload).toMatchObject({
            name: 'proxied',
            kind: 'claude',
            command: ['proxychains4', '-f', '/etc/my conf.conf', 'claude-agent-acp'],
            proxyName: 'office',
        })
    })

    // Two kinds are reached through an adapter published on npm, so whether one
    // is installed is knowable here — and the alternative is a card failing an
    // hour later with nobody watching.
    test('says when the kind cannot be started and offers to install it', async () => {
        const bindings = {
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([])),
            GetAgentSystemPrompt: vi.fn().mockResolvedValue(''),
            SetAgentSystemPrompt: vi.fn(),
            ListAgentAdapters: vi.fn().mockResolvedValue(JSON.stringify([
                {kind: 'claude', package: '@agentclientprotocol/claude-agent-acp', ready: false, detail: 'не найден claude-agent-acp'},
                {kind: 'codex', package: '@agentclientprotocol/codex-acp', ready: true, path: '/usr/local/bin/codex-acp'},
            ])),
            InstallAgentAdapter: vi.fn().mockResolvedValue('added 1 package'),
            AddAgent: vi.fn(),
            UpdateAgent: vi.fn(),
            RemoveAgent: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =>
            <AgentsPanel/>,
        ))
        await waitFor(() => expect(bindings.ListAgentAdapters).toHaveBeenCalled())

        userEvent.click(screen.getByRole('button', {name: 'Add agent…'}))

        // The default kind is claude, which this machine cannot start.
        await waitFor(() => expect(screen.getByText('не найден claude-agent-acp')).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Install adapter'}))
        await waitFor(() => expect(bindings.InstallAgentAdapter).toHaveBeenCalledWith('claude'))

        // An installed kind says nothing at all.
        chooseOption(screen.getByRole('button', {name: 'Kind'}), 'Codex')
        await waitFor(() => expect(screen.queryByText('не найден claude-agent-acp')).not.toBeInTheDocument())
    })

    test('offers the ACP-native kinds and saves one without a launch command', async () => {
        const bindings = {
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([])),
            GetAgentSystemPrompt: vi.fn().mockResolvedValue(''),
            SetAgentSystemPrompt: vi.fn(),
            AddAgent: vi.fn().mockResolvedValue(JSON.stringify({name: 'junie-a', kind: 'junie'})),
            UpdateAgent: vi.fn(),
            RemoveAgent: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =>
            <AgentsPanel/>,
        ))
        await waitFor(() => expect(screen.getByRole('button', {name: 'Add agent…'})).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Add agent…'}))
        await waitFor(() => expect(screen.getByRole('button', {name: 'Kind'})).toBeInTheDocument())

        const kind = screen.getByRole('button', {name: 'Kind'})
        expect(optionsOf(kind)).toEqual(['Claude', 'Codex', 'Antigravity', 'GitHub Copilot', 'JetBrains Junie', 'ACP (other)'])

        chooseOption(kind, 'JetBrains Junie')
        userEvent.type(screen.getByPlaceholderText('Name'), 'junie-a')

        // The kind carries its own default launch flags, so the command input
        // only shows them as a placeholder and stays empty.
        expect(screen.getByPlaceholderText('junie --acp=true')).toHaveValue('')

        userEvent.click(screen.getByRole('button', {name: 'Save'}))
        await waitFor(() => expect(bindings.AddAgent).toHaveBeenCalled())
        const payload = JSON.parse(bindings.AddAgent.mock.calls[0][0])
        expect(payload).toMatchObject({name: 'junie-a', kind: 'junie', command: []})
    })

    test('wires an MCP server of the agent\'s own and reloads it for editing', async () => {
        const bindings = {
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([])),
            ListProxies: vi.fn().mockResolvedValue('[]'),
            GetAgentSystemPrompt: vi.fn().mockResolvedValue(''),
            SetAgentSystemPrompt: vi.fn(),
            AddAgent: vi.fn().mockResolvedValue(JSON.stringify({name: 'jojo', kind: 'junie'})),
            UpdateAgent: vi.fn(),
            RemoveAgent: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =>
            <AgentsPanel/>,
        ))
        await waitFor(() => expect(screen.getByRole('button', {name: 'Add agent…'})).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Add agent…'}))
        await waitFor(() => expect(screen.getByPlaceholderText('Name')).toBeInTheDocument())

        userEvent.type(screen.getByPlaceholderText('Name'), 'jojo')

        // Pasted the way a server's own README gives it, wrapper and all.
        const field = screen.getByRole('textbox', {name: /MCP servers/})
        fireEvent.input(field, {target: {value: '{"mcpServers": {"playwright": {"command": "npx", "args": ["-y", "@playwright/mcp@latest"]}}}'}})

        userEvent.click(screen.getByRole('button', {name: 'Save'}))
        await waitFor(() => expect(bindings.AddAgent).toHaveBeenCalled())
        expect(JSON.parse(bindings.AddAgent.mock.calls[0][0])).toMatchObject({
            name: 'jojo',
            mcpServers: {playwright: {command: 'npx', args: ['-y', '@playwright/mcp@latest']}},
        })
    })

    test('takes MCP servers listed instead of keyed by name', () => {
        // Some clients write them as a list; the config file reads both shapes,
        // so pasting from one of them must not be refused here either.
        expect(textToServers('[{"name": "pw", "command": "npx", "args": ["-y", "@playwright/mcp@latest"]}]')).toEqual({
            pw: {command: 'npx', args: ['-y', '@playwright/mcp@latest']},
        })
        expect(() => textToServers('[{"command": "npx"}]')).toThrow(/name/)
    })

    test('refuses to save MCP servers that are not JSON', async () => {
        const bindings = {
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([])),
            ListProxies: vi.fn().mockResolvedValue('[]'),
            GetAgentSystemPrompt: vi.fn().mockResolvedValue(''),
            SetAgentSystemPrompt: vi.fn(),
            AddAgent: vi.fn(),
            UpdateAgent: vi.fn(),
            RemoveAgent: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =>
            <AgentsPanel/>,
        ))
        await waitFor(() => expect(screen.getByRole('button', {name: 'Add agent…'})).toBeInTheDocument())
        userEvent.click(screen.getByRole('button', {name: 'Add agent…'}))
        await waitFor(() => expect(screen.getByPlaceholderText('Name')).toBeInTheDocument())

        userEvent.type(screen.getByPlaceholderText('Name'), 'jojo')
        fireEvent.input(screen.getByRole('textbox', {name: /MCP servers/}), {target: {value: 'playwright = npx'}})
        userEvent.click(screen.getByRole('button', {name: 'Save'}))

        // Saving half a configuration is worse than not saving it.
        await waitFor(() => expect(screen.getByText(/must be valid JSON/)).toBeInTheDocument())
        expect(bindings.AddAgent).not.toHaveBeenCalled()
    })

    test('round-trips the MCP server list through the form', async () => {
        const bindings = {
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([
                {name: 'jojo', kind: 'junie', mcpServers: {playwright: {command: 'npx', args: ['-y', '@playwright/mcp@latest']}}},
            ])),
            ListProxies: vi.fn().mockResolvedValue('[]'),
            GetAgentSystemPrompt: vi.fn().mockResolvedValue(''),
            SetAgentSystemPrompt: vi.fn(),
            AddAgent: vi.fn(),
            UpdateAgent: vi.fn().mockResolvedValue('{}'),
            RemoveAgent: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =>
            <AgentsPanel/>,
        ))
        await waitFor(() => expect(screen.getByText('jojo')).toBeInTheDocument())
        userEvent.click(screen.getAllByRole('button', {name: 'Edit'})[0])

        // Reloaded as the same JSON, wrapper included, so it can be edited and
        // pasted onwards.
        await waitFor(() => expect(screen.getByRole('textbox', {name: /MCP servers/})).toHaveValue(
            JSON.stringify({mcpServers: {playwright: {command: 'npx', args: ['-y', '@playwright/mcp@latest']}}}, null, 2),
        ))
        userEvent.click(screen.getByRole('button', {name: 'Save'}))
        await waitFor(() => expect(bindings.UpdateAgent).toHaveBeenCalled())
        expect(JSON.parse(bindings.UpdateAgent.mock.calls[0][0])).toMatchObject({
            mcpServers: {playwright: {command: 'npx', args: ['-y', '@playwright/mcp@latest']}},
        })
    })

    // Some agents have settings of their own — Fast mode, an effort level — and
    // some have none. Which ones exist is the agent's own answer, asked of it
    // over ACP, so the form offers exactly those and nothing else.
    test('offers the settings the agent declares, and saves the chosen value', async () => {
        const bindings = {
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'clyde', kind: 'claude'}])),
            ListProxies: vi.fn().mockResolvedValue('[]'),
            GetAgentSystemPrompt: vi.fn().mockResolvedValue(''),
            SetAgentSystemPrompt: vi.fn(),
            AgentOptions: vi.fn().mockResolvedValue(JSON.stringify([
                {id: 'model', name: 'Model', type: 'select', current: 'opus', values: [{value: 'opus', name: 'Opus'}]},
                {id: 'fast', name: 'Fast mode', description: 'Faster responses on supported models', type: 'select', current: 'off', values: [{value: 'on', name: 'On'}, {value: 'off', name: 'Off'}]},
            ])),
            AddAgent: vi.fn(),
            UpdateAgent: vi.fn().mockResolvedValue('{}'),
            RemoveAgent: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =>
            <AgentsPanel/>,
        ))
        await waitFor(() => expect(screen.getByText('clyde')).toBeInTheDocument())
        userEvent.click(screen.getAllByRole('button', {name: 'Edit'})[0])

        await waitFor(() => expect(bindings.AgentOptions).toHaveBeenCalled())
        expect(bindings.AgentOptions.mock.calls[0][1]).toBe(false)

        // The model is asked for by its own field, so it is not asked twice.
        const fast = await screen.findByRole('button', {name: 'Fast mode'})
        expect(screen.queryByRole('button', {name: 'Model'})).not.toBeInTheDocument()

        chooseOption(fast, 'On')
        userEvent.click(screen.getByRole('button', {name: 'Save'}))
        await waitFor(() => expect(bindings.UpdateAgent).toHaveBeenCalled())
        expect(JSON.parse(bindings.UpdateAgent.mock.calls[0][0]).options).toEqual({fast: 'on'})
    })

    test('offers nothing for an agent that declares nothing', async () => {
        const bindings = {
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'plain', kind: 'junie'}])),
            ListProxies: vi.fn().mockResolvedValue('[]'),
            GetAgentSystemPrompt: vi.fn().mockResolvedValue(''),
            SetAgentSystemPrompt: vi.fn(),
            AgentOptions: vi.fn().mockResolvedValue('[]'),
            AddAgent: vi.fn(),
            UpdateAgent: vi.fn().mockResolvedValue('{}'),
            RemoveAgent: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =>
            <AgentsPanel/>,
        ))
        await waitFor(() => expect(screen.getByText('plain')).toBeInTheDocument())
        userEvent.click(screen.getAllByRole('button', {name: 'Edit'})[0])

        await waitFor(() => expect(screen.getByText('This agent has no settings of its own.')).toBeInTheDocument())

        // Only the two the form always has: the kind and the proxy.
        expect(screen.getByRole('button', {name: 'Kind'})).toBeInTheDocument()
        expect(screen.getByRole('button', {name: 'Proxy configuration'})).toBeInTheDocument()
    })

    // The answer is cached, so "Recheck" is how an agent is asked again after
    // its account or adapter changed.
    test('rechecks what the agent supports on demand', async () => {
        const bindings = {
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'clyde', kind: 'claude'}])),
            ListProxies: vi.fn().mockResolvedValue('[]'),
            GetAgentSystemPrompt: vi.fn().mockResolvedValue(''),
            SetAgentSystemPrompt: vi.fn(),
            AgentOptions: vi.fn().mockResolvedValue('[]'),
            AddAgent: vi.fn(),
            UpdateAgent: vi.fn(),
            RemoveAgent: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =>
            <AgentsPanel/>,
        ))
        await waitFor(() => expect(screen.getByText('clyde')).toBeInTheDocument())
        userEvent.click(screen.getAllByRole('button', {name: 'Edit'})[0])
        await waitFor(() => expect(bindings.AgentOptions).toHaveBeenCalledTimes(1))

        userEvent.click(screen.getByRole('button', {name: 'Recheck'}))
        await waitFor(() => expect(bindings.AgentOptions).toHaveBeenCalledTimes(2))
        expect(bindings.AgentOptions.mock.calls[1][1]).toBe(true)
    })

    // Switching an entry from an agent that has Fast mode to one that has not
    // must not leave a setting behind that nothing shows and nothing applies.
    test('keptOptions drops what the agent does not offer', () => {
        const kept = keptOptions({fast: 'on', effort: 'high'}, [
            {id: 'effort', name: 'Effort', type: 'select', current: 'default', values: [{value: 'high'}]},
        ])
        expect(kept).toEqual({effort: 'high'})
    })

    // Remote Control is a flag of the CLI behind the adapter and nothing in ACP,
    // so the probe cannot find it: it is named in the form and handed over in
    // session/new's _meta. Only for the kinds whose adapter passes arguments on.
    test('turns remote control on for claude and saves it as a CLI argument', async () => {
        const bindings = {
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'clyde', kind: 'claude'}])),
            ListProxies: vi.fn().mockResolvedValue('[]'),
            GetAgentSystemPrompt: vi.fn().mockResolvedValue(''),
            SetAgentSystemPrompt: vi.fn(),
            AgentOptions: vi.fn().mockResolvedValue('[]'),
            AddAgent: vi.fn(),
            UpdateAgent: vi.fn().mockResolvedValue('{}'),
            RemoveAgent: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =>
            <AgentsPanel/>,
        ))
        await waitFor(() => expect(screen.getByText('clyde')).toBeInTheDocument())
        userEvent.click(screen.getAllByRole('button', {name: 'Edit'})[0])

        const toggle = await screen.findByRole('checkbox', {name: /Remote control/})
        expect(toggle).not.toBeChecked()
        userEvent.click(toggle)

        // The name appears only once it is switched on, and it is one setting:
        // both end up in the arguments field.
        userEvent.type(await screen.findByRole('textbox', {name: /Session name prefix/}), 'my board')
        expect(screen.getByRole('textbox', {name: /Arguments for the CLI/})).toHaveValue('--remote-control --remote-control-session-name-prefix "my board"')

        userEvent.click(screen.getByRole('button', {name: 'Save'}))
        await waitFor(() => expect(bindings.UpdateAgent).toHaveBeenCalled())
        expect(JSON.parse(bindings.UpdateAgent.mock.calls[0][0]).cliArgs).toEqual([
            '--remote-control', '--remote-control-session-name-prefix', 'my board',
        ])
    })

    test('offers no remote control for a kind whose adapter cannot pass it on', async () => {
        const bindings = {
            ListAgents: vi.fn().mockResolvedValue(JSON.stringify([{name: 'cx', kind: 'codex'}])),
            ListProxies: vi.fn().mockResolvedValue('[]'),
            GetAgentSystemPrompt: vi.fn().mockResolvedValue(''),
            SetAgentSystemPrompt: vi.fn(),
            AgentOptions: vi.fn().mockResolvedValue('[]'),
            AddAgent: vi.fn(),
            UpdateAgent: vi.fn(),
            RemoveAgent: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =>
            <AgentsPanel/>,
        ))
        await waitFor(() => expect(screen.getByText('cx')).toBeInTheDocument())
        userEvent.click(screen.getAllByRole('button', {name: 'Edit'})[0])

        await waitFor(() => expect(screen.getByRole('button', {name: 'Save'})).toBeInTheDocument())
        expect(screen.queryByRole('checkbox', {name: /Remote control/})).not.toBeInTheDocument()
    })

    // The switch is a reading of the arguments, not a state beside them, so
    // typing the flag by hand and ticking the box are the same thing.
    test('the remote control switch and the arguments are one setting', () => {
        expect(remoteControlOf(['--remote-control', '--verbose'])).toEqual({on: true, name: ''})
        expect(remoteControlOf(['--verbose'])).toEqual({on: false, name: ''})
        expect(remoteControlOf(['--remote-control', '--remote-control-session-name-prefix', 'x'])).toEqual({on: true, name: 'x'})

        // Switching it off leaves everything else where it was.
        expect(withRemoteControl(['--verbose', '--remote-control', '--remote-control-session-name-prefix', 'x'], false, 'x')).toEqual(['--verbose'])
        expect(withRemoteControl(['--verbose'], true, 'my board')).toEqual(['--remote-control', '--remote-control-session-name-prefix', 'my board', '--verbose'])

        // Kept as typed: trimming here would eat the space as it is typed.
        expect(withRemoteControl([], true, 'my ')).toEqual(['--remote-control', '--remote-control-session-name-prefix', 'my '])
        expect(withRemoteControl(['--verbose'], true, '')).toEqual(['--remote-control', '--verbose'])
    })
})
