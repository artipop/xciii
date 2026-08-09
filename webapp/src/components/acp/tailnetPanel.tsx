// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {Show, createSignal, onCleanup, onMount} from 'solid-js'

import {useIntl} from '../../intl'
import {IAppWindow} from '../../types'

import Button from '../../widgets/buttons/button'

import {agentBindings} from './bindings'

import './tailnetPanel.scss'

// The login URL points outside, and the webview cannot navigate there — the
// desktop app hands such links to the system browser.
declare let window: IAppWindow

// The switch that puts the board on your own tailnet, and — the point of the
// whole panel — the address to type into a phone.
//
// Everything here is one call each way: the state to show, and the two fields a
// person can change. Turning it on takes effect immediately (the Go side brings
// the node up), but not instantly: a first run waits for a login, so the state
// is polled while it settles rather than assumed from the click.

type TailnetState = {
    enabled: boolean
    hostname: string
    status: 'off' | 'joining' | 'login' | 'on' | 'error'
    url?: string
    loginUrl?: string
    error?: string
    path: string
}

export function isTailnetAvailable(): boolean {
    return Boolean(agentBindings()?.GetTailnetAccess)
}

const TailnetPanel = () => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [state, setState] = createSignal<TailnetState | null>(null)
    const [hostname, setHostname] = createSignal('')
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal('')

    const apply = (next: TailnetState, keepTyping = false) => {
        setState(next)
        if (!keepTyping) {
            setHostname(next.hostname || 'board')
        }
    }

    const refresh = async () => {
        if (!bindings?.GetTailnetAccess) {
            return
        }
        try {
            apply(JSON.parse(await bindings.GetTailnetAccess()), state() !== null)
        } catch (e: any) {
            setError(String(e?.message || e))
        }
    }

    onMount(() => {
        refresh()

        // Joining a tailnet is not a moment: the node registers, waits for a
        // login that may never come, then gets its certificate. Polling while
        // the panel is open is what turns that into something to watch.
        const timer = setInterval(() => {
            const status = state()?.status
            if (status === 'joining' || status === 'login') {
                refresh()
            }
        }, 1000)
        onCleanup(() => clearInterval(timer))
    })

    const save = async (enabled: boolean) => {
        if (!bindings?.SetTailnetAccess) {
            return
        }
        setBusy(true)
        setError('')
        try {
            apply(JSON.parse(await bindings.SetTailnetAccess(JSON.stringify({enabled, hostname: hostname()}))))
        } catch (e: any) {
            setError(String(e?.message || e))
        } finally {
            setBusy(false)
        }
    }

    const statusText = () => {
        switch (state()?.status) {
        case 'joining':
            return intl.formatMessage({id: 'Tailnet.joining', defaultMessage: 'Joining the tailnet…'})
        case 'login':
            return intl.formatMessage({id: 'Tailnet.login', defaultMessage: 'Waiting for you to log this machine in'})
        case 'on':
            return intl.formatMessage({id: 'Tailnet.on', defaultMessage: 'The board is on your tailnet'})
        case 'error':
            return state()?.error || ''
        default:
            return intl.formatMessage({id: 'Tailnet.off', defaultMessage: 'The board is on this machine only'})
        }
    }

    return (
        <div class='TailnetPanel'>
            <div class='TailnetPanel__subtitle'>
                {intl.formatMessage({id: 'Tailnet.subtitle', defaultMessage: 'The app joins your own Tailscale network and serves the board there — to your devices, and to nobody else. Nothing is published to the internet.'})}
            </div>
            <div class='TailnetPanel__content'>
                <div class={`TailnetPanel__status TailnetPanel__status--${state()?.status || 'off'}`}>
                    {statusText()}
                </div>

                <label class='TailnetPanel__field'>
                    <span>{intl.formatMessage({id: 'Tailnet.hostname', defaultMessage: 'Name of this machine in the network'})}</span>
                    <input
                        type='text'
                        value={hostname()}
                        disabled={busy() || state()?.status === 'on'}
                        onInput={(e) => setHostname(e.currentTarget.value)}
                    />
                </label>

                <Show when={state()?.status === 'on' && state()?.url}>
                    <div class='TailnetPanel__address'>
                        <span class='TailnetPanel__addressLabel'>
                            {intl.formatMessage({id: 'Tailnet.address', defaultMessage: 'Open this on your phone'})}
                        </span>
                        <code>{state()?.url}</code>
                        <Button onClick={() => navigator.clipboard?.writeText(state()?.url || '')}>
                            {intl.formatMessage({id: 'Tailnet.copy', defaultMessage: 'Copy'})}
                        </Button>
                    </div>
                    <p class='TailnetPanel__hint'>
                        {intl.formatMessage({id: 'Tailnet.hint-phone', defaultMessage: 'The phone needs the Tailscale app, signed in as you. The address works nowhere else.'})}
                    </p>
                </Show>

                <Show when={state()?.status === 'login' && state()?.loginUrl}>
                    <div class='TailnetPanel__address'>
                        <span class='TailnetPanel__addressLabel'>
                            {intl.formatMessage({id: 'Tailnet.login-link', defaultMessage: 'Log this machine in'})}
                        </span>
                        <code>{state()?.loginUrl}</code>
                        <Button onClick={() => window.openInNewBrowser?.(state()?.loginUrl || '')}>
                            {intl.formatMessage({id: 'Tailnet.login-open', defaultMessage: 'Open'})}
                        </Button>
                    </div>
                </Show>

                <Show when={state()?.status === 'error'}>
                    <p class='TailnetPanel__hint'>
                        {intl.formatMessage({id: 'Tailnet.hint-https', defaultMessage: 'If it says there is no certificate domain, turn on MagicDNS and HTTPS Certificates in the Tailscale admin console, then switch this on again.'})}
                    </p>
                </Show>

                <Show when={error()}>
                    <div class='TailnetPanel__error'>{error()}</div>
                </Show>

                <div class='TailnetPanel__actions'>
                    <Show
                        when={state()?.enabled}
                        fallback={
                            <Button
                                filled={true}
                                submit={true}
                                disabled={busy()}
                                onClick={() => save(true)}
                            >
                                {intl.formatMessage({id: 'Tailnet.turn-on', defaultMessage: 'Publish the board'})}
                            </Button>
                        }
                    >
                        <Button
                            disabled={busy()}
                            onClick={() => save(false)}
                        >
                            {intl.formatMessage({id: 'Tailnet.turn-off', defaultMessage: 'Stop publishing'})}
                        </Button>
                    </Show>
                </div>

                <p class='TailnetPanel__hint'>
                    {intl.formatMessage(
                        {id: 'Tailnet.hint-file', defaultMessage: 'An auth key, or letting somebody else in, is edited by hand in {path}.'},
                        {path: state()?.path || ''},
                    )}
                </p>
            </div>
        </div>
    )
}

export default TailnetPanel
