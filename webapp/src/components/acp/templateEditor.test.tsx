import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import Mutator from '../../mutator'
import {wrapIntl} from '../../testUtils'
import {Board, createBoard} from '../../blocks/board'

import TemplateEditor from './templateEditor'
import {BOARD_PROP_COLUMNS, BOARD_PROP_FLOWS, BOARD_PROP_SETUP, SUCCESS} from './automation'

vi.mock('../../mutator')

const anyWindow = window as any
const mockedMutator = vi.mocked(Mutator)

const template: Board = {
    ...createBoard(),
    id: 'template-1',
    title: 'Разработка',
    isTemplate: true,
    cardProperties: [{
        id: 'prop-status',
        name: 'Статус',
        type: 'select',
        options: [
            {id: 'opt-work', value: 'В работе', color: ''},
            {id: 'opt-review', value: 'На ревью', color: ''},
        ],
    }],
    properties: {
        [BOARD_PROP_COLUMNS]: JSON.stringify([
            {optionId: 'opt-work', propertyId: 'prop-status', property: 'Статус', column: 'В работе', action: 'agent'},
        ]),
        [BOARD_PROP_FLOWS]: JSON.stringify([{
            name: 'Фича',
            property: 'Статус',
            nodes: [
                {id: 'opt-work', column: 'В работе', optionId: 'opt-work', action: ''},
                {id: 'opt-review', column: 'На ревью', optionId: 'opt-review', action: ''},
            ],
            edges: [{from: 'opt-work', to: 'opt-review', on: SUCCESS}],
        }]),
    } as Board['properties'],
}

function stubBindings() {
    const bindings = {
        ListSetupSteps: vi.fn().mockResolvedValue(JSON.stringify([
            {kind: 'project', registry: 'projects', optional: false},
            {kind: 'agent', registry: 'agents', optional: false},
            {kind: 'deploy', registry: 'deploys', optional: true},
            {kind: 'browser', registry: 'agentMCP', optional: true},
            {kind: 'done', optional: false},
        ])),
        ListFlowTriggers: vi.fn().mockResolvedValue(JSON.stringify([
            {kind: SUCCESS, source: 'outcome', label: 'шаг прошёл'},
        ])),
        ListAgents: vi.fn().mockResolvedValue('[]'),
        ListDeployTargets: vi.fn().mockResolvedValue('[]'),
    }
    anyWindow.go = {main: {App: bindings}}
    return bindings
}

describe('components/acp/templateEditor', () => {
    afterEach(() => {
        delete anyWindow.go
        vi.clearAllMocks()
    })

    // What a board made from the template will do is said here and edited on a
    // board: the routes came off one, and «Колонки и маршруты…» is where a
    // route is drawn.
    test('says what the template carries, and does not offer to redraw it', async () => {
        stubBindings()
        const {container} = render(() => wrapIntl(() => (
            <TemplateEditor
                board={template}
                onClose={vi.fn()}
            />
        )))
        const carries = await waitFor(() => {
            const found = container.querySelector('.TemplateEditor__carries')
            expect(found).toBeTruthy()
            return found!
        })
        expect(carries.textContent).toContain('В работе (an agent works on the card)')
        expect(carries.textContent).toContain('В работе → На ревью')
        expect(container.querySelector('.FlowDiagram')).toBeNull()
        expect(screen.getByDisplayValue('Разработка')).toBeInTheDocument()
    })

    test('saving writes the columns, the routes and the questions into the board', async () => {
        stubBindings()
        const onClose = vi.fn()
        render(() => wrapIntl(() => (
            <TemplateEditor
                board={template}
                onClose={onClose}
            />
        )))

        // Until the steps are named they are worked out from the automation, so
        // the property is not written at all — which is what Go reads as "this
        // template said nothing about it".
        userEvent.click(await screen.findByRole('button', {name: 'Name the steps'}))

        // One hint box per step that asks something; the first is the folder.
        const hints = await screen.findAllByPlaceholderText('A line of your own beside the question')
        userEvent.type(hints[0], 'Папка с заметками')

        userEvent.click(screen.getByRole('button', {name: 'Save template'}))
        await waitFor(() => expect(mockedMutator.updateBoard).toHaveBeenCalled())

        const saved = mockedMutator.updateBoard.mock.calls[0][0] as Board
        expect(JSON.parse(saved.properties[BOARD_PROP_COLUMNS] as string)[0].column).toBe('В работе')
        expect(JSON.parse(saved.properties[BOARD_PROP_FLOWS] as string)[0].name).toBe('Фича')

        const setup = JSON.parse(saved.properties[BOARD_PROP_SETUP] as string)
        expect(setup.steps.map((s: {kind: string}) => s.kind)).toEqual(['project', 'agent', 'done'])
        expect(setup.steps[0].hint).toBe('Папка с заметками')
        await waitFor(() => expect(onClose).toHaveBeenCalled())
    })

    test('the name and the icon of the template are the board’s own', async () => {
        stubBindings()
        render(() => wrapIntl(() => (
            <TemplateEditor
                board={template}
                onClose={vi.fn()}
            />
        )))

        const name = await screen.findByDisplayValue('Разработка')
        userEvent.clear(name)
        userEvent.type(name, 'Мой шаблон')
        userEvent.click(screen.getByRole('button', {name: 'Save template'}))

        await waitFor(() => expect(mockedMutator.updateBoard).toHaveBeenCalled())
        expect((mockedMutator.updateBoard.mock.calls[0][0] as Board).title).toBe('Мой шаблон')
    })
})
