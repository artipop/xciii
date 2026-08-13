// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {Accessor, createSignal, onCleanup, onMount} from 'solid-js'

import {agentBindings} from '../acp/bindings'
import {onAgentEvent} from '../acp/agentEvents'

// Where the app is in replacing itself.
//
// One subscription for the whole page, like attention.ts: the settings panel
// draws all of it, and the settings button in the sidebar draws a dot off the
// same value, so asking twice would mean two answers that disagree while a
// download is running.
//
// The Go side sends the whole state on every change rather than eleven events
// mirroring the framework's own, so there is nothing here to reassemble and no
// way to see half a picture.

export type UpdateStatus =
    | 'unconfigured'
    | 'idle'
    | 'checking'
    | 'up-to-date'
    | 'available'
    | 'downloading'
    | 'verifying'
    | 'installing'
    | 'ready'
    | 'error'

export type UpdateState = {
    supported: boolean
    enabled: boolean
    currentVersion: string
    status: UpdateStatus
    availableVersion?: string
    releaseName?: string
    notes?: string
    sizeBytes?: number
    downloaded?: number
    skippedVersion?: string
    lastCheckedAt?: string

    // error is the framework's own English, verbatim; errorStage is the step it
    // failed at. The panel says the actionable half itself off the stage and
    // keeps the verbatim text underneath, because that text is what a bug
    // report needs and nothing on this side can reconstruct it.
    error?: string
    errorStage?: 'check' | 'download' | 'verify' | 'install'
    path?: string
}

const unknown: UpdateState = {supported: false, enabled: false, currentVersion: '', status: 'unconfigured'}

const [state, setState] = createSignal<UpdateState>(unknown)

let consumers = 0
let unsubscribe: (() => void) | undefined

async function reload(): Promise<void> {
    const bindings = agentBindings()
    if (!bindings?.GetUpdateState) {
        setState(unknown)
        return
    }
    try {
        setState(JSON.parse(await bindings.GetUpdateState()))
    } catch {
        // A build that cannot answer is a build that cannot update, which is
        // what the panel needs to know and the only thing it needs to know.
        setState(unknown)
    }
}

function subscribe(): () => void {
    consumers++
    if (consumers === 1) {
        // No payload means the socket reconnected and nobody knows what was
        // missed — a download that finished while it was down would otherwise
        // leave the panel showing a progress bar for ever.
        unsubscribe = onAgentEvent('acp:update', (payload?: UpdateState) => (payload ? setState(payload) : reload()))
        reload()
    }
    return () => {
        consumers--
        if (consumers === 0) {
            unsubscribe?.()
            unsubscribe = undefined
            setState(unknown)
        }
    }
}

// useUpdateState keeps a component current for as long as it lives.
export function useUpdateState(): Accessor<UpdateState> {
    onMount(() => onCleanup(subscribe()))
    return state
}

// isUpdatesAvailable answers whether this deployment can update itself at all.
// Feature-detected rather than assumed: the same bundle is served in a plain
// browser and as a Mattermost plugin, where there is no Go side to ask, and by
// the headless server build, which is not distributed as a release.
export function isUpdatesAvailable(): boolean {
    return Boolean(agentBindings()?.GetUpdateState)
}

// updateWaiting is what the sidebar's settings button draws a dot for: a
// version found and not yet installed, or one installed and waiting for a
// restart. Neither is urgent, and both are invisible until somebody opens a
// dialog they have no reason to open.
export function updateWaiting(s: UpdateState): boolean {
    return s.supported && (s.status === 'available' || s.status === 'ready')
}
