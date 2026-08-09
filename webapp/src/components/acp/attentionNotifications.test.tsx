// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
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

// What ACP sends, and the only thing that raises a notification: the agent
// asked, its turn is still open, and the answer goes straight back to it.
const askedOnCard = {
    key: 'card:card-2',
    cardId: 'card-2',
    title: 'Выкатить релиз',
    agent: 'clauuus',
    reason: 'question',
    questionId: 'q-1',
    tool: 'Bash',
    text: 'Разрешить Bash: git push?',
    options: [
        {id: 'allow', label: 'Разрешить', kind: 'allow_once'},
        {id: 'no', label: 'Отклонить', kind: 'reject_once'},
    ],
    freeText: false,
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
        handlers['acp:attention'](askedOnCard)

        expect(await screen.findByText('clauuus is asking')).toBeInTheDocument()
        expect(screen.getByText('Выкатить релиз')).toBeInTheDocument()
    })

    // An answered question is not something to be told about any more, and
    // nobody clicked anything to make that true.
    it('takes the notification back when the wait ends', async () => {
        anyWindow.go = {main: {App: attentionBindings()}}

        render(() => wrapIntl(() => <AttentionNotifications/>))
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention'](askedOnCard)
        expect(await screen.findByRole('alert')).toBeInTheDocument()

        handlers['acp:attention']({...askedOnCard, awaiting: false})
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    })

    // The agent's own question, with its own words and its own options — the
    // turn is open while it is on screen.
    it('puts the agent question and its options to the person', async () => {
        anyWindow.go = {main: {App: attentionBindings()}}

        render(() => wrapIntl(() => <AttentionNotifications/>))
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention'](askedOnCard)

        expect(await screen.findByText('clauuus is asking')).toBeInTheDocument()
        expect(screen.getByText('Разрешить Bash: git push?')).toBeInTheDocument()
        expect(screen.getByText('Разрешить')).toBeInTheDocument()
        expect(screen.getByText('Отклонить')).toBeInTheDocument()
    })

    // Answering is the whole point: it goes back to the agent that is waiting,
    // and no terminal is opened to do it.
    it('answers the agent where the question was read', async () => {
        const bindings = attentionBindings()
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <AttentionNotifications/>))
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention'](askedOnCard)

        await userEvent.click(await screen.findByText('Разрешить'))
        await waitFor(() => expect(bindings.AnswerQuestion).toHaveBeenCalledWith('q-1', 'allow', ''))
        expect(bindings.ShowTerminal).not.toHaveBeenCalled()
        expect(bindings.OpenCardTerminal).not.toHaveBeenCalled()

        // The agent answered is no longer waiting, and the Go side says so.
        handlers['acp:attention']({...askedOnCard, awaiting: false})
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    })

    // An agent may want words rather than a choice — the claude CLI always
    // offers that beside its options.
    it('sends an answer typed in words', async () => {
        const bindings = attentionBindings()
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <AttentionNotifications/>))
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention']({...askedOnCard, freeText: true})

        await userEvent.type(await screen.findByPlaceholderText('Answer in your own words…'), 'через staging')
        await userEvent.click(screen.getByText('Send'))
        await waitFor(() => expect(bindings.AnswerQuestion).toHaveBeenCalledWith('q-1', '', 'через staging'))
    })

    // Waving one question away is not a standing refusal: the agent asking
    // again is the whole reason the notification exists.
    it('says it again when the same agent stops with a new question', async () => {
        anyWindow.go = {main: {App: attentionBindings()}}

        render(() => wrapIntl(() => <AttentionNotifications/>))
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention'](askedOnCard)

        await userEvent.click(await screen.findByLabelText('Dismiss'))
        expect(screen.queryByRole('alert')).toBeNull()

        handlers['acp:attention']({...askedOnCard, awaiting: false})
        handlers['acp:attention']({...askedOnCard, key: 'q:q-2', questionId: 'q-2', since: '2026-08-05T11:30:00Z'})

        expect(await screen.findByRole('alert')).toBeInTheDocument()
    })

    it('interrupts nobody who turned notifications off', async () => {
        anyWindow.go = {main: {App: attentionBindings([askedOnCard])}}
        setAgentNotifications(false)

        render(() => wrapIntl(() => <AttentionNotifications/>))
        await waitFor(() => expect(handlers['acp:attention']).toBeDefined())
        handlers['acp:attention'](askedOnCard)

        expect(screen.queryByRole('alert')).toBeNull()
        setAgentNotifications(true)
    })

    // A page opened after the agent stopped has no event to hear: the list is
    // what it starts from.
    it('starts from what is already waiting', async () => {
        anyWindow.go = {main: {App: attentionBindings([askedOnCard])}}

        render(() => wrapIntl(() => <AttentionNotifications/>))

        expect(await screen.findByText('Выкатить релиз')).toBeInTheDocument()
    })
})
