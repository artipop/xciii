// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {TestRouter, wrapIntl} from '../../testUtils'

import MobilePage from './mobilePage'

const anyWindow = window as any

// The agent event socket, kept where a test can make an agent stop and wait.
// vi.mock is hoisted above the imports, so what it captures has to be too.
const {handlers} = vi.hoisted(() => ({handlers: {} as Record<string, (payload?: any) => void>}))

vi.mock('../../components/acp/agentEvents', () => ({
    onAgentEvent: (event: string, handler: (payload?: any) => void) => {
        handlers[event] = handler
        return () => delete handlers[event]
    },
}))

const askedOnCard = {
    key: 'q:q-1',
    cardId: 'card-2',
    title: 'Выкатить релиз',
    agent: 'clauuus',
    reason: 'question',
    questionId: 'q-1',
    text: 'Разрешить Bash: git push?',
    options: [{id: 'allow', label: 'Разрешить'}],
    freeText: false,
    awaiting: true,
    since: '2026-08-06T11:00:00Z',
}

const quietOnCard = {
    key: 'term-1',
    terminalId: 'term-1',
    cardId: 'card-1',
    title: 'Починить логин',
    agent: 'clauuus',
    reason: 'quiet',
    awaiting: true,
    since: '2026-08-06T10:00:00Z',
}

const letter = {
    id: 'card-9',
    boardId: 'board-home',
    title: 'Доставка приедет завтра',
    column: 'Входящие',
    author: 'почта',
    properties: {Ссылка: 'https://example.com/1'},
}

const work = {
    id: 'board-work',
    title: 'Разработка',
    property: 'Статус',
    columns: [{value: 'Входящие', color: 'propColorGray'}, {value: 'В работе', color: 'propColorYellow'}],
}

function bindings(waiting: any[] = [], terminals: any[] = [], inbox: any[] = []) {
    return {
        ListAttention: vi.fn().mockResolvedValue(JSON.stringify(waiting)),
        ListTerminals: vi.fn().mockResolvedValue(JSON.stringify(terminals)),
        AnswerQuestion: vi.fn().mockResolvedValue(undefined),
        ShowTerminal: vi.fn().mockResolvedValue(JSON.stringify({id: 'term-1', windowed: false})),
        ListInbox: vi.fn().mockResolvedValue(JSON.stringify(inbox)),
        ListBoards: vi.fn().mockResolvedValue(JSON.stringify([{id: 'board-home', title: 'Домашние дела'}, work])),
        ListBoardCards: vi.fn().mockResolvedValue(JSON.stringify([
            {id: 'card-3', boardId: 'board-home', title: 'Полить цветы', column: 'К выполнению'},
        ])),
        MoveCardToBoard: vi.fn().mockResolvedValue(undefined),
    }
}

const renderPage = () => render(() => wrapIntl(() => (
    <TestRouter path='/m'>
        <MobilePage/>
    </TestRouter>
)))

// The bar at the bottom is how the four screens are reached; a tab is a button
// and its name carries the count, so it is matched loosely.
const openTab = (name: RegExp) => userEvent.click(screen.getByRole('button', {name}))

describe('pages/mobile/mobilePage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        Object.keys(handlers).forEach((event) => delete handlers[event])
    })

    afterEach(() => {
        delete anyWindow.go
    })

    // A phone is where you find out nothing needs you, most of the time — and
    // that is the screen it opens on, because it is the only one of the four
    // that cannot wait.
    it('opens on what is waiting and says so when nothing is', async () => {
        anyWindow.go = {main: {App: bindings()}}

        renderPage()

        expect(await screen.findByText('Nothing is waiting. The agents are working.')).toBeInTheDocument()

        await openTab(/Terminals/)
        expect(screen.getByText('No terminal is running.')).toBeInTheDocument()
    })

    // The point of carrying the question to the phone is answering it there:
    // the agent's turn is open, and it carries on the moment the answer lands.
    it('answers a question where it is read', async () => {
        const app = bindings([askedOnCard])
        anyWindow.go = {main: {App: app}}

        renderPage()

        expect(await screen.findByText('Выкатить релиз')).toBeInTheDocument()
        expect(screen.getByText('Разрешить Bash: git push?')).toBeInTheDocument()

        await userEvent.click(screen.getByText('Разрешить'))

        await waitFor(() => expect(app.AnswerQuestion).toHaveBeenCalledWith('q-1', 'allow', ''))
    })

    // A silent CLI is answered by typing in it, so the phone goes to the
    // terminal — by address, without asking Go to open a window on a desktop
    // nobody is sitting at.
    it('opens a waiting terminal in the page rather than a window', async () => {
        const app = bindings([quietOnCard])
        anyWindow.go = {main: {App: app}}

        renderPage()

        await userEvent.click(await screen.findByText('Open the terminal'))

        expect(app.ShowTerminal).not.toHaveBeenCalled()
    })

    // What is running changes while the phone is in a pocket, and the socket is
    // what says so.
    it('relists the terminals when one opens or closes', async () => {
        const app = bindings([], [])
        anyWindow.go = {main: {App: app}}

        renderPage()

        await waitFor(() => expect(handlers['acp:terminal']).toBeDefined())
        app.ListTerminals.mockResolvedValue(JSON.stringify([
            {id: 'term-9', agent: 'clauuus', title: 'Починить логин', branch: 'card/login', running: true},
        ]))
        handlers['acp:terminal']()

        await openTab(/Terminals/)
        expect(await screen.findByText('Починить логин')).toBeInTheDocument()
        expect(screen.getByText('card/login')).toBeInTheDocument()
    })

    // The count on a tab has to be right before anybody opens it: a tab that
    // only counts once you are looking at it counts nothing.
    it('counts the inbox on its tab without the tab being open', async () => {
        anyWindow.go = {main: {App: bindings([], [], [letter])}}

        renderPage()

        // Re-queried each time: the bar is a <For>, so the button is a new
        // element once the count arrives.
        await waitFor(() => expect(screen.getByRole('button', {name: /Inbox/})).toHaveTextContent('1'))
        expect(screen.queryByText('Доставка приедет завтра')).not.toBeInTheDocument()
    })

    // What the inbox is for: a letter arrived, and the person says which board
    // it belongs on and where on it.
    it('moves a card from the inbox onto a board and into a column', async () => {
        const app = bindings([], [], [letter])
        anyWindow.go = {main: {App: app}}

        renderPage()

        await openTab(/Inbox/)
        expect(await screen.findByText('Доставка приедет завтра')).toBeInTheDocument()
        expect(screen.getByText('почта')).toBeInTheDocument()

        await userEvent.click(screen.getByText('Move to a board…'))
        await userEvent.click(await screen.findByText('Разработка'))
        await userEvent.click(await screen.findByText('В работе'))

        await waitFor(() => expect(app.MoveCardToBoard).toHaveBeenCalledWith('card-9', 'board-work', 'В работе'))
    })

    // The cards tab is one board at a time, and it opens on the first one so
    // there is something to read the moment it is reached.
    it('lists one board cards on the cards tab', async () => {
        const app = bindings()
        anyWindow.go = {main: {App: app}}

        renderPage()

        await openTab(/Cards/)

        expect(await screen.findByText('Полить цветы')).toBeInTheDocument()
        expect(screen.getByText('К выполнению')).toBeInTheDocument()
        await waitFor(() => expect(app.ListBoardCards).toHaveBeenCalledWith('board-home'))
    })
})
