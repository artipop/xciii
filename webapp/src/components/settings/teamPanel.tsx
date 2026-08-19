// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {Show, createSignal, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import Button from '../../widgets/buttons/button'

import {agentBindings} from '../acp/bindings'

import './teamPanel.scss'

// The switch between one person and several (docs/teamwork.md).
//
// Turning it on is also the one moment the person at this machine is asked for
// a name and a password: everything they have already made — boards,
// memberships, who a card is assigned to — names the identity a single-user
// install works under, so the account is created under that same identity
// rather than beside it, and nothing has to be moved.
//
// Unlike the tailnet switch, this one does not take effect until the app is
// restarted: which mode the board server runs in is decided when it starts.
// That is what `enabled` and `running` disagreeing means, and saying it is most
// of what this panel does.

type TeamState = {
    enabled: boolean
    running: boolean
    owner: string
    invite: string
}

export function isTeamAvailable(): boolean {
    return Boolean(agentBindings()?.GetTeamAccess)
}

// inviteLink is the address the second person opens. Built here rather than by
// the Go side because the page is the only half that knows which door it was
// opened through — the loopback one, or the tailnet name a phone typed.
export function inviteLink(origin: string, invite: string): string {
    if (!invite) {
        return ''
    }
    return `${origin}/register?t=${encodeURIComponent(invite)}`
}

const TeamPanel = () => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [state, setState] = createSignal<TeamState | null>(null)
    const [username, setUsername] = createSignal('')
    const [password, setPassword] = createSignal('')
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal('')

    const refresh = async () => {
        if (!bindings?.GetTeamAccess) {
            return
        }
        try {
            setState(JSON.parse(await bindings.GetTeamAccess()))
        } catch (e: any) {
            setError(String(e?.message || e))
        }
    }

    onMount(refresh)

    const save = async (enabled: boolean) => {
        if (!bindings?.SetTeamAccess) {
            return
        }
        setBusy(true)
        setError('')
        try {
            setState(JSON.parse(await bindings.SetTeamAccess(JSON.stringify({
                enabled,
                username: username(),
                password: password(),
            }))))
            setPassword('')
        } catch (e: any) {
            setError(String(e?.message || e))
        } finally {
            setBusy(false)
        }
    }

    const regenerate = async () => {
        if (!bindings?.RegenerateTeamInvite) {
            return
        }
        setBusy(true)
        setError('')
        try {
            setState(JSON.parse(await bindings.RegenerateTeamInvite()))
        } catch (e: any) {
            setError(String(e?.message || e))
        } finally {
            setBusy(false)
        }
    }

    // The account is asked for once. Coming back to a mode that was on before
    // finds it already there, and changing a password is a different question
    // asked in a different place.
    const asksForAccount = () => !state()?.owner
    const restartOwed = () => Boolean(state()) && state()!.enabled !== state()!.running
    const link = () => inviteLink(window.location.origin, state()?.invite || '')

    // Three tones, and the only one that carries a colour is the one that wants
    // something from a person.
    const statusTone = () => {
        if (restartOwed()) {
            return 'restart'
        }
        return state()?.running ? 'on' : 'off'
    }

    const statusText = () => {
        const value = state()
        if (!value) {
            return ''
        }
        if (restartOwed() && value.enabled) {
            return intl.formatMessage({id: 'Team.restart-on', defaultMessage: 'Restart the app: after that everybody logs in'})
        }
        if (restartOwed()) {
            return intl.formatMessage({id: 'Team.restart-off', defaultMessage: 'Restart the app: after that the board is yours alone again'})
        }
        if (value.running) {
            return intl.formatMessage({id: 'Team.on', defaultMessage: 'Everybody logs in'})
        }
        return intl.formatMessage({id: 'Team.off', defaultMessage: 'The board belongs to one person and asks nobody to log in'})
    }

    return (
        <div class='TeamPanel'>
            <div class='TeamPanel__subtitle'>
                {intl.formatMessage({id: 'Team.subtitle', defaultMessage: 'A team means accounts: everybody who opens the board logs in, cards are assigned to people by name, and comments are addressed to somebody who reads them later.'})}
            </div>
            <div class='TeamPanel__content'>
                <div class={`TeamPanel__status TeamPanel__status--${statusTone()}`}>
                    {statusText()}
                </div>

                <Show when={state()?.owner}>
                    <div class='TeamPanel__owner'>
                        {intl.formatMessage(
                            {id: 'Team.owner', defaultMessage: 'This machine belongs to {name}'},
                            {name: state()?.owner},
                        )}
                    </div>
                </Show>

                <Show when={asksForAccount()}>
                    <label class='TeamPanel__field'>
                        <span>{intl.formatMessage({id: 'Team.username', defaultMessage: 'Your username'})}</span>
                        <input
                            type='text'
                            value={username()}
                            disabled={busy()}
                            onInput={(e) => setUsername(e.currentTarget.value)}
                        />
                    </label>
                    <label class='TeamPanel__field'>
                        <span>{intl.formatMessage({id: 'Team.password', defaultMessage: 'A password, at least six characters'})}</span>
                        <input
                            type='password'
                            value={password()}
                            disabled={busy()}
                            onInput={(e) => setPassword(e.currentTarget.value)}
                        />
                    </label>
                </Show>

                <Show when={state()?.running && link()}>
                    <div class='TeamPanel__address'>
                        <span class='TeamPanel__addressLabel'>
                            {intl.formatMessage({id: 'Team.invite', defaultMessage: 'Send this to whoever is joining'})}
                        </span>
                        <code>{link()}</code>
                        <Button onClick={() => navigator.clipboard?.writeText(link())}>
                            {intl.formatMessage({id: 'Team.copy', defaultMessage: 'Copy'})}
                        </Button>
                        <Button
                            disabled={busy()}
                            onClick={regenerate}
                        >
                            {intl.formatMessage({id: 'Team.regenerate', defaultMessage: 'New link'})}
                        </Button>
                    </div>
                    <p class='TeamPanel__hint'>
                        {intl.formatMessage({id: 'Team.hint-invite', defaultMessage: 'The link works until you ask for a new one. A new one stops the old.'})}
                    </p>
                </Show>

                <Show when={error()}>
                    <div class='TeamPanel__error'>{error()}</div>
                </Show>

                <div class='TeamPanel__actions'>
                    <Show
                        when={state()?.enabled}
                        fallback={
                            <Button
                                filled={true}
                                submit={true}
                                disabled={busy()}
                                onClick={() => save(true)}
                            >
                                {intl.formatMessage({id: 'Team.turn-on', defaultMessage: 'Work as a team'})}
                            </Button>
                        }
                    >
                        <Button
                            disabled={busy()}
                            onClick={() => save(false)}
                        >
                            {intl.formatMessage({id: 'Team.turn-off', defaultMessage: 'Back to one person'})}
                        </Button>
                    </Show>
                </div>

                <p class='TeamPanel__hint'>
                    {intl.formatMessage({id: 'Team.hint-network', defaultMessage: 'This says who may open the board, not from where. A second device still comes in through the tailnet.'})}
                </p>
            </div>
        </div>
    )
}

export default TeamPanel
