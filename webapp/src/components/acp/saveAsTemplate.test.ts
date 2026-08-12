import Mutator from '../../mutator'
import {Board, createBoard} from '../../blocks/board'
import {createIntl} from '../../intl'

import {saveBoardAsTemplate, isSaveAsTemplateAvailable} from './saveAsTemplate'
import {BOARD_PROP_COLUMNS, BOARD_PROP_FLOWS, BOARD_PROP_SETUP} from './automation'

vi.mock('../../mutator')

const anyWindow = window as any
const mockedMutator = vi.mocked(Mutator)
const intl = createIntl({locale: 'en'})

describe('components/acp/saveAsTemplate', () => {
    afterEach(() => {
        delete anyWindow.go
        vi.clearAllMocks()
    })

    test('is offered only where there is an agent side to read the automation from', () => {
        expect(isSaveAsTemplateAvailable()).toBe(false)
        anyWindow.go = {main: {App: {ExportBoardAutomation: vi.fn()}}}
        expect(isSaveAsTemplateAvailable()).toBe(true)
    })

    // Half of what a board does lives in the registry rather than on the board,
    // so a copy made without it is a template with the columns drawn and
    // nothing happening in them.
    test('the copy carries the automation the original runs', async () => {
        anyWindow.go = {
            main: {
                App: {
                    ExportBoardAutomation: vi.fn().mockResolvedValue(JSON.stringify({
                        acpColumns: [{optionId: 'opt-work', property: 'Статус', column: 'В работе', action: 'agent'}],
                        acpFlows: [{name: 'Фича', nodes: [], edges: []}],
                    })),
                },
            },
        }
        const board: Board = {
            ...createBoard(),
            id: 'board-1',
            title: 'Работа',
            properties: {[BOARD_PROP_SETUP]: JSON.stringify({steps: [{kind: 'project'}]})} as Board['properties'],
        }
        const copy: Board = {...createBoard(), id: 'template-1', isTemplate: true}
        mockedMutator.duplicateBoard.mockResolvedValue({boards: [copy], blocks: []})

        const saved = await saveBoardAsTemplate(board, intl)

        expect(mockedMutator.duplicateBoard).toHaveBeenCalledWith('board-1', expect.any(String), true)
        expect(JSON.parse(saved.properties[BOARD_PROP_COLUMNS] as string)[0].column).toBe('В работе')
        expect(JSON.parse(saved.properties[BOARD_PROP_FLOWS] as string)[0].name).toBe('Фича')

        // What the board itself declared it needs asking travels with it.
        expect(JSON.parse(saved.properties[BOARD_PROP_SETUP] as string).steps).toEqual([{kind: 'project'}])
        expect(mockedMutator.updateBoard).toHaveBeenCalled()
    })
})
