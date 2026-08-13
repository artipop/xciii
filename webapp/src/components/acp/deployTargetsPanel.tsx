// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import Button from '../../widgets/buttons/button'

import {agentBindings} from './bindings'

import './deployTargetsPanel.scss'

// One Dokku destination: a host, and nothing else that is not about reaching
// it. A card moved into the deploy column is published as <baseApp>-<branch
// slug>, served at that same name under the preview domain — the host itself,
// unless the two differ. baseApp is likewise left empty and derived from the
// project name, which is what lets one target serve every project
// pointed at it, and what makes everything a preview needs beyond that
// (environment, TLS, build time) a property of the project, not of a host.
export type DeployTarget = {
    name: string
    sshHost: string
    sshUser?: string
    sshPort?: number
    sshKey?: string
    baseApp?: string
    baseDomain?: string
}

export function isDeployTargetsAvailable(): boolean {
    return Boolean(agentBindings()?.ListDeployTargets)
}

const emptyForm: DeployTarget = {name: '', sshHost: ''}

// previewHost spells out what the fields add up to, since the hostname is
// composed rather than typed: one label — the project and the branch —
// under the preview domain, which is the Dokku host unless one is given.
function previewHost(t: DeployTarget): string {
    return `${t.baseApp || 'reponame'}-my-branch.${t.baseDomain || t.sshHost || 'dokku.example.com'}`
}

type Props = {

    // Said after the registry actually changed, for a host that keeps its own
    // copy of the list — the automation dialog offers the targets by name in a
    // column's deploy override.
    onChange?: () => void
}

