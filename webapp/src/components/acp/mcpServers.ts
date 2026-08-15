// MCP servers as a person edits them: the JSON block every MCP client takes,
// pasted from a server's README.
//
// It lives on its own because three screens now ask the same question of three
// different owners — the agent («Настройки → Агенты»), the column and the
// stage of a route («Колонки и маршруты…») — and one shape of the answer is
// what keeps them from drifting into three.

// The standard MCP client shape: a name mapped to the command that starts it.
export type MCPServer = {
    command?: string
    args?: string[]
    env?: {[key: string]: string}
    type?: string
    url?: string
}

export type MCPServers = {[name: string]: MCPServer}

// What the field expects, shown when it is empty: the browser server a test
// column needs, in the form its own README gives it.
export const mcpServersPlaceholder = JSON.stringify({
    mcpServers: {
        playwright: {command: 'npx', args: ['-y', '@playwright/mcp@latest', '--headless', '--browser', 'chrome']},
    },
}, null, 2)

// serversToText / textToServers convert between the textarea and the map, in
// the JSON every MCP client uses. The mcpServers wrapper is written on the way
// out and accepted but not required on the way in, which is what lets a block
// be pasted from a server's README as it is. Invalid JSON throws: the caller
// says so instead of silently saving an empty list.
export function serversToText(servers?: MCPServers): string {
    if (!servers || Object.keys(servers).length === 0) {
        return ''
    }
    return JSON.stringify({mcpServers: servers}, null, 2)
}

export function textToServers(text: string): MCPServers {
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
        const named: MCPServers = {}
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
