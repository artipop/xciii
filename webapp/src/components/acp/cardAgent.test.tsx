// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'

import CardAgent, {isCardAgentAvailable} from './cardAgent'

const anyWindow = window as any

function cardBindings(state: any = {}) {
    return {
        GetCardAgent: vi.fn().mockResolvedValue(JSON.stringify(state)),
        OpenCardTerminal: vi.fn().mockResolvedValue(JSON.stringify({id: 'term-1', windowed: true})),
        StartCardDeploy: vi.fn().mockResolvedValue('deploy-1'),
        CancelSession: vi.fn().mockResolvedValue(true),
        ListAgentProjects: vi.fn().mockResolvedValue(JSON.stringify([{name: 'app'}])),
    }
}

describe('components/acp/cardAgent', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        delete anyWindow.go
        delete anyWindow.runtime
    })

    it('is inert without desktop bindings', () => {
        expect(isCardAgentAvailable()).toBe(false)
    })

    it('opens a terminal on the card', async () => {
        const bindings = cardBindings()
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <CardAgent cardId='card-1'/>))

        await userEvent.click(await screen.findByText('Open terminal'))
        await waitFor(() => expect(bindings.OpenCardTerminal).toHaveBeenCalledWith('card-1', '', ''))
    })

    // The card knows the difference between "there is one running", "there is
    // one to continue" and neither — it is the only place that says so.
    it('says whether a terminal is running or waiting to be continued', async () => {
        anyWindow.go = {main: {App: cardBindings({running: {id: 'term-1'}})}}
        const {unmount} = render(() => wrapIntl(() => <CardAgent cardId='card-1'/>))
        expect(await screen.findByText('Show terminal')).toBeInTheDocument()
        unmount()

        anyWindow.go = {main: {App: cardBindings({resume: {available: true, cwd: '/wt/card-1'}})}}
        render(() => wrapIntl(() => <CardAgent cardId='card-1'/>))
        expect(await screen.findByText('Resume in terminal')).toBeInTheDocument()
    })

    // The branch is what a card has to show: it is made in a worktree the card
    // never names itself, and it is what the deploy button publishes.
    it('shows the branch and deploys it', async () => {
        const bindings = cardBindings({session: {status: 'done', branch: 'acp/fix-login-3f2a'}})
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <CardAgent cardId='card-1'/>))

        expect(await screen.findByText('acp/fix-login-3f2a')).toBeInTheDocument()
        await userEvent.click(screen.getByText('Deploy'))
        await waitFor(() => expect(bindings.StartCardDeploy).toHaveBeenCalledWith('card-1', 'acp/fix-login-3f2a'))
    })

    it('can stop a session that is running', async () => {
        const bindings = cardBindings({session: {sessionId: 's1', status: 'running'}})
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <CardAgent cardId='card-1'/>))

        await userEvent.click(await screen.findByText('Cancel session'))
        await waitFor(() => expect(bindings.CancelSession).toHaveBeenCalledWith('card-1'))
    })

    // An agent that asked something is waiting on this card with its turn open,
    // so the card is one of the two places the answer can be given.
    it('puts the agent question on the card and answers it', async () => {
        const bindings = cardBindings()
        const answer = vi.fn().mockResolvedValue(undefined)
        const waiting = [{
            key: 'card:card-1',
            cardId: 'card-1',
            agent: 'clauuus',
            reason: 'question',
            questionId: 'q-9',
            text: 'Какую базу взять?',
            options: [
                {
                    id: 'postgres',
                    label: 'Postgres',
                },
            ],
            awaiting: true,
        }]
        anyWindow.go = {main: {App: {
            ...bindings,
            AnswerQuestion: answer,
            ListAttention: vi.fn().mockResolvedValue(JSON.stringify(waiting)),
        }}}

        render(() => wrapIntl(() => <CardAgent cardId='card-1'/>))

        expect(await screen.findByText('Какую базу взять?')).toBeInTheDocument()
        await userEvent.click(screen.getByText('Postgres'))
        await waitFor(() => expect(answer).toHaveBeenCalledWith('q-9', 'postgres', ''))
    })

    // A card that does not name a project cannot open a terminal until one
    // is chosen, and the refusal has to offer the choice rather than just fail.
    it('offers the projects when the card names none', async () => {
        const bindings = cardBindings()
        bindings.OpenCardTerminal = vi.fn().mockRejectedValue(new Error('карточка не указывает репозиторий'))
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <CardAgent cardId='card-1'/>))

        await userEvent.click(await screen.findByText('Open terminal'))
        expect(await screen.findByText(/не указывает репозиторий/)).toBeInTheDocument()
        expect(await screen.findByText('Choose a project…')).toBeInTheDocument()
    })
})
