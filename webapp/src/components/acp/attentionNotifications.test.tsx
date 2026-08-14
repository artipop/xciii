import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'

import {setAgentNotifications} from './attention'
import AttentionNotifications from './attentionNotifications'

const anyWindow = window as any

function attentionBindings(waiting: any[] = []) {
    return {
        ListAttention: vi.fn().mockResolvedValue(JSON.stringify(waiting)),
        ShowTerminal: vi.fn().mockResolvedValue(JSON.stringify({id: 'term-1', windowed: true})),
        OpenCardTerminal: vi.fn().mockResolvedValue(JSON.stringify({id: 'term-1', windowed: true})),
        AnswerQuestion: vi.fn().mockResolvedValue(undefined),
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

        render(() => wrapIntl(() => <AttentionNotifications/>))

        expect(screen.queryByRole('alert')).toBeNull()
    })

    // The point of the whole thing: the question was asked in a window nobody
    // is looking at, so the notification is what carries it to the person.
    it('names the card and the agent that is waiting', async () => {
        anyWindow.go = {main: {App: attentionBindings()}}

        render(() => wrapIntl(() => <AttentionNotifications/>))
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention'](waitingOnCard)

        expect(await screen.findByText('clauuus is asking')).toBeInTheDocument()
        expect(screen.getByText('Выкатить релиз')).toBeInTheDocument()
    })

    // An answered question is not something to be told about any more, and
    // nobody clicked anything to make that true.
    it('takes the notification back when the wait ends', async () => {
        anyWindow.go = {main: {App: attentionBindings()}}

        render(() => wrapIntl(() => <AttentionNotifications/>))
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

        render(() => wrapIntl(() => <AttentionNotifications/>))
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

        render(() => wrapIntl(() => <AttentionNotifications/>))
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

        render(() => wrapIntl(() => <AttentionNotifications/>))
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention'](waitingOnCard)

        await userEvent.click(await screen.findByLabelText('Dismiss'))
        expect(screen.queryByRole('alert')).toBeNull()

        handlers['acp:attention']({...waitingOnCard, awaiting: false})
        handlers['acp:attention']({...waitingOnCard, key: 'term-2', terminalId: 'term-2', since: '2026-08-05T11:30:00Z'})

        expect(await screen.findByRole('alert')).toBeInTheDocument()
    })

    it('interrupts nobody who turned notifications off', async () => {
        anyWindow.go = {main: {App: attentionBindings([waitingOnCard])}}
        setAgentNotifications(false)

        render(() => wrapIntl(() => <AttentionNotifications/>))
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention'](waitingOnCard)

        expect(screen.queryByRole('alert')).toBeNull()
        setAgentNotifications(true)
    })

    // Two agents waiting is two notifications and a line saying so — what it
    // must never look like is one notification arriving twice.
    it('counts the waits and draws each of them once', async () => {
        anyWindow.go = {main: {App: attentionBindings()}}

        render(() => wrapIntl(() => <AttentionNotifications/>))
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
    it('says nothing in a window that is drawing a terminal', async () => {
        anyWindow.go = {main: {App: attentionBindings([waitingOnCard])}}
        const where = window.location.pathname
        window.history.replaceState({}, '', '/acp/terminal/term-1')

        render(() => wrapIntl(() => <AttentionNotifications/>))
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention'](waitingOnCard)

        expect(screen.queryByRole('alert')).toBeNull()
        window.history.replaceState({}, '', where)
    })

    // A page opened after the agent stopped has no event to hear: the list is
    // what it starts from.
    it('starts from what is already waiting', async () => {
        anyWindow.go = {main: {App: attentionBindings([waitingOnCard])}}

        render(() => wrapIntl(() => <AttentionNotifications/>))

        expect(await screen.findByText('Выкатить релиз')).toBeInTheDocument()
    })
})
