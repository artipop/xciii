// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, screen} from '@solidjs/testing-library'
import '@testing-library/jest-dom'

import {mockAppStore, wrapIntl, wrapStore} from './testUtils'
import FocalboardRouter from './router'

// The board's own routes end in a catch-all — /:boardId?/:viewId?/:cardId? —
// which is exactly the shape a path like /m falls into. If the ranking ever
// changed, a phone would silently get an empty board instead of the page
// written for it, and nothing else in the suite would notice.

vi.mock('./pages/boardPage/boardPage', () => ({default: () => <div>{'the board'}</div>}))
vi.mock('./pages/mobile/mobilePage', () => ({default: () => <div>{'the phone page'}</div>}))
vi.mock('./components/acp/terminalPage', () => ({default: () => <div>{'the terminal'}</div>}))

const renderAt = (path: string) => {
    window.history.pushState({}, '', path)
    const store = mockAppStore({users: {me: {id: 'user-1', username: 'u'} as any}})
    return render(() => wrapStore(store, () => wrapIntl(() => <FocalboardRouter/>)))
}

describe('router', () => {
    afterEach(() => window.history.pushState({}, '', '/'))

    it('gives /m the page written for a phone, not the board', async () => {
        renderAt('/m')

        expect(await screen.findByText('the phone page')).toBeInTheDocument()
    })

    it('gives /m/terminal/:id the terminal', async () => {
        renderAt('/m/terminal/term-1')

        expect(await screen.findByText('the terminal')).toBeInTheDocument()
    })

    it('still gives a board id the board', async () => {
        renderAt('/79dfb64e-9a41-4d69-9e0e-27dfd4f5f9d3')

        expect(await screen.findByText('the board')).toBeInTheDocument()
    })
})
