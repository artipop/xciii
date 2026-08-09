// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {agentBindings} from './bindings'

// What the agents are doing, as it happens: a session changed state, a terminal
// opened or closed, a card started waiting for a person.
//
// It arrives over one socket on the front door (/acp/events/ws) rather than
// over window.runtime.EventsOn, which is the Wails event bus. The bus reaches
// the windows the desktop app owns and stops there, so a board opened on a
// phone through the tailnet door — the same page, served by the same front
// door — heard nothing at all. One socket for every client is both simpler and
// the only thing that works everywhere.
//
// The socket is shared: every subscriber on the page is a handler in the map
// below, so a board full of cards costs one connection.

export type AgentEventHandler = (payload: any) => void

const handlers = new Map<string, Set<AgentEventHandler>>()

let socket: WebSocket | undefined
let reconnect: ReturnType<typeof setTimeout> | undefined
let attempt = 0

const socketURL = (): string => {
    // Absolute, not relative: this runs from every page of the app, and a
    // relative address would resolve against whatever path that page has.
    const url = new URL('/acp/events/ws', window.location.origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.toString()
}

const deliver = (event: string, payload: any): void => {
    handlers.get(event)?.forEach((handler) => {
        try {
            handler(payload)
        } catch {
            // One subscriber's failure is not the others' business.
        }
    })
}

const connect = (): void => {
    if (socket || handlers.size === 0) {
        return
    }
    const ws = new WebSocket(socketURL())
    socket = ws

    ws.onopen = () => {
        attempt = 0

        // A connection that was dropped missed whatever happened while it was
        // gone, so every subscriber is told to look again. A handler reads an
        // absent payload as "something changed, I don't know what".
        handlers.forEach((_, event) => deliver(event, undefined))
    }
    ws.onmessage = (message) => {
        try {
            const parsed = JSON.parse(message.data)
            if (parsed?.event) {
                deliver(parsed.event, parsed.data)
            }
        } catch {
            // Not ours, or truncated: there is nothing useful to do with it.
        }
    }
    ws.onclose = () => {
        if (socket !== ws) {
            return
        }
        socket = undefined
        if (handlers.size === 0) {
            return
        }

        // Backing off matters here: the app being closed and the machine being
        // asleep both look like this, and a phone that retried every 100ms
        // would spend the night doing it.
        attempt++
        const delay = Math.min(30000, 500 * Math.pow(2, Math.min(attempt, 6)))
        reconnect = setTimeout(connect, delay)
    }
    ws.onerror = () => ws.close()
}

const disconnectIfIdle = (): void => {
    if (handlers.size > 0) {
        return
    }
    if (reconnect) {
        clearTimeout(reconnect)
        reconnect = undefined
    }
    const ws = socket
    socket = undefined
    ws?.close()
}

// onAgentEvent subscribes to one event for as long as the returned function is
// not called. It stays inert where there are no agents to hear about — a
// browser build with no bridge to a desktop app — for the same reason every
// other use of these bindings is feature-detected.
export function onAgentEvent(event: string, handler: AgentEventHandler): () => void {
    if (!agentBindings()) {
        return () => undefined
    }
    const existing = handlers.get(event) || new Set<AgentEventHandler>()
    existing.add(handler)
    handlers.set(event, existing)
    connect()

    return () => {
        const set = handlers.get(event)
        if (!set) {
            return
        }
        set.delete(handler)
        if (set.size === 0) {
            handlers.delete(event)
        }
        disconnectIfIdle()
    }
}
