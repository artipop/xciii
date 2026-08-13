import {Show, createSignal} from 'solid-js'

import {useIntl} from '../../intl'

import Button from '../../widgets/buttons/button'
import Switch from '../../widgets/switch'

import {agentBindings} from '../acp/bindings'

import {UpdateState, useUpdateState} from './updates'

import './updatesPanel.scss'

// Replacing this app with a newer one, in the app's own words.
//
// The framework has a window of its own for this and it is not used: it is
// hard-coded English, and everything a person reads off this product is
// Russian. What the framework does keep is the part worth keeping — download,
// signature check, and the helper that swaps the bundle while the app is gone.
//
// Nothing here polls. The Go side sends the whole state on every change, so a
// check that started on a timer draws exactly the same as one this panel asked
// for, and a download that finished while the dialog was closed is already
// finished when it opens.

export {isUpdatesAvailable} from './updates'

const megabytes = (bytes?: number): string => {
    if (!bytes) {
        return ''
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const UpdatesPanel = () => {
    const intl = useIntl()
    const bindings = agentBindings()
    const state = useUpdateState()

    const [error, setError] = createSignal('')

    // Every action is fire-and-forget: what came of it arrives as the event.
    // Only a call that never reached the Go side is reported here.
    const run = async (action?: () => Promise<unknown>) => {
        if (!action) {
            return
        }
        setError('')
        try {
            await action()
        } catch (e: any) {
            setError(String(e?.message || e))
        }
    }

    const setEnabled = (enabled: boolean) => run(() =>
        bindings!.SetUpdateSettings!(JSON.stringify({enabled})))

    const busy = () => {
        const status = state().status
        return status === 'checking' || status === 'downloading' || status === 'verifying' || status === 'installing'
    }

    const headline = (s: UpdateState): string => {
        switch (s.status) {
        case 'checking':
            return intl.formatMessage({id: 'Updates.checking', defaultMessage: 'Looking for a newer version…'})
        case 'available':
            return intl.formatMessage(
                {id: 'Updates.available', defaultMessage: 'Version {version} is available'},
                {version: s.availableVersion || ''},
            )
        case 'downloading':
            return intl.formatMessage({id: 'Updates.downloading', defaultMessage: 'Downloading…'})
        case 'verifying':
            return intl.formatMessage({id: 'Updates.verifying', defaultMessage: 'Checking the signature…'})
        case 'installing':
            return intl.formatMessage({id: 'Updates.installing', defaultMessage: 'Installing…'})
        case 'ready':
            return intl.formatMessage(
                {id: 'Updates.ready', defaultMessage: 'Version {version} is ready. It is installed on restart.'},
                {version: s.availableVersion || ''},
            )
        case 'error':
            return intl.formatMessage({id: 'Updates.failed', defaultMessage: 'The update failed'})
        case 'up-to-date':
            return intl.formatMessage({id: 'Updates.up-to-date', defaultMessage: 'This is the latest version'})
        default:
            // Idle. What a previous run found is not carried over — only when
            // it looked — so an install that has checked before says nothing
            // here and lets the date below speak. Saying «ещё не проверяли»
            // directly above «последняя проверка: вчера» is the app
            // contradicting itself in two adjacent lines.
            return s.lastCheckedAt ? '' : intl.formatMessage({id: 'Updates.idle', defaultMessage: 'Not checked yet'})
        }
    }

    // What went wrong, said in a way somebody can act on. The framework's own
    // message ("dial tcp: lookup …: no such host") is kept, in small print,
    // below this — it is the half a bug report needs and the half nobody can
    // do anything with.
    const reason = (s: UpdateState): string => {
        switch (s.errorStage) {
        case 'check':
            return intl.formatMessage({id: 'Updates.error-check', defaultMessage: 'Could not reach the update server.'})
        case 'download':
            return intl.formatMessage({id: 'Updates.error-download', defaultMessage: 'Could not download the update.'})
        case 'verify':
            return intl.formatMessage({id: 'Updates.error-verify', defaultMessage: 'The downloaded update did not match its signature and was not installed.'})
        case 'install':
            return intl.formatMessage({id: 'Updates.error-install', defaultMessage: 'The update downloaded but could not be installed.'})
        default:
            return ''
        }
    }

    const checkedAt = (): string => {
        const at = state().lastCheckedAt
        if (!at) {
            return ''
        }
        return intl.formatMessage(
            {id: 'Updates.checked-at', defaultMessage: 'Last checked {when}'},
            {when: new Date(at).toLocaleString()},
        )
    }

    // 0–100 with no total is a bar that sits at zero for the whole download,
    // which reads as stuck. Without a size the bar is left out entirely.
    const percent = () => {
        const s = state()
        if (!s.sizeBytes || !s.downloaded) {
            return 0
        }
        return Math.min(100, Math.round((s.downloaded / s.sizeBytes) * 100))
    }

    return (
        <div class='UpdatesPanel'>
            <div class='UpdatesPanel__subtitle'>
                {intl.formatMessage({
                    id: 'Updates.subtitle',
                    defaultMessage: 'The app replaces itself with a newer version. Each release is signed, and the app installs only what it can check against the key it was built with.',
                })}
            </div>

            <div class='UpdatesPanel__content'>
                <div class='UpdatesPanel__version'>
                    {intl.formatMessage(
                        {id: 'Updates.current', defaultMessage: 'Installed version {version}'},
                        {version: state().currentVersion},
                    )}
                </div>

                <Show when={headline(state())}>
                    <div class={`UpdatesPanel__status UpdatesPanel__status--${state().status}`}>
                        {headline(state())}
                    </div>
                </Show>

                <Show when={state().status === 'downloading' && state().sizeBytes}>
                    <div class='UpdatesPanel__progress'>
                        <div
                            class='UpdatesPanel__progressBar'
                            style={{width: `${percent()}%`}}
                        />
                    </div>
                </Show>

                <Show when={state().status === 'available' && state().sizeBytes}>
                    <div class='UpdatesPanel__size'>{megabytes(state().sizeBytes)}</div>
                </Show>

                <Show when={state().notes && (state().status === 'available' || state().status === 'ready')}>
                    <div class='UpdatesPanel__notes'>{state().notes}</div>
                </Show>

                <Show when={reason(state())}>
                    <div class='UpdatesPanel__error'>{reason(state())}</div>
                </Show>
                <Show when={state().error || error()}>
                    <div class='UpdatesPanel__detail'>{state().error || error()}</div>
                </Show>

                <div class='UpdatesPanel__actions'>
                    <Show when={state().status === 'ready'}>
                        <Button
                            filled={true}
                            submit={true}
                            onClick={() => run(bindings?.RestartToUpdate)}
                        >
                            {intl.formatMessage({id: 'Updates.restart', defaultMessage: 'Restart and update'})}
                        </Button>
                    </Show>

                    <Show when={state().status === 'available'}>
                        <Button
                            filled={true}
                            submit={true}
                            onClick={() => run(bindings?.InstallUpdate)}
                        >
                            {intl.formatMessage({id: 'Updates.install', defaultMessage: 'Install'})}
                        </Button>
                        <Button onClick={() => run(bindings?.SkipUpdateVersion)}>
                            {intl.formatMessage({id: 'Updates.skip', defaultMessage: 'Skip this version'})}
                        </Button>
                    </Show>

                    <Show when={state().status !== 'ready'}>
                        <Button
                            disabled={busy()}
                            onClick={() => run(bindings?.CheckForUpdate)}
                        >
                            {intl.formatMessage({id: 'Updates.check', defaultMessage: 'Check for updates'})}
                        </Button>
                    </Show>
                </div>

                <Show when={checkedAt()}>
                    <div class='UpdatesPanel__checked'>{checkedAt()}</div>
                </Show>

                <div class='UpdatesPanel__setting'>
                    <div class='UpdatesPanel__fact'>
                        <span class='UpdatesPanel__factName'>
                            {intl.formatMessage({id: 'Updates.auto', defaultMessage: 'Check for updates automatically'})}
                        </span>
                        <span class='UpdatesPanel__factValue'>
                            {intl.formatMessage({
                                id: 'Updates.auto-hint',
                                defaultMessage: 'Every few hours. Nothing is downloaded until you ask for it.',
                            })}
                        </span>
                    </div>
                    <Switch
                        isOn={state().enabled}
                        onChanged={setEnabled}
                    />
                </div>

                <Show when={state().skippedVersion}>
                    <p class='UpdatesPanel__hint'>
                        {intl.formatMessage(
                            {id: 'Updates.skipped', defaultMessage: 'Version {version} is skipped and will not be offered again.'},
                            {version: state().skippedVersion || ''},
                        )}
                    </p>
                </Show>
            </div>
        </div>
    )
}

export default UpdatesPanel
