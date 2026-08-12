import {fireEvent, render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {chooseOption, wrapIntl} from '../../testUtils'
import {setupReactFlowEnvironment} from '../../test/reactFlowEnvironment'
import {IPropertyTemplate} from '../../blocks/board'

import AutomationEditor from './automationEditor'
import {Automation, SUCCESS} from './automation'

setupReactFlowEnvironment()

const property = {
    id: 'prop-status',
    name: 'Статус',
    type: 'select',
    options: [
        {id: 'opt-work', value: 'В работе', color: ''},
        {id: 'opt-review', value: 'На ревью', color: ''},
        {id: 'opt-blocked', value: 'Заблокировано', color: ''},
    ],
} as IPropertyTemplate

const columns = [
    {optionId: 'opt-work', name: 'В работе'},
    {optionId: 'opt-review', name: 'На ревью'},
    {optionId: 'opt-blocked', name: 'Заблокировано'},
]

const triggers = [
    {kind: SUCCESS, source: 'outcome', label: 'шаг прошёл'},
    {kind: 'failure', source: 'outcome', label: 'шаг упал'},
    {kind: 'branch.merged', source: 'git', label: 'ветка влита в основную'},
]

const automation: Automation = {
    columns: [{boardId: 'board-1', optionId: 'opt-work', property: 'Статус', column: 'В работе', action: 'agent', agents: ['claude']}],
    flows: [{
        name: 'Фича',
        boardId: 'board-1',
        property: 'Статус',
        nodes: [
            {id: 'opt-work', column: 'В работе', optionId: 'opt-work', action: ''},
            {id: 'opt-review', column: 'На ревью', optionId: 'opt-review', action: ''},
        ],
        edges: [{from: 'opt-work', to: 'opt-review', on: SUCCESS}],
    }],
}

function renderEditor(overrides: Partial<Parameters<typeof AutomationEditor>[0]> = {}) {
    const onChange = vi.fn()
    const result = render(() => wrapIntl(() => (
        <AutomationEditor
            boardId='board-1'
            property={property}
            properties={[property]}
            columns={columns}
            automation={automation}
            triggers={triggers}
            agents={[{name: 'claude'}, {name: 'codex'}]}
            deploys={[]}
            onChange={onChange}
            {...overrides}
        />
    )))
    return {...result, onChange}
}

describe('components/acp/automationEditor', () => {
    afterEach(() => vi.clearAllMocks())

    // The canvas is the board: every column is on it, whether anything happens
    // there or not. There is no "add a stage, now choose its column".
    test('every column of the board is on the canvas, with what happens in it', () => {
        const {container} = renderEditor()
        for (const column of columns) {
            expect(screen.getByText(column.name)).toBeInTheDocument()
        }
        const actions = [...container.querySelectorAll('.FlowDiagram__action')].map((el) => el.textContent)
        expect(actions).toContain('agent · claude')
    })

    test('a column is edited where it stands, and the change names the option', async () => {
        const {container, onChange} = renderEditor({focusColumnId: 'opt-review'})

        expect(container.querySelector('.AutomationEditor__panelTitle')).toHaveTextContent('На ревью')
        chooseOption(screen.getByRole('button', {name: 'When a card lands here'}), 'deploy the card’s branch')

        await waitFor(() => expect(onChange).toHaveBeenCalled())
        const next: Automation = onChange.mock.calls[0][0]
        const saved = next.columns.find((c) => c.optionId === 'opt-review')
        expect(saved).toMatchObject({
            boardId: 'board-1',
            propertyId: 'prop-status',
            property: 'Статус',
            column: 'На ревью',
            action: 'deploy',
        })

        // The column somebody else configured is untouched.
        expect(next.columns.find((c) => c.optionId === 'opt-work')?.action).toBe('agent')
    })

    // Choosing a route redraws the same columns with its arrows over them; the
    // ones it does not use are still there, faded.
    test('a route shows its own columns and fades the rest', async () => {
        const {container} = renderEditor()
        userEvent.click(screen.getByRole('button', {name: 'Фича'}))

        await waitFor(() => expect(container.querySelector('.FlowDiagram__stage--spare')).not.toBeNull())
        expect(container.querySelectorAll('.FlowDiagram__stage--spare')).toHaveLength(1)
        expect(container.querySelector('.FlowDiagram__stage--spare')!.textContent).toContain('Заблокировано')
    })

    test('clicking a faded column puts it on the route', async () => {
        const {container, onChange} = renderEditor()
        userEvent.click(screen.getByRole('button', {name: 'Фича'}))

        await waitFor(() => expect(container.querySelector('.FlowDiagram__stage--spare')).not.toBeNull())
        fireEvent.click(container.querySelector('.FlowDiagram__stage--spare')!)

        await waitFor(() => expect(onChange).toHaveBeenCalled())
        const next: Automation = onChange.mock.calls[0][0]
        expect(next.flows[0].nodes.map((n) => n.column)).toEqual(['В работе', 'На ревью', 'Заблокировано'])

        // Joining a column adds no behaviour of its own: what happens there is
        // still the column's answer, for every route at once.
        expect(next.flows[0].nodes[2].action).toBe('')
    })

    test('a route is renamed where it is read', async () => {
        const {onChange} = renderEditor()
        userEvent.click(screen.getByRole('button', {name: 'Фича'}))

        const name = await screen.findByDisplayValue('Фича')
        userEvent.clear(name)
        userEvent.type(name, 'Долгий путь')
        name.blur()

        await waitFor(() => expect(onChange).toHaveBeenCalled())
        const next: Automation = onChange.mock.calls.at(-1)![0]
        expect(next.flows.map((f) => f.name)).toEqual(['Долгий путь'])
    })

    // A route nothing can name is a route no card ever takes: the editor says
    // so where the route is edited, and offers the one click that fixes it.
    test('an unreachable route is called out', async () => {
        const onAddRouteOption = vi.fn()
        renderEditor({routeOptionMissing: () => true, onAddRouteOption})
        userEvent.click(screen.getByRole('button', {name: 'Фича'}))

        const fix = await screen.findByRole('button', {name: 'Add the option'})
        userEvent.click(fix)
        await waitFor(() => expect(onAddRouteOption).toHaveBeenCalled())
    })

    test('a new route starts on the column an agent works in', async () => {
        const {onChange} = renderEditor()
        userEvent.click(screen.getByRole('button', {name: '+ route'}))

        await waitFor(() => expect(onChange).toHaveBeenCalled())
        const next: Automation = onChange.mock.calls[0][0]
        expect(next.flows).toHaveLength(2)
        expect(next.flows[1].nodes.map((n) => n.column)).toEqual(['В работе'])
    })

    // The palette is how a board grows a column that does something: a block
    // dropped on the canvas becomes a column of the board, a spec saying what
    // it does and — on a route — a stage standing where it landed.
    test('a palette block dropped on the canvas becomes a working column', async () => {
        const onCreateColumn = vi.fn().mockResolvedValue({optionId: 'opt-new', name: 'Deploy'})
        const {container, onChange} = renderEditor({onCreateColumn})

        expect(container.querySelectorAll('.AutomationEditor__block')).toHaveLength(4)
        userEvent.click(screen.getByRole('button', {name: 'Фича'}))

        const canvas = container.querySelector('[data-testid="flow-diagram"]')!
        const data = new Map([['application/x-xciii-block', 'deploy']])
        fireEvent.drop(canvas, {
            dataTransfer: {
                types: [...data.keys()],
                getData: (t: string) => data.get(t) || '',
            },
        })

        await waitFor(() => expect(onCreateColumn).toHaveBeenCalledWith('Deploy'))
        await waitFor(() => expect(onChange).toHaveBeenCalled())
        const next: Automation = onChange.mock.calls.at(-1)![0]
        expect(next.columns.find((c) => c.optionId === 'opt-new')).toMatchObject({column: 'Deploy', action: 'deploy'})
        expect(next.flows[0].nodes.map((n) => n.column)).toContain('Deploy')
    })

    // A transition can fork on the card: the success edge stays the fallback,
    // and a branch with a condition is added beside it.
    test('a branch on a condition is added beside the transition', async () => {
        const {container, onChange} = renderEditor()

        userEvent.click(screen.getByRole('button', {name: 'Фича'}))
        const stage = await waitFor(() => {
            const found = [...container.querySelectorAll('.FlowDiagram__stage')].
                find((el) => el.textContent?.includes('В работе'))
            expect(found).toBeTruthy()
            return found!
        })
        fireEvent.click(stage)
        userEvent.click(await screen.findByRole('button', {name: '+ branch on a condition'}))

        await waitFor(() => expect(onChange).toHaveBeenCalled())
        const next: Automation = onChange.mock.calls.at(-1)![0]
        expect(next.flows[0].edges).toHaveLength(2)
        expect(next.flows[0].edges[1]).toMatchObject({from: 'opt-work', on: SUCCESS, if: {property: '', value: ''}})
    })

    // The condition is written where the arrow is edited: property and value
    // from the board's own vocabulary, nothing typed by hand.
    test('a property condition is picked from the board’s own options', async () => {
        const priority = {
            id: 'prop-priority',
            name: 'Приоритет',
            type: 'select',
            options: [
                {id: 'opt-high', value: 'Высокий', color: ''},
                {id: 'opt-low', value: 'Низкий', color: ''},
            ],
        } as IPropertyTemplate
        const withBranch: Automation = {
            ...automation,
            flows: [{
                ...automation.flows[0],
                edges: [
                    ...automation.flows[0].edges,
                    {from: 'opt-work', to: 'opt-review', on: SUCCESS, if: {property: '', value: ''}},
                ],
            }],
        }
        const {container, onChange} = renderEditor({
            automation: withBranch,
            properties: [property, priority],
        })
        userEvent.click(screen.getByRole('button', {name: 'Фича'}))
        const stage = await waitFor(() => {
            const found = [...container.querySelectorAll('.FlowDiagram__stage')].
                find((el) => el.textContent?.includes('В работе'))
            expect(found).toBeTruthy()
            return found!
        })
        fireEvent.click(stage)

        // Scoped to the condition editor: with two select properties the routes
        // bar has a property picker too, and it also offers «Приоритет».
        const propertyPick = container.querySelector('.AutomationEditor__cond .AutomationEditor__condFields .Select') as HTMLElement
        chooseOption(propertyPick, 'Приоритет')

        await waitFor(() => expect(onChange).toHaveBeenCalled())
        const next: Automation = onChange.mock.calls.at(-1)![0]
        expect(next.flows[0].edges[1].if).toEqual({property: 'Приоритет', value: ''})
    })

    // Different agents on different nodes of one route: the stage's own crew is
    // written on the node («Только в этом маршруте…»), and the engine already
    // preferred it — the editor just could not say it. Nothing ticked means
    // the column decides, which is why unticking the last one removes the
    // override rather than storing an empty list.
    test('a stage of a route can name its own crew', async () => {
        const {container, onChange} = renderEditor()

        userEvent.click(screen.getByRole('button', {name: 'Фича'}))
        const stage = await waitFor(() => {
            const found = [...container.querySelectorAll('.FlowDiagram__stage')].
                find((el) => el.textContent?.includes('В работе'))
            expect(found).toBeTruthy()
            return found!
        })
        fireEvent.click(stage)

        const override = await waitFor(() => {
            const details = container.querySelector('.AutomationEditor__override')
            expect(details).toBeTruthy()
            return details!
        })
        const codex = [...override.querySelectorAll('.AutomationEditor__agent')].
            find((el) => el.textContent?.includes('codex'))!
        fireEvent.click(codex.querySelector('input')!)

        await waitFor(() => expect(onChange).toHaveBeenCalled())
        const next: Automation = onChange.mock.calls.at(-1)![0]
        const node = next.flows[0].nodes.find((n) => n.id === 'opt-work')
        expect(node?.agentNames).toEqual(['codex'])

        // The column's own crew is not what was edited.
        expect(next.columns.find((c) => c.optionId === 'opt-work')?.agents).toEqual(['claude'])
    })

    // The target registry moved out of the app's settings, and the deploy
    // select is exactly where somebody discovers it is empty — so the way to
    // it is said right there, not left to be searched for.
    test('an empty target list says where targets are added', () => {
        renderEditor({
            automation: {
                ...automation,
                columns: [{boardId: 'board-1', optionId: 'opt-work', property: 'Статус', column: 'В работе', action: 'deploy'}],
            },
            focusColumnId: 'opt-work',
        })

        expect(screen.getByText(/add one in «Where to deploy» below/)).toBeInTheDocument()
    })

    test('the hint is not shown once a target exists', () => {
        renderEditor({
            automation: {
                ...automation,
                columns: [{boardId: 'board-1', optionId: 'opt-work', property: 'Статус', column: 'В работе', action: 'deploy'}],
            },
            deploys: [{name: 'dokku-1'}],
            focusColumnId: 'opt-work',
        })

        expect(screen.queryByText(/add one in «Where to deploy» below/)).toBeNull()
    })
})
