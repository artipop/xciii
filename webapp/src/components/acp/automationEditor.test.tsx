// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {fireEvent, render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'
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
        const action = screen.getByRole('combobox', {name: /When a card lands here/}) as HTMLSelectElement
        userEvent.selectOptions(action, 'deploy')

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
})
