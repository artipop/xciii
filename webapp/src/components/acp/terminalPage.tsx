// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onCleanup, onMount} from 'solid-js'
import type {JSX} from 'solid-js'
import {useParams} from '@solidjs/router'

import {useIntl} from '../../intl'

import Button from '../../widgets/buttons/button'

import {agentBindings} from './bindings'

import '@xterm/xterm/css/xterm.css'
import './terminalPage.scss'

// The page a terminal window shows: the agent's own CLI, drawn by xterm.js and
// wired to the pty over the WebSocket at /acp/terminal/<id>/ws. Everything else
// about the session — which project, which worktree, which branch, what the
// card asked for — was decided when the terminal was started; this only draws
// it and types into it.
//
// xterm is imported dynamically so it lands in a chunk of its own: a browser or
// plugin build never opens this page and should not pay for the emulator.

type TerminalInfo = {
    id: string
    cardId?: string
    title?: string
    task?: string
    cwd: string
    branch?: string
    agent: string
    kind: string
    command: string
    running: boolean
    exitCode: number
}

// The keys a phone keyboard does not have, and a CLI cannot be worked without.
// Ctrl+C is the one that matters — it is how a runaway agent is stopped — and
// the arrows are how its menus are answered.
const softKeys = [
    {label: 'esc', data: '\x1b'},
    {label: 'tab', data: '\t'},
    {label: '^C', data: '\x03'},
    {label: '↑', data: '\x1b[A'},
    {label: '↓', data: '\x1b[B'},
    {label: '←', data: '\x1b[D'},
    {label: '→', data: '\x1b[C'},
    {label: '⏎', data: '\r'},
]

type TerminalProps = {

    // Which terminal to draw. A window takes it from its own address; the card
    // passes it in, because the panel behind the card's chevron is this same
    // page drawn inside the card rather than in a window of its own.
    terminalId?: string

    // Whether to draw the soft key row. It is for a phone: on a desktop the
    // keyboard already has these, and a row of buttons would only take screen
    // away from the CLI.
    softKeys?: boolean
}

