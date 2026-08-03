// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import React, {type JSX, useCallback, useEffect, useRef, useState} from 'react'
import {useIntl} from '../../intl'
import {useRouteMatch} from 'react-router-dom'

import Button from '../../widgets/buttons/button'

import {agentBindings} from './agentReposDialog'

import '@xterm/xterm/css/xterm.css'
import './terminalPage.scss'

// The page a terminal window shows: the agent's own CLI, drawn by xterm.js and
// wired to the pty over the WebSocket at /acp/terminal/<id>/ws. Everything else
// about the session — which repository, which worktree, which branch, what the
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

const TerminalPage = (): JSX.Element => {
    const intl = useIntl()
    const match = useRouteMatch<{terminalId: string}>()
    const terminalId = match.params.terminalId

    const host = useRef<HTMLDivElement>(null)
    const socket = useRef<WebSocket | null>(null)
    const [info, setInfo] = useState<TerminalInfo | null>(null)
    const [status, setStatus] = useState<'connecting' | 'live' | 'closed'>('connecting')
    const [error, setError] = useState('')
    const writeToPty = useRef<(data: string) => void>(() => undefined)

    // The task text is a button rather than something typed for you: a CLI is
    // not ready for input the moment it starts, and typing into a TUI that is
    // still painting loses the first characters.
    const pasteTask = useCallback(() => {
        if (info?.task) {
            writeToPty.current(info.task)
        }
    }, [info])

    useEffect(() => {
        const bindings = agentBindings()
        if (!bindings?.GetTerminalInfo) {
            setError(intl.formatMessage({id: 'acp.terminal.noBindings', defaultMessage: 'The terminal is only available in the desktop app.'}))
            return
        }
        bindings.GetTerminalInfo(terminalId).
            then((json: string) => setInfo(JSON.parse(json) as TerminalInfo)).
            catch((e: Error) => setError(String(e?.message || e)))
    }, [terminalId])

    useEffect(() => {
        let disposed = false
        let terminal: any = null
        let fit: any = null
        let observer: ResizeObserver | null = null

        const start = async () => {
            const [{Terminal}, {FitAddon}] = await Promise.all([
                import('@xterm/xterm'),
                import('@xterm/addon-fit'),
            ])
            if (disposed || !host.current) {
                return
            }

            terminal = new Terminal({
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                fontSize: 13,
                cursorBlink: true,
                convertEol: false,
                theme: {background: '#18181b', foreground: '#e4e4e7'},
            })
            fit = new FitAddon()
            terminal.loadAddon(fit)
            terminal.open(host.current)
            fit.fit()

            // Absolute, not relative: this page's own path is
            // /acp/terminal/<id>, so a relative address would resolve against
            // that directory and ask for /acp/terminal/acp/terminal/<id>/ws.
            const url = new URL(`/acp/terminal/${terminalId}/ws`, window.location.origin)
            url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
            const ws = new WebSocket(url.toString())
            ws.binaryType = 'arraybuffer'
            socket.current = ws

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
            writeToPty.current = (data: string) => {
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
            observer.observe(host.current)
            terminal.focus()
        }

        start().catch((e) => setError(String(e?.message || e)))

        return () => {
            disposed = true
            observer?.disconnect()
            socket.current?.close()
            socket.current = null
            terminal?.dispose()
        }
    }, [terminalId])

    const statusText = {
        connecting: intl.formatMessage({id: 'acp.terminal.connecting', defaultMessage: 'connecting…'}),
        live: intl.formatMessage({id: 'acp.terminal.live', defaultMessage: 'session running'}),
        closed: intl.formatMessage({id: 'acp.terminal.closed', defaultMessage: 'the CLI has exited — this window can be closed'}),
    }[status]

    return (
        <div class='AcpTerminalPage'>
            <div class='AcpTerminalPage__header'>
                <div class='AcpTerminalPage__title'>
                    <span class='AcpTerminalPage__agent'>{info?.agent || ''}</span>
                    {info?.title && <span class='AcpTerminalPage__card'>{info.title}</span>}
                </div>
                <div class='AcpTerminalPage__meta'>
                    {info?.branch && <code>{info.branch}</code>}
                    {info?.cwd && <code class='AcpTerminalPage__cwd'>{info.cwd}</code>}
                    <span class={`AcpTerminalPage__status AcpTerminalPage__status--${status}`}>{statusText}</span>
                </div>
                {info?.task && (
                    <Button
                        onClick={pasteTask}
                        title={info.task}
                    >
                        {intl.formatMessage({id: 'acp.terminal.pasteTask', defaultMessage: 'Paste the task'})}
                    </Button>
                )}
            </div>
            {error && <div class='AcpTerminalPage__error'>{error}</div>}
            <div
                class='AcpTerminalPage__screen'
                ref={host}
            />
        </div>
    )
}

export default TerminalPage
