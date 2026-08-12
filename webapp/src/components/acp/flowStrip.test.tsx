import {render, screen, waitFor} from '@solidjs/testing-library'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'

import FlowStrip, {isFlowStripAvailable, waited} from './flowStrip'

const anyWindow = window as any

const cardFlow = {
    flow: 'Feature',
    currentNodeId: 'review',
    since: new Date(Date.now() - (90 * 60 * 1000)).toISOString(),
    branch: 'feat/x',
    waitingFor: ['ветка влита в основную'],
    stages: [
        {nodeId: 'agent', column: 'In Progress', action: 'agent', crew: ['dev-1'], current: false, done: true},
        {nodeId: 'review', column: 'In Review', action: 'none', current: true, done: false},
        {nodeId: 'deploy', column: 'Deploy', action: 'deploy', current: false, done: false},
    ],
}

function stubBindings(flow: unknown) {
    const bindings = {GetCardFlow: vi.fn().mockResolvedValue(JSON.stringify(flow))}
    anyWindow.go = {main: {App: bindings}}
    return bindings
}

describe('components/acp/flowStrip', () => {
    afterEach(() => {
        delete anyWindow.go
        vi.clearAllMocks()
    })

    test('is unavailable without desktop bindings', () => {
        expect(isFlowStripAvailable()).toBe(false)
    })

    test('a stage entry that was never stamped has no age', () => {
        expect(waited('0001-01-01T00:00:00Z', Date.now())).toBeNull()
    })

    test('waited reports the wait in the units a person would say it in', () => {
        const now = Date.parse('2026-07-31T12:00:00Z')
        expect(waited('2026-07-31T11:40:00Z', now)).toEqual({value: 20, unit: 'minutes'})
        expect(waited('2026-07-31T09:00:00Z', now)).toEqual({value: 3, unit: 'hours'})
        expect(waited('2026-07-28T12:00:00Z', now)).toEqual({value: 3, unit: 'days'})
        expect(waited(undefined, now)).toBeNull()
        expect(waited('nonsense', now)).toBeNull()
    })

    test('shows the route, the stage the card is on and what it waits for', async () => {
        stubBindings(cardFlow)
        render(() => wrapIntl(() => <FlowStrip cardId='card1'/>))

        await waitFor(() => expect(screen.getByText('Feature')).toBeInTheDocument())
        expect(screen.getByText('feat/x')).toBeInTheDocument()
        for (const stage of cardFlow.stages) {
            expect(screen.getByText(stage.column)).toBeInTheDocument()
        }

        // The current stage is marked, so the strip answers "where is it" at a glance.
        expect(screen.getByText('In Review')).toHaveClass('FlowStrip__stage--current')
        expect(screen.getByText('In Progress')).toHaveClass('FlowStrip__stage--done')

        // And the one question a stalled card raises is answered outright,
        // together with how long it has been standing there.
        expect(screen.getByText(/ветка влита в основную/).textContent).toMatch(/1 h/)
    })

    test('a card waiting for a place in the column says so', async () => {
        stubBindings({...cardFlow, waitingFor: [], queued: true})
        render(() => wrapIntl(() => <FlowStrip cardId='card1'/>))
        await waitFor(() => expect(screen.getByText(/free place in the column/)).toBeInTheDocument())
    })

    test('a card with no route draws nothing', async () => {
        stubBindings(null)
        const {container} = render(() => wrapIntl(() => <FlowStrip cardId='card1'/>))
        await waitFor(() => expect(container).toBeEmptyDOMElement())
    })

    // «Агент не запущен: …» used to be a comment on the card; it is the card's
    // current state, so the strip says it — verbatim, since the reason arrives
    // as a whole sentence — and drops it as soon as the machinery moves on.
    test('a card whose stage would not start says why on the strip', async () => {
        stubBindings({...cardFlow, waitingFor: [], stalled: 'агент не запущен: проект не найден в реестре'})
        const {container} = render(() => wrapIntl(() => <FlowStrip cardId='card1'/>))
        await waitFor(() => expect(screen.getByText(/агент не запущен: проект не найден/)).toBeInTheDocument())
        expect(container.querySelector('.FlowStrip__status--stalled')).not.toBeNull()
    })

    // Working outranks stalled: a stale reason must not shout over a session
    // that is already running.
    test('a running card never shows a stall reason', async () => {
        stubBindings({...cardFlow, waitingFor: [], running: true, stalled: 'агент не запущен'})
        render(() => wrapIntl(() => <FlowStrip cardId='card1'/>))
        await waitFor(() => expect(screen.getByText(/working now/)).toBeInTheDocument())
        expect(screen.queryByText(/агент не запущен/)).toBeNull()
    })
})
