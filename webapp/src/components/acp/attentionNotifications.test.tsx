import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider, RootState} from '../../store'

import {setAgentNotifications} from './attention'
import AttentionNotifications from './attentionNotifications'

const anyWindow = window as any

// The stack reads the store now, to work out whose wait each one is
// (attentionAudience.ts). An install of one person is the default here, which
// is the case every test below is about: there is nobody else to address.
const open = (state: Partial<RootState> = {}) => render(() => wrapIntl(() => (
    <AppStoreProvider store={mockAppStore(state)}>
        <AttentionNotifications/>
    </AppStoreProvider>
)))

function attentionBindings(waiting: any[] = []) {
    return {
        ListAttention: vi.fn().mockResolvedValue(JSON.stringify(waiting)),
        ShowTerminal: vi.fn().mockResolvedValue(JSON.stringify({id: 'term-1', windowed: true})),
        OpenCardTerminal: vi.fn().mockResolvedValue(JSON.stringify({id: 'term-1', windowed: true})),
        AnswerQuestion: vi.fn().mockResolvedValue(undefined),
        AckAttention: vi.fn().mockResolvedValue(undefined),
    }
}

// A stage of a route whose CLI has stopped drawing: it is asking something
// inside its own interface, and the conversation it is asking in is named, which
// is what the notification leads to.
const waitingOnCard = {
    key: 'term-1',
    terminalId: 'term-1',
    cardId: 'card-2',
    title: 'Выкатить релиз',
    agent: 'clauuus',
    reason: 'terminal',
    text: 'агент ждёт ответа в терминале',
    awaiting: true,
    since: '2026-08-05T11:00:00Z',
}

// The agent event socket, kept where a test can make an agent stop and wait.
// vi.mock is hoisted above the imports, so what it captures has to be too.
const {handlers} = vi.hoisted(() => ({handlers: {} as Record<string, (payload?: any) => void>}))

vi.mock('./agentEvents', () => ({
    onAgentEvent: (event: string, handler: (payload?: any) => void) => {
        handlers[event] = handler
        return () => delete handlers[event]
    },
}))

