// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {agentBindings} from '../../components/acp/agentProjectsDialog'

// What the share dialog needs from Go, beyond the board list it shares with the
// phone (bindings/boards.ts): the send, and the way to close the window it was
// opened in.

// ShareResult is a delivery as the pipeline reports it. The dialog reads two
// numbers of it: something was filed, or the link was already there — which is
// not a failure and must not be shown as one.
export type ShareResult = {
    created?: number
    commented?: number
    dropped?: number
    skipped?: number
    failed?: number
}

export async function shareItem(boardId: string, title: string, url: string, note: string): Promise<ShareResult> {
    const bindings = agentBindings()
    if (!bindings?.ShareItem) {
        throw new Error('отправка недоступна')
    }
    return JSON.parse(await bindings.ShareItem(boardId, title, url, note)) || {}
}

// closeShare shuts the little window the system's share sheet opened. It is a
// binding rather than window.close() because the window is the app's own and
// not one the page opened, and a page may not close what it did not open.
//
// In a browser there is no such window and nothing to close, which is why this
// is best-effort: the dialog has already said what happened by the time it is
// called.
export async function closeShare(): Promise<void> {
    const bindings = agentBindings()
    if (!bindings?.CloseShareWindow) {
        return
    }
    try {
        await bindings.CloseShareWindow()
    } catch {
        // Nothing to do about a window that would not close, and nothing worth
        // showing a person who has already been told the card was filed.
    }
}
