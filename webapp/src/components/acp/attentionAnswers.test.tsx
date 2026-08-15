import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'

import AttentionAnswers from './attentionAnswers'
import {Attention} from './attention'

const anyWindow = window as any

// A permission the agent's own CLI asked for through its hook: it carries its
// own options, which is what makes it answerable anywhere.
const permission: Attention = {
    key: 'q:q-1',
    questionId: 'q-1',
    terminalId: 'term-1',
    cardId: 'card-2',
    title: 'Выкатить релиз',
    agent: 'clauuus',
    reason: 'question',
    text: 'Bash: rm -rf build',
    options: [
        {id: 'allow', label: 'Разрешить', kind: 'allow_once'},
        {id: 'deny', label: 'Запретить', kind: 'reject_once'},
    ],
    awaiting: true,
}

vi.mock('./agentEvents', () => ({onAgentEvent: () => () => undefined}))

describe('components/acp/attentionAnswers', () => {
    beforeEach(() => vi.clearAllMocks())
    afterEach(() => delete anyWindow.go)

    it('offers the answers the agent offered', async () => {
        anyWindow.go = {main: {App: {AnswerQuestion: vi.fn().mockResolvedValue(undefined)}}}

        render(() => wrapIntl(() => <AttentionAnswers target={permission}/>))

        expect(screen.getByText('Разрешить')).toBeInTheDocument()
        expect(screen.getByText('Запретить')).toBeInTheDocument()
    })

    // The whole point: the answer reaches the agent from the board, without
    // anybody opening the terminal it is waiting in.
    it('answers the agent from wherever the wait is shown', async () => {
        const AnswerQuestion = vi.fn().mockResolvedValue(undefined)
        anyWindow.go = {main: {App: {AnswerQuestion, AckAttention: vi.fn().mockResolvedValue(undefined)}}}

        render(() => wrapIntl(() => <AttentionAnswers target={permission}/>))
        await userEvent.click(screen.getByText('Разрешить'))

        await waitFor(() => expect(AnswerQuestion).toHaveBeenCalledWith('q-1', 'allow', ''))
    })

    // A refusal has to be as reachable as an allow, and readable as the heavier
    // of the two rather than as the default.
    it('marks refusing as the heavier answer', async () => {
        anyWindow.go = {main: {App: {AnswerQuestion: vi.fn().mockResolvedValue(undefined)}}}

        render(() => wrapIntl(() => <AttentionAnswers target={permission}/>))

        expect(screen.getByText('Запретить')).toHaveClass('AttentionAnswers__option--deny')
        expect(screen.getByText('Разрешить')).not.toHaveClass('AttentionAnswers__option--deny')
    })

    // A wait with nothing to choose from is every wait that did not come through
    // the hook — a stage that simply went quiet. Those are answered in the
    // terminal, and a row of buttons here would be a promise this cannot keep.
    it('draws nothing for a wait that carries no question', async () => {
        anyWindow.go = {main: {App: {}}}
        const silence: Attention = {key: 'term-1', terminalId: 'term-1', cardId: 'c', reason: 'terminal', awaiting: true}

        const {container} = render(() => wrapIntl(() => <AttentionAnswers target={silence}/>))

        expect(container.querySelector('.AttentionAnswers')).toBeNull()
    })

    // The agent stopped waiting — its own box was answered on the terminal's
    // screen, or it gave up. The button visibly did nothing, so it says so.
    it('says so when the agent is no longer waiting for this answer', async () => {
        anyWindow.go = {main: {App: {AnswerQuestion: vi.fn().mockRejectedValue(new Error('уже неактуален'))}}}

        render(() => wrapIntl(() => <AttentionAnswers target={permission}/>))
        await userEvent.click(screen.getByText('Разрешить'))

        expect(await screen.findByText('The agent is no longer waiting for this answer')).toBeInTheDocument()
    })
})