describe('components/acp/attentionNotifications', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        Object.keys(handlers).forEach((event) => delete handlers[event])
        setAgentNotifications(true)
    })

    afterEach(() => {
        delete anyWindow.go
        delete anyWindow.runtime
    })

    it('says nothing until an agent is waiting', async () => {
        anyWindow.go = {main: {App: attentionBindings()}}

        open()

        expect(screen.queryByRole('alert')).toBeNull()
    })

    // The point of the whole thing: the question was asked in a window nobody
    // is looking at, so the notification is what carries it to the person.
    it('names the card and the agent that is waiting', async () => {
        anyWindow.go = {main: {App: attentionBindings()}}

        open()
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention'](waitingOnCard)

        expect(await screen.findByText('clauuus is asking')).toBeInTheDocument()
        expect(screen.getByText('Выкатить релиз')).toBeInTheDocument()
    })

    // An answered question is not something to be told about any more, and
    // nobody clicked anything to make that true.
    it('takes the notification back when the wait ends', async () => {
        anyWindow.go = {main: {App: attentionBindings()}}

        open()
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention'](waitingOnCard)
        expect(await screen.findByRole('alert')).toBeInTheDocument()

        handlers['acp:attention']({...waitingOnCard, awaiting: false})
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    })

    // What is being asked, in the agent's own words, and nothing to answer it
    // with: the agent is asking inside its own CLI, and a row of buttons of ours
    // beside a copy of the question was a second interface for one exchange.
    it('says what is being asked and offers the terminal rather than an answer', async () => {
        anyWindow.go = {main: {App: attentionBindings()}}

        open()
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention'](waitingOnCard)

        expect(await screen.findByText('clauuus is asking')).toBeInTheDocument()
        expect(screen.getByText('агент ждёт ответа в терминале')).toBeInTheDocument()
        expect(screen.getByText('Open the terminal')).toBeInTheDocument()
    })

    // The one thing there is to do: go to where the agent is asking. A wait that
    // names its conversation is shown by id — reopening "the card's terminal"
    // would start a second CLI beside the one that is waiting.
    it('opens the terminal the agent is waiting in', async () => {
        const bindings = attentionBindings()
        anyWindow.go = {main: {App: bindings}}

        open()
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention'](waitingOnCard)

        await userEvent.click(await screen.findByText('Open the terminal'))
        await waitFor(() => expect(bindings.ShowTerminal).toHaveBeenCalledWith('term-1'))
        expect(bindings.OpenCardTerminal).not.toHaveBeenCalled()

        // Somebody who is now looking at the agent has been told.
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    })

    // Waving one question away is not a standing refusal: the agent asking
    // again is the whole reason the notification exists.
    it('says it again when the same agent stops with a new question', async () => {
        anyWindow.go = {main: {App: attentionBindings()}}

        open()
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention'](waitingOnCard)

        await userEvent.click(await screen.findByLabelText('Dismiss'))
        expect(screen.queryByRole('alert')).toBeNull()

        handlers['acp:attention']({...waitingOnCard, awaiting: false})
        handlers['acp:attention']({...waitingOnCard, key: 'term-2', terminalId: 'term-2', since: '2026-08-05T11:30:00Z'})

        expect(await screen.findByRole('alert')).toBeInTheDocument()
    })

    // Waving it away is told to the app, not remembered here: the same wait is
    // drawn in the board's window, in a second window and on the phone, and a
    // person who has dealt with it means all of them.
    it('tells the app the wait has been seen', async () => {
        const bindings = attentionBindings()
        anyWindow.go = {main: {App: bindings}}

        open()
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention'](waitingOnCard)

        await userEvent.click(await screen.findByLabelText('Dismiss'))
        await waitFor(() => expect(bindings.AckAttention).toHaveBeenCalledWith('term-1'))
    })

    // The spam this whole arrangement is for. A stage's wait is the CLI drawing
    // nothing, and opening the terminal to look at it makes the CLI redraw — so
    // the wait ends and is raised again a minute later, about the very thing the
    // person has just been looking at. It is the same wait, and they have been
    // told.
    it('stays quiet when the same wait is raised again', async () => {
        anyWindow.go = {main: {App: attentionBindings()}}

        open()
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention'](waitingOnCard)

        await userEvent.click(await screen.findByText('Open the terminal'))
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())

        // The CLI redrew, so the silence broke and came back: a new timestamp
        // for a wait nothing has happened to.
        handlers['acp:attention']({...waitingOnCard, awaiting: false})
        handlers['acp:attention']({...waitingOnCard, since: '2026-08-05T11:01:00Z', acked: true})

        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    })

    // The other half of it: an agent that came back to life, did something and
    // stopped again is asking a new question, and the app says so by sending the
    // wait without the acknowledgement.
    it('says it again when the terminal comes back to life', async () => {
        anyWindow.go = {main: {App: attentionBindings()}}

        open()
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention'](waitingOnCard)

        await userEvent.click(await screen.findByLabelText('Dismiss'))
        expect(screen.queryByRole('alert')).toBeNull()

        handlers['acp:attention']({...waitingOnCard, awaiting: false})
        handlers['acp:attention']({...waitingOnCard, since: '2026-08-05T11:40:00Z'})

        expect(await screen.findByRole('alert')).toBeInTheDocument()
    })

    // A page that opens after somebody else has dealt with the wait must not
    // start by announcing it: the list carries the acknowledgement too.
    it('starts quiet about a wait somebody has already seen', async () => {
        anyWindow.go = {main: {App: attentionBindings([{...waitingOnCard, acked: true}])}}

        open()
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())

        expect(screen.queryByRole('alert')).toBeNull()
    })

    it('interrupts nobody who turned notifications off', async () => {
        anyWindow.go = {main: {App: attentionBindings([waitingOnCard])}}
        setAgentNotifications(false)

        open()
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention'](waitingOnCard)

        expect(screen.queryByRole('alert')).toBeNull()
        setAgentNotifications(true)
    })

    // Two agents waiting is two notifications and a line saying so — what it
    // must never look like is one notification arriving twice.
    it('counts the waits and draws each of them once', async () => {
        anyWindow.go = {main: {App: attentionBindings()}}

        open()
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention'](waitingOnCard)
        handlers['acp:attention']({...waitingOnCard, key: 'term-2', terminalId: 'term-2', cardId: 'card-3', title: 'Починить логин'})

        expect(await screen.findByText('2 agents are waiting')).toBeInTheDocument()
        expect(screen.getAllByRole('alert').length).toBe(2)

        // The same wait told again — a reconnect asks for the whole list — is
        // the same wait, not a second agent.
        handlers['acp:attention'](waitingOnCard)
        await waitFor(() => expect(screen.getAllByRole('alert').length).toBe(2))
    })

    // A terminal window is the app too, so it drew the whole stack as well:
    // three windows open meant one wait announced three times, and the copy in
    // the terminal's own window covered the question it was announcing.
    // In a team the same box would tell everybody about every agent, including
    // the ones working somebody else's card. What decides is the card's own
    // «Кто занимается» (attentionAudience.ts, docs/teamwork.md).
    it('says nothing to a teammate about a card assigned to somebody else', async () => {
        anyWindow.go = {main: {App: attentionBindings()}}

        open({
            clientConfig: {value: {teamMode: true}} as any,
            users: {me: {id: 'me'}} as any,
            boards: {boards: {'board-1': {id: 'board-1', cardProperties: [{id: 'who', name: 'Кто занимается', type: 'person', options: []}]}}} as any,
            cards: {cards: {'card-2': {id: 'card-2', fields: {properties: {who: 'somebody-else'}}}}} as any,
        })
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention']({...waitingOnCard, boardId: 'board-1'})

        await waitFor(() => expect(screen.queryByText(/clauuus/)).toBeNull())
    })

    it('tells the teammate the card is assigned to', async () => {
        anyWindow.go = {main: {App: attentionBindings()}}

        open({
            clientConfig: {value: {teamMode: true}} as any,
            users: {me: {id: 'me'}} as any,
            boards: {boards: {'board-1': {id: 'board-1', cardProperties: [{id: 'who', name: 'Кто занимается', type: 'person', options: []}]}}} as any,
            cards: {cards: {'card-2': {id: 'card-2', fields: {properties: {who: 'me'}}}}} as any,
        })
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention']({...waitingOnCard, boardId: 'board-1'})

        expect(await screen.findByText(/clauuus/)).toBeInTheDocument()
    })

    it('says nothing in a window that is drawing a terminal', async () => {
        anyWindow.go = {main: {App: attentionBindings([waitingOnCard])}}
        const where = window.location.pathname
        window.history.replaceState({}, '', '/acp/terminal/term-1')

        open()
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention'](waitingOnCard)

        expect(screen.queryByRole('alert')).toBeNull()
        window.history.replaceState({}, '', where)
    })

    // A page opened after the agent stopped has no event to hear: the list is
    // what it starts from.
    it('starts from what is already waiting', async () => {
        anyWindow.go = {main: {App: attentionBindings([waitingOnCard])}}

        open()

        expect(await screen.findByText('Выкатить релиз')).toBeInTheDocument()
    })
})