const DeployTargetsPanel = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [targets, setTargets] = createSignal<DeployTarget[]>([])
    const [form, setForm] = createSignal<DeployTarget | null>(null)
    const [editingName, setEditingName] = createSignal<string | null>(null)
    const [error, setError] = createSignal('')

    const refresh = async () => {
        if (!bindings?.ListDeployTargets) {
            return
        }
        try {
            setTargets(JSON.parse(await bindings.ListDeployTargets()) || [])
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

    const startEdit = (entry: DeployTarget) => {
        setForm({...entry})
        setEditingName(entry.name)
        setError('')
    }

    const saveForm = async () => {
        if (!bindings || !form()) {
            return
        }
        setError('')
        const entry: DeployTarget = {...form()!, name: form()!.name.trim()}
        try {
            if (editingName()) {
                await bindings.UpdateDeployTarget!(JSON.stringify(entry))
            } else {
                await bindings.AddDeployTarget!(JSON.stringify(entry))
            }
            setForm(null)
            await refresh()
            props.onChange?.()
        } catch (e) {
            setError(String(e))
        }
    }

    // Removing a target only forgets where to deploy: apps already running on
    // the Dokku host stay up until someone destroys them.
    const removeTarget = async (name: string) => {
        if (!bindings?.RemoveDeployTarget) {
            return
        }
        setError('')
        try {
            await bindings.RemoveDeployTarget(name)
            await refresh()
            props.onChange?.()
        } catch (e) {
            setError(String(e))
        }
    }

    const updateForm = (patch: Partial<DeployTarget>) => setForm((f) => (f ? {...f, ...patch} : f))

    return (
        <div class='DeployTargetsPanel'>
            <div class='DeployTargetsPanel__subtitle'>
                {intl.formatMessage({id: 'DeployTargets.subtitle', defaultMessage: 'Dokku hosts a card\'s branch is published to when it moves into the "Деплой" column. One branch becomes one app of its own, at "project-branch.base-domain".'})}
            </div>
            <div class='DeployTargetsPanel__content'>
                <Show when={targets().length === 0 && !form()}>
                    <div class='DeployTargetsPanel__empty'>
                        {intl.formatMessage({id: 'DeployTargets.empty', defaultMessage: 'No deploy targets yet.'})}
                    </div>
                </Show>

                <For each={targets()}>
                    {(entry) => (
                        <div
                            class='DeployTargetsPanel__row'
                        >
                            <span class='DeployTargetsPanel__name'>{entry.name}</span>
                            <span class='DeployTargetsPanel__where'>{`${entry.sshUser || 'dokku'}@${entry.sshHost} → *.${entry.baseDomain || entry.sshHost}`}</span>
                            <Button onClick={() => startEdit(entry)}>
                                {intl.formatMessage({id: 'DeployTargets.edit', defaultMessage: 'Edit'})}
                            </Button>
                            <Button onClick={() => removeTarget(entry.name)}>
                                {intl.formatMessage({id: 'DeployTargets.remove', defaultMessage: 'Remove'})}
                            </Button>
                        </div>
                    )}
                </For>

                <Show when={form()}>
                    <div class='DeployTargetsPanel__form'>
                        <label>
                            {intl.formatMessage({id: 'DeployTargets.name', defaultMessage: 'Name'})}
                            <input
                                value={form()!.name}
                                disabled={Boolean(editingName())}
                                placeholder={intl.formatMessage({id: 'DeployTargets.name-placeholder', defaultMessage: 'Name (also matched against the card\'s options)'})}
                                onInput={(e) => updateForm({name: e.currentTarget.value})}
                            />
                        </label>
                        <label>
                            {intl.formatMessage({id: 'DeployTargets.sshHost', defaultMessage: 'Dokku host'})}
                            <input
                                value={form()!.sshHost}
                                placeholder={'dokku.example.com'}
                                onInput={(e) => updateForm({sshHost: e.currentTarget.value})}
                            />
                        </label>
                        <label>
                            {intl.formatMessage({id: 'DeployTargets.sshUser', defaultMessage: 'SSH user (default dokku)'})}
                            <input
                                value={form()!.sshUser || ''}
                                placeholder={'dokku'}
                                onInput={(e) => updateForm({sshUser: e.currentTarget.value})}
                            />
                        </label>
                        <label>
                            {intl.formatMessage({id: 'DeployTargets.sshPort', defaultMessage: 'SSH port (default 22)'})}
                            <input
                                type='number'
                                value={form()!.sshPort || ''}
                                onInput={(e) => updateForm({sshPort: e.currentTarget.value ? Number(e.currentTarget.value) : undefined})}
                            />
                        </label>
                        <label>
                            {intl.formatMessage({id: 'DeployTargets.sshKey', defaultMessage: 'SSH key (absolute path, optional)'})}
                            <input
                                value={form()!.sshKey || ''}
                                placeholder={'/Users/me/.ssh/id_ed25519'}
                                onInput={(e) => updateForm({sshKey: e.currentTarget.value})}
                            />
                        </label>
                        <label>
                            {intl.formatMessage({id: 'DeployTargets.baseDomain', defaultMessage: 'Preview domain (optional) — the Dokku host itself by default'})}
                            <input
                                value={form()!.baseDomain || ''}
                                placeholder={form()!.sshHost || intl.formatMessage({id: 'DeployTargets.baseDomain-placeholder', defaultMessage: 'same as the Dokku host'})}
                                onInput={(e) => updateForm({baseDomain: e.currentTarget.value})}
                            />
                        </label>
                        <label>
                            {intl.formatMessage({id: 'DeployTargets.baseApp', defaultMessage: 'App name (optional) — the project name by default'})}
                            <input
                                value={form()!.baseApp || ''}
                                placeholder={intl.formatMessage({id: 'DeployTargets.baseApp-placeholder', defaultMessage: 'project name'})}
                                onInput={(e) => updateForm({baseApp: e.currentTarget.value})}
                            />
                        </label>
                        <div class='DeployTargetsPanel__hint'>
                            {intl.formatMessage(
                                {id: 'DeployTargets.hostname', defaultMessage: 'A branch is served at {host}'},
                                {host: previewHost(form()!)},
                            )}
                        </div>
                        <div class='DeployTargetsPanel__formActions'>
                            <Button
                                emphasis='primary'
                                onClick={saveForm}
                            >
                                {intl.formatMessage({id: 'DeployTargets.save', defaultMessage: 'Save'})}
                            </Button>
                            <Button onClick={() => setForm(null)}>
                                {intl.formatMessage({id: 'DeployTargets.cancel', defaultMessage: 'Cancel'})}
                            </Button>
                        </div>
                    </div>
                </Show>

                <Show when={!form()}>
                    <div class='DeployTargetsPanel__actions'>
                        <Button
                            emphasis='primary'
                            onClick={startAdd}
                        >
                            {intl.formatMessage({id: 'DeployTargets.add', defaultMessage: 'Add target…'})}
                        </Button>
                    </div>
                </Show>

                <Show when={error()}>
                    <div class='DeployTargetsPanel__error'>{error()}</div>
                </Show>
            </div>
        </div>
    )
}

export default DeployTargetsPanel
