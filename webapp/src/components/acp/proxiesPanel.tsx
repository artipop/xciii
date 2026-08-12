// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import Button from '../../widgets/buttons/button'

import {agentBindings} from './bindings'

import './proxiesPanel.scss'

// A named network configuration. Agents reference one by name (their proxyName
// field) instead of carrying their own settings, so one proxy serves several
// agents and is edited in a single place.
export type ProxyEntry = {
    name: string
    proxy?: string
    noProxy?: string
    caCert?: string
    username?: string
    password?: string
}

// displayProxy hides any credentials the URL itself carries, so the list never
// renders a password (the dedicated fields are masked in the form).
function displayProxy(proxy?: string): string {
    if (!proxy) {
        return '—'
    }
    return proxy.replace(/\/\/[^/@]*@/, '//…@')
}

export function isProxiesAvailable(): boolean {
    return Boolean(agentBindings()?.ListProxies)
}

const emptyForm: ProxyEntry = {name: ''}

const ProxiesPanel = () => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [proxies, setProxies] = createSignal<ProxyEntry[]>([])
    const [form, setForm] = createSignal<ProxyEntry | null>(null)
    const [editingName, setEditingName] = createSignal<string | null>(null)
    const [error, setError] = createSignal('')

    const refresh = async () => {
        if (!bindings?.ListProxies) {
            return
        }
        try {
            setProxies(JSON.parse(await bindings.ListProxies()) || [])
        } catch (e) {
            setError(String(e))
        }
    }

    onMount(() => {
        refresh()
    })

    const startAdd = () => {
        setForm({...emptyForm})
        setEditingName(null)
        setError('')
    }

    const startEdit = (entry: ProxyEntry) => {
        setForm({...entry})
        setEditingName(entry.name)
        setError('')
    }

    const saveForm = async () => {
        if (!bindings || !form()) {
            return
        }
        setError('')
        const entry: ProxyEntry = {...form()!, name: form()!.name.trim()}
        try {
            if (editingName()) {
                await bindings.UpdateProxy!(JSON.stringify(entry))
            } else {
                await bindings.AddProxy!(JSON.stringify(entry))
            }
            setForm(null)
            await refresh()
        } catch (e) {
            setError(String(e))
        }
    }

    // Removal is refused by the backend while agents still reference the entry,
    // so the error surfaces which agents to switch over first.
    const removeProxy = async (name: string) => {
        if (!bindings?.RemoveProxy) {
            return
        }
        setError('')
        try {
            await bindings.RemoveProxy(name)
            await refresh()
        } catch (e) {
            setError(String(e))
        }
    }

    const updateForm = (patch: Partial<ProxyEntry>) => setForm((f) => (f ? {...f, ...patch} : f))

    return (
        <div class='ProxiesPanel'>
            <div class='ProxiesPanel__content'>
                <div class='ProxiesPanel__subtitle'>
                    {intl.formatMessage({id: 'Proxies.subtitle', defaultMessage: 'Named network configurations an agent picks from its "Proxy configuration" field above, so several agents can share one.'})}
                </div>

                <Show when={proxies().length === 0 && !form()}>
                    <div class='ProxiesPanel__empty'>
                        {intl.formatMessage({id: 'Proxies.empty', defaultMessage: 'No proxy configurations yet.'})}
                    </div>
                </Show>

                <For each={proxies()}>
                    {(entry) => (
                        <div
                            class='ProxiesPanel__row'
                        >
                            <span class='ProxiesPanel__name'>{entry.name}</span>
                            <span class='ProxiesPanel__proxy'>{displayProxy(entry.proxy)}</span>
                            <Button onClick={() => startEdit(entry)}>
                                {intl.formatMessage({id: 'Proxies.edit', defaultMessage: 'Edit'})}
                            </Button>
                            <Button onClick={() => removeProxy(entry.name)}>
                                {intl.formatMessage({id: 'Proxies.remove', defaultMessage: 'Remove'})}
                            </Button>
                        </div>
                    )}
                </For>

                <Show when={form()}>
                    <div class='ProxiesPanel__form'>
                        <label>
                            {intl.formatMessage({id: 'Proxies.name', defaultMessage: 'Name'})}
                            <input
                                value={form()!.name}
                                disabled={Boolean(editingName())}
                                placeholder={intl.formatMessage({id: 'Proxies.name-placeholder', defaultMessage: 'Name (shown in the agent\'s proxy list)'})}
                                onInput={(e) => updateForm({name: e.currentTarget.value})}
                            />
                        </label>
                        <label>
                            {intl.formatMessage({id: 'Proxies.proxy', defaultMessage: 'Proxy URL — HTTP(S)_PROXY / ALL_PROXY'})}
                            <input
                                value={form()!.proxy || ''}
                                placeholder={'http://proxy.example.com:8080'}
                                onInput={(e) => updateForm({proxy: e.currentTarget.value})}
                            />
                        </label>
                        <label>
                            {intl.formatMessage({id: 'Proxies.username', defaultMessage: 'Username (optional)'})}
                            <input
                                value={form()!.username || ''}
                                autocomplete='off'
                                onInput={(e) => updateForm({username: e.currentTarget.value})}
                            />
                        </label>
                        <label>
                            {intl.formatMessage({id: 'Proxies.password', defaultMessage: 'Password (optional) — stored in the local config file'})}
                            <input
                                type='password'
                                value={form()!.password || ''}
                                autocomplete='new-password'
                                onInput={(e) => updateForm({password: e.currentTarget.value})}
                            />
                        </label>
                        <label>
                            {intl.formatMessage({id: 'Proxies.noProxy', defaultMessage: 'Bypass proxy for (comma-separated)'})}
                            <input
                                value={form()!.noProxy || ''}
                                placeholder={'localhost,127.0.0.1,.internal'}
                                onInput={(e) => updateForm({noProxy: e.currentTarget.value})}
                            />
                        </label>
                        <label>
                            {intl.formatMessage({id: 'Proxies.caCert', defaultMessage: 'CA bundle — PEM for a TLS-inspecting proxy'})}
                            <input
                                value={form()!.caCert || ''}
                                placeholder={'/etc/ssl/my-ca.pem'}
                                onInput={(e) => updateForm({caCert: e.currentTarget.value})}
                            />
                        </label>
                        <div class='ProxiesPanel__formActions'>
                            <Button
                                emphasis='primary'
                                onClick={saveForm}
                            >
                                {intl.formatMessage({id: 'Proxies.save', defaultMessage: 'Save'})}
                            </Button>
                            <Button onClick={() => setForm(null)}>
                                {intl.formatMessage({id: 'Proxies.cancel', defaultMessage: 'Cancel'})}
                            </Button>
                        </div>
                    </div>
                </Show>

                <Show when={!form()}>
                    <div class='ProxiesPanel__actions'>
                        <Button
                            emphasis='primary'
                            onClick={startAdd}
                        >
                            {intl.formatMessage({id: 'Proxies.add', defaultMessage: 'Add configuration…'})}
                        </Button>
                    </div>
                </Show>

                <Show when={error()}>
                    <div class='ProxiesPanel__error'>{error()}</div>
                </Show>
            </div>
        </div>
    )
}

export default ProxiesPanel
