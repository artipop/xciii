// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {TestRouter, wrapIntl} from '../../testUtils'

import SharePage from './sharePage'

const anyWindow = window as any

const home = {id: 'board-home', title: 'Домашние дела', icon: '🏠'}
const work = {id: 'board-work', title: 'Разработка', icon: '💻'}

function bindings(result: object = {created: 1}) {
    return {
        ListBoards: vi.fn().mockResolvedValue(JSON.stringify([home, work])),
        ShareItem: vi.fn().mockResolvedValue(JSON.stringify(result)),
        CloseShareWindow: vi.fn().mockResolvedValue(undefined),
    }
}

const renderShare = (query = '?url=https%3A%2F%2Fexample.com%2Fa&title=%D0%A1%D1%82%D0%B0%D1%82%D1%8C%D1%8F') =>
    render(() => wrapIntl(() => (
        <TestRouter path={`/share${query}`}>
            <SharePage/>
        </TestRouter>
    )))

// The button is disabled until the boards are in, so every test that does not
// pick a board waits for the list first — as a person does.
const save = async () => {
    await screen.findByRole('button', {name: /Домашние дела/})
    await userEvent.click(screen.getByRole('button', {name: 'Save'}))
}

describe('pages/share/sharePage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        localStorage.clear()
    })

    afterEach(() => {
        delete anyWindow.go
    })

    // The whole dialog: what another app shared is already filled in, the
    // person names a board, and the link is filed there.
    it('files the shared link on the board that was picked', async () => {
        const app = bindings()
        anyWindow.go = {main: {App: app}}

        renderShare()

        expect(await screen.findByDisplayValue('Статья')).toBeInTheDocument()
        expect(screen.getByText('https://example.com/a')).toBeInTheDocument()

        await userEvent.click(await screen.findByRole('button', {name: /Разработка/}))
        await userEvent.click(screen.getByRole('button', {name: 'Save'}))

        await waitFor(() => expect(app.ShareItem).toHaveBeenCalledWith(
            'board-work', 'Статья', 'https://example.com/a', ''))
        expect(await screen.findByText('Filed in the inbox.')).toBeInTheDocument()
    })

    // A link already in the inbox is not a failure and must not read as one:
    // the card is there, which is what the person wanted.
    it('says the link is already there rather than showing an error', async () => {
        anyWindow.go = {main: {App: bindings({skipped: 1})}}

        renderShare()

        await save()

        expect(await screen.findByText('It is already in the inbox.')).toBeInTheDocument()
    })

    // Most links a person sends themselves go to the same board, and the dialog
    // exists to be dismissed in two seconds — one of which would otherwise go on
    // finding that board again.
    it('opens on the board used last time', async () => {
        localStorage.setItem('xciii.share.board', 'board-work')
        const app = bindings()
        anyWindow.go = {main: {App: app}}

        renderShare()

        await save()

        await waitFor(() => expect(app.ShareItem).toHaveBeenCalledWith(
            'board-work', expect.anything(), expect.anything(), expect.anything()))
    })

    // Nothing came with a title — a bare link, which is most of what gets
    // shared. The dialog still has to be answerable.
    it('works on a share that is a link and nothing else', async () => {
        const app = bindings()
        anyWindow.go = {main: {App: app}}

        renderShare('?url=https%3A%2F%2Fexample.com%2Fb')

        await save()

        await waitFor(() => expect(app.ShareItem).toHaveBeenCalledWith(
            'board-home', '', 'https://example.com/b', ''))
    })

    // The pipeline counts a refusal rather than throwing it, so a delivery of
    // one that failed would otherwise look exactly like success.
    it('shows a refusal that came back as a count', async () => {
        anyWindow.go = {main: {App: bindings({failed: 1})}}

        renderShare()

        await save()

        expect(await screen.findByText('Could not file it. Try again.')).toBeInTheDocument()
    })
})
