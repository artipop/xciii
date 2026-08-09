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

function bindings(waiting: any[] = [], terminals: any[] = []) {
    return {
        ListAttention: vi.fn().mockResolvedValue(JSON.stringify(waiting)),
        ListTerminals: vi.fn().mockResolvedValue(JSON.stringify(terminals)),
        AnswerQuestion: vi.fn().mockResolvedValue(undefined),
        ShowTerminal: vi.fn().mockResolvedValue(JSON.stringify({id: 'term-1', windowed: false})),
    }
}

const renderPage = () => render(() => wrapIntl(() => (
    <TestRouter path='/m'>
        <MobilePage/>
    </TestRouter>
)))

describe('pages/mobile/mobilePage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        Object.keys(handlers).forEach((event) => delete handlers[event])
    })

    afterEach(() => {
        delete anyWindow.go
    })

    // A phone is where you find out nothing needs you, most of the time.
    it('says so when nothing is waiting', async () => {
        anyWindow.go = {main: {App: bindings()}}

        renderPage()

        expect(await screen.findByText('Nothing is waiting. The agents are working.')).toBeInTheDocument()
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

    // The phone app puts one tab per machine around this page, and the number
    // on a tab is the only thing it can learn about the frame behind it: a
    // person has to see which desktop is asking without opening its tab.
    it('tells the app around it how many things are waiting', async () => {
        anyWindow.go = {main: {App: bindings([askedOnCard, {...askedOnCard, key: 'q:q-2', questionId: 'q-2', cardId: 'card-2'}])}}

        const parent = {postMessage: vi.fn()}
        const original = Object.getOwnPropertyDescriptor(window, 'parent')
        Object.defineProperty(window, 'parent', {value: parent, configurable: true})

        try {
            renderPage()

            await waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith({type: 'xciii:waiting', count: 2}, '*'))
        } finally {
            if (original) {
                Object.defineProperty(window, 'parent', original)
            }
        }
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

        expect(await screen.findByText('Починить логин')).toBeInTheDocument()
        expect(screen.getByText('card/login')).toBeInTheDocument()
    })
})