const TerminalPage = (props: TerminalProps = {}): JSX.Element => {
    const intl = useIntl()
    const params = useParams<{terminalId: string}>()
    const terminalId = props.terminalId || params.terminalId

    let host: HTMLDivElement | undefined
    const [info, setInfo] = createSignal<TerminalInfo | null>(null)
    const [status, setStatus] = createSignal<'connecting' | 'live' | 'closed'>('connecting')
    const [error, setError] = createSignal('')
    let writeToPty: (data: string) => void = () => undefined

    // The task text is a button rather than something typed for you: a CLI is
    // not ready for input the moment it starts, and typing into a TUI that is
    // still painting loses the first characters.
    const pasteTask = () => {
        const task = info()?.task
        if (task) {
            writeToPty(task)
        }
    }

    onMount(() => {
        const bindings = agentBindings()
        if (!bindings?.GetTerminalInfo) {
            setError(intl.formatMessage({id: 'acp.terminal.noBindings', defaultMessage: 'The terminal is only available in the desktop app.'}))
            return
        }
        bindings.GetTerminalInfo(terminalId).
            then((json: string) => setInfo(JSON.parse(json) as TerminalInfo)).
            catch((e: Error) => setError(String(e?.message || e)))
    })

    onMount(() => {
        let disposed = false
        let terminal: any = null
        let fit: any = null
        let observer: ResizeObserver | null = null
        let socket: WebSocket | null = null

        const start = async () => {
            const [{Terminal}, {FitAddon}] = await Promise.all([
                import('@xterm/xterm'),
                import('@xterm/addon-fit'),
            ])
            if (disposed || !host) {
                return
            }

            // xterm paints on a canvas, so it cannot read CSS: the family and
            // the two colours have to be handed to it as strings. They are
            // taken off the page rather than written here, so the emulator and
            // the chrome around it can never drift apart.
            const style = getComputedStyle(host)
            const colour = (token: string, fallback: string) => {
                const triple = style.getPropertyValue(token).trim()
                return triple ? `rgb(${triple})` : fallback
            }
            terminal = new Terminal({
                fontFamily: style.getPropertyValue('--font-mono').trim() ||
                    'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                fontSize: 13,
                cursorBlink: true,
                convertEol: false,
                theme: {
                    background: colour('--canvas-rgb', '#0c0c0e'),
                    foreground: colour('--ink-rgb', '#e9e9ec'),
                },
            })
            fit = new FitAddon()
            terminal.loadAddon(fit)
            terminal.open(host)
            fit.fit()

            // Absolute, not relative: this page's own path is
            // /acp/terminal/<id>, so a relative address would resolve against
            // that directory and ask for /acp/terminal/acp/terminal/<id>/ws.
            const url = new URL(`/acp/terminal/${terminalId}/ws`, window.location.origin)
            url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
            const ws = new WebSocket(url.toString())
            ws.binaryType = 'arraybuffer'
            socket = ws

            const sendSize = () => {
                if (ws.readyState === WebSocket.OPEN && terminal) {
                    ws.send(JSON.stringify({type: 'resize', cols: terminal.cols, rows: terminal.rows}))
                }
            }

            ws.onopen = () => {
                setStatus('live')
                sendSize()
            }
            ws.onmessage = (event: MessageEvent) => {
                if (typeof event.data === 'string') {
                    // The only text frame is the CLI saying it has exited.
                    if (event.data.includes('"exit"')) {
                        setStatus('closed')
                    }
                    return
                }
                terminal.write(new Uint8Array(event.data as ArrayBuffer))
            }
            ws.onclose = () => setStatus('closed')
            ws.onerror = () => setStatus('closed')

            const encoder = new TextEncoder()
            terminal.onData((data: string) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(encoder.encode(data))
                }
            })
            writeToPty = (data: string) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(encoder.encode(data))
                }
            }

            observer = new ResizeObserver(() => {
                try {
                    fit.fit()
                } catch (e) {
                    // The window is mid-layout; the next tick fits it.
                }
                sendSize()
            })
            observer.observe(host)
            terminal.focus()
        }

        start().catch((e) => setError(String(e?.message || e)))

        onCleanup(() => {
            disposed = true
            observer?.disconnect()
            socket?.close()
            socket = null
            terminal?.dispose()
        })
    })

    const statusText = () => ({
        connecting: intl.formatMessage({id: 'acp.terminal.connecting', defaultMessage: 'connecting…'}),
        live: intl.formatMessage({id: 'acp.terminal.live', defaultMessage: 'session running'}),
        closed: intl.formatMessage({id: 'acp.terminal.closed', defaultMessage: 'the CLI has exited — this window can be closed'}),
    }[status()])

    return (
        <div class='AcpTerminalPage'>
            <div class='AcpTerminalPage__header'>
                <div class='AcpTerminalPage__title'>
                    <span class='AcpTerminalPage__agent'>{info()?.agent || ''}</span>
                    <Show when={info()?.title}>
                        <span class='AcpTerminalPage__card'>{info()?.title}</span>
                    </Show>
                </div>
                <div class='AcpTerminalPage__meta'>
                    <Show when={info()?.branch}>
                        <code>{info()?.branch}</code>
                    </Show>
                    <Show when={info()?.cwd}>
                        <code class='AcpTerminalPage__cwd'>{info()?.cwd}</code>
                    </Show>
                    <span class={`AcpTerminalPage__status AcpTerminalPage__status--${status()}`}>{statusText()}</span>
                </div>
                <Show when={info()?.task}>
                    <Button
                        onClick={pasteTask}
                        title={info()?.task}
                    >
                        {intl.formatMessage({id: 'acp.terminal.pasteTask', defaultMessage: 'Paste the task'})}
                    </Button>
                </Show>
            </div>
            <Show when={error()}>
                <div class='AcpTerminalPage__error'>{error()}</div>
            </Show>
            <div
                class='AcpTerminalPage__screen'
                ref={host}
            />
            <Show when={props.softKeys}>
                <div class='AcpTerminalPage__keys'>
                    <For each={softKeys}>
                        {(key) => (
                            <button
                                type='button'
                                class='AcpTerminalPage__key'

                                // Keeping focus in the terminal is the whole
                                // point: a button that steals it closes the
                                // phone's keyboard on every tap.
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => writeToPty(key.data)}
                            >
                                {key.label}
                            </button>
                        )}
                    </For>
                </div>
            </Show>
        </div>
    )
}

export default TerminalPage
