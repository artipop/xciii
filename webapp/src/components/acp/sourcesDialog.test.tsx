// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {Board, createBoard} from '../../blocks/board'
import {wrapIntl} from '../../testUtils'

import SourcesDialog, {ingestURL, isSourcesAvailable} from './sourcesDialog'

const anyWindow = window as any

const board: Board = {...createBoard(), id: 'board1'}

const renderDialog = () => render(() => wrapIntl(() => (
    <SourcesDialog
        board={board}
        onClose={() => undefined}
    />
)))

describe('components/acp/sourcesDialog', () => {
    beforeEach(() => vi.clearAllMocks())

    afterEach(() => {
        delete anyWindow.go
    })

    it('is inert without desktop bindings', () => {
        expect(isSourcesAvailable()).toBe(false)
    })

    // A source is named in the user's own words, and those are usually Russian:
    // what goes into the address has to survive being typed into curl.
    it('escapes the source name in the address it shows', () => {
        expect(ingestURL('http://127.0.0.1:9000', 'телефон')).
            toBe('http://127.0.0.1:9000/sources/ingest/%D1%82%D0%B5%D0%BB%D0%B5%D1%84%D0%BE%D0%BD')
    })

    it('shows the board its own sources, and where to feed them', async () => {
        anyWindow.go = {main: {App: {
            ListSources: vi.fn().mockResolvedValue(JSON.stringify([
                {name: 'phone', boardId: 'board1', enabled: true, noisy: true},
            ])),
        }}}

        renderDialog()

        expect(await screen.findByText('phone')).toBeInTheDocument()
        expect(screen.getByText(`${window.location.origin}/sources/ingest/phone`)).toBeInTheDocument()
    })

    // The token is kept as a hash, so the moment it is issued is the only
    // moment it can be read. A dialog that failed to show it would leave a
    // source nothing can ever send to.
    it('shows the token once, when the source is created', async () => {
        const AddSource = vi.fn().mockResolvedValue(JSON.stringify({
            name: 'phone', boardId: 'board1', enabled: true, token: 'secret-token',
        }))
        anyWindow.go = {main: {App: {
            ListSources: vi.fn().mockResolvedValue('[]'),
            AddSource,
            SourceEvents: vi.fn().mockResolvedValue('[]'),
        }}}

        renderDialog()
        await userEvent.type(await screen.findByPlaceholderText(/Name of the source/), 'phone')
        await userEvent.click(screen.getByText('Add'))

        expect(await screen.findByText('secret-token')).toBeInTheDocument()
        const sent = JSON.parse(AddSource.mock.calls[0][0])
        expect(sent.boardId).toBe('board1')
        expect(sent.noisy).toBe(true)
    })

    // "Why did nothing happen" is the only question a source is ever asked, and
    // an item that matched no rule is the commonest answer.
    it('says what became of what a source brought', async () => {
        anyWindow.go = {main: {App: {
            ListSources: vi.fn().mockResolvedValue(JSON.stringify([
                {name: 'phone', boardId: 'board1', enabled: true, noisy: false},
            ])),
            SourceEvents: vi.fn().mockResolvedValue(JSON.stringify([
                {id: 2, source: 'phone', outcome: 'inbox', externalId: 'n2'},
                {id: 1, source: 'phone', outcome: 'created', rule: 'доставка'},
            ])),
        }}}

        renderDialog()
        await userEvent.click(await screen.findByText('Log'))

        expect(await screen.findByText('no rule matched, filed in the inbox')).toBeInTheDocument()
        expect(screen.getByText('card created')).toBeInTheDocument()
    })

    it('reports what the desktop refused', async () => {
        anyWindow.go = {main: {App: {
            ListSources: vi.fn().mockResolvedValue('[]'),
            AddSource: vi.fn().mockRejectedValue(new Error('источник "phone" уже есть')),
        }}}

        renderDialog()
        await userEvent.type(await screen.findByPlaceholderText(/Name of the source/), 'phone')
        await userEvent.click(screen.getByText('Add'))

        await waitFor(() => expect(screen.getByText('источник "phone" уже есть')).toBeInTheDocument())
    })
})
