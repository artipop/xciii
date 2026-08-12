// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {Show, createSignal, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {Board} from '../../blocks/board'
import Button from '../../widgets/buttons/button'
import Select from '../../widgets/select'

import {agentBindings} from './bindings'
import {AGENT_KINDS, AdapterStatus} from './agentsPanel'
import {syncAgentsToBoard} from './agentSync'

import './agentQuickAdd.scss'

// Registering an agent takes two answers — what to call it and which one it is.
// Everything else the full form asks (model, environment, MCP servers, proxy,
// CLI arguments) has a working default, which is why this can stand where the
// choice is being made rather than sending somebody to the settings and back.
//
// The same two questions the setup wizard asks, and now the same component: a
// second form drifting from the first is how a kind ends up offered in one
// place and not the other.

type Props = {

    // The board the new agent has to be usable on: an account and an option of
    // its "Agent" field. Absent where there is no board — the wizard passes one,
    // a card passes its own.
    board?: Board

    // Called with the new agent's name once it is registered.
    onAdded: (name: string) => void
    onCancel?: () => void
}

const AgentQuickAdd = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [name, setName] = createSignal('claude')
    const [kind, setKind] = createSignal('claude')
    const [adapters, setAdapters] = createSignal<AdapterStatus[]>([])
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal('')

    // Whether the chosen kind can start at all is knowable here, and the
    // alternative is finding out on a card an hour later.
    const adapter = () => adapters().find((a) => a.kind === kind())

    onMount(async () => {
        if (!bindings?.ListAgentAdapters) {
            return
        }
        try {
            setAdapters(JSON.parse(await bindings.ListAgentAdapters()) || [])
        } catch {
            // An adapter list we could not read is a warning we cannot show,
            // not a reason to refuse the form.
        }
    })

    const installAdapter = async () => {
        if (!bindings?.InstallAgentAdapter) {
            return
        }
        setBusy(true)
        setError('')
        try {
            await bindings.InstallAgentAdapter(kind())
            setAdapters(JSON.parse(await bindings.ListAgentAdapters!()) || [])
        } catch (e: any) {
            setError(String(e?.message || e))
        } finally {
            setBusy(false)
        }
    }

    const add = async () => {
        if (!bindings?.AddAgent || !name().trim()) {
            return
        }
        setBusy(true)
        setError('')
        try {
            await bindings.AddAgent(JSON.stringify({name: name().trim(), kind: kind()}))
            if (props.board) {
                await syncAgentsToBoard(props.board)
            }
            props.onAdded(name().trim())
        } catch (e: any) {
            setError(String(e?.message || e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div class='AgentQuickAdd'>
            <label class='AgentQuickAdd__field'>
                {intl.formatMessage({id: 'AgentQuickAdd.name', defaultMessage: 'Name'})}
                <input
                    value={name()}
                    onInput={(e) => setName(e.currentTarget.value)}
                />
            </label>
            <label class='AgentQuickAdd__field'>
                {intl.formatMessage({id: 'AgentQuickAdd.kind', defaultMessage: 'Kind'})}
                <Select
                    value={kind()}
                    options={AGENT_KINDS}
                    onChange={setKind}
                    label={intl.formatMessage({id: 'AgentQuickAdd.kind', defaultMessage: 'Kind'})}
                />
            </label>

            <Show when={adapter() && !adapter()!.ready}>
                <div class='AgentQuickAdd__warning'>
                    <span>{adapter()!.detail}</span>
                    <Show when={adapter()!.package}>
                        <Button
                            onClick={installAdapter}
                            disabled={busy()}
                        >
                            {intl.formatMessage({id: 'Agents.adapter-install', defaultMessage: 'Install adapter'})}
                        </Button>
                    </Show>
                </div>
            </Show>

            <div class='AgentQuickAdd__actions'>
                <Button
                    emphasis='primary'
                    onClick={add}
                    disabled={busy() || !name().trim()}
                >
                    {intl.formatMessage({id: 'AgentQuickAdd.add', defaultMessage: 'Add'})}
                </Button>
                <Show when={props.onCancel}>
                    <Button onClick={() => props.onCancel?.()}>
                        {intl.formatMessage({id: 'AgentQuickAdd.cancel', defaultMessage: 'Cancel'})}
                    </Button>
                </Show>
            </div>

            <div class='AgentQuickAdd__hint'>
                {intl.formatMessage({id: 'AgentQuickAdd.hint', defaultMessage: 'Everything else about it — model, environment, MCP servers, proxy — is in Settings → Agents, and has a working default until you go there.'})}
            </div>

            <Show when={error()}>
                <div class='AgentQuickAdd__error'>{error()}</div>
            </Show>
        </div>
    )
}

export default AgentQuickAdd
