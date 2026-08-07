// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Board, createBoard} from '../../blocks/board'

import {
    Automation,
    BOARD_PROP_COLUMNS,
    BOARD_PROP_FLOWS,
    BOARD_PROP_SETUP,
    Flow,
    SUCCESS,
    automationChanges,
    boardAutomationProperties,
    boardColumns,
    impliedSetupSteps,
    readBoardAutomation,
    readBoardSetup,
    routeOptionMissing,
    withColumn,
    withoutColumn,
} from './automation'

const columns = [
    {optionId: 'opt-work', name: 'В работе'},
    {optionId: 'opt-review', name: 'На ревью'},
]

function boardWith(properties: Record<string, unknown>): Board {
    return {
        ...createBoard(),
        cardProperties: [{
            id: 'prop-status',
            name: 'Статус',
            type: 'select',
            options: [
                {id: 'opt-work', value: 'В работе', color: 'propColorBlue'},
                {id: 'opt-review', value: 'На ревью', color: 'propColorPink'},
            ],
        }],
        properties: properties as Board['properties'],
    }
}

describe('components/acp/automation', () => {
    test('a board’s columns are the options of its select property', () => {
        expect(boardColumns(boardWith({}), 'Статус')).toEqual([
            {optionId: 'opt-work', name: 'В работе', color: 'propColorBlue'},
            {optionId: 'opt-review', name: 'На ревью', color: 'propColorPink'},
        ])
    })

    // The stage a column stands as carries the option's id, so renaming the
    // column on the board leaves the route alone.
    test('joining a column to a route makes it a stage of the column', () => {
        const flow: Flow = {name: 'Фича', nodes: [], edges: []}
        const joined = withColumn(flow, columns[0])
        expect(joined.nodes).toEqual([{id: 'opt-work', column: 'В работе', optionId: 'opt-work', action: ''}])

        // Twice is once: the column is already on the route.
        expect(withColumn(joined, columns[0]).nodes).toHaveLength(1)
    })

    test('taking a column off a route takes its transitions with it', () => {
        const flow: Flow = {
            name: 'Фича',
            nodes: [
                {id: 'a', column: 'В работе', action: ''},
                {id: 'b', column: 'На ревью', action: ''},
            ],
            edges: [{from: 'a', to: 'b', on: SUCCESS}],
        }
        expect(withoutColumn(flow, 'b')).toEqual({name: 'Фича', nodes: [{id: 'a', column: 'В работе', action: ''}], edges: []})
    })

    // Routes are keyed by name, so renaming one is a new route and the old one
    // going away — which is what happens to the cards that named it too.
    test('what changed is worked out per column and per route name', () => {
        const before: Automation = {
            columns: [{optionId: 'opt-work', property: 'Статус', column: 'В работе', action: 'agent'}],
            flows: [{name: 'Фича', nodes: [], edges: []}, {name: 'Хотфикс', nodes: [], edges: []}],
        }
        const after: Automation = {
            columns: [{optionId: 'opt-review', property: 'Статус', column: 'На ревью', action: 'none'}],
            flows: [{name: 'Фича', nodes: [], edges: [], projectName: 'webapp'}, {name: 'Быстрый', nodes: [], edges: []}],
        }
        const changes = automationChanges(before, after)
        expect(changes.savedColumns.map((c) => c.column)).toEqual(['На ревью'])
        expect(changes.removedColumns.map((c) => c.column)).toEqual(['В работе'])
        expect(changes.addedFlows.map((f) => f.name)).toEqual(['Быстрый'])
        expect(changes.updatedFlows.map((f) => f.name)).toEqual(['Фича'])
        expect(changes.removedFlows.map((f) => f.name)).toEqual(['Хотфикс'])
    })

    // A template carries its automation in the board's own properties, and Go
    // reads either the object or the JSON text of it.
    test('a template’s automation is read whether it is an object or its text', () => {
        const asObjects = readBoardAutomation(boardWith({
            [BOARD_PROP_COLUMNS]: [{property: 'Статус', column: 'В работе', action: 'agent'}],
            [BOARD_PROP_FLOWS]: [{name: 'Фича', nodes: [], edges: []}],
        }))
        expect(asObjects.columns[0].column).toBe('В работе')
        expect(asObjects.flows[0].name).toBe('Фича')

        const asText = readBoardAutomation(boardWith({
            [BOARD_PROP_COLUMNS]: JSON.stringify([{property: 'Статус', column: 'На ревью', action: 'none'}]),
        }))
        expect(asText.columns[0].column).toBe('На ревью')
        expect(asText.flows).toEqual([])
    })

    test('a template with unreadable automation reads as one with none', () => {
        expect(readBoardAutomation(boardWith({[BOARD_PROP_COLUMNS]: '{'}))).toEqual({columns: [], flows: []})
        expect(readBoardSetup(boardWith({[BOARD_PROP_SETUP]: 'nonsense'}))).toBeUndefined()
    })

    test('saving a template writes the three properties Go reads', () => {
        const board = boardWith({keepMe: 'yes'})
        const properties = boardAutomationProperties(
            board,
            {columns: [{property: 'Статус', column: 'В работе', action: 'agent'}], flows: []},
            {steps: [{kind: 'project'}]},
        )
        expect(properties.keepMe).toBe('yes')
        expect(JSON.parse(properties[BOARD_PROP_COLUMNS] as string)[0].column).toBe('В работе')
        expect(JSON.parse(properties[BOARD_PROP_SETUP] as string).steps).toEqual([{kind: 'project'}])

        // Going back to "work it out from the automation" is the property not
        // being there at all, which is what Go reads as "the board said nothing".
        expect(boardAutomationProperties(board, {columns: [], flows: []}, undefined)[BOARD_PROP_SETUP]).toBeUndefined()
    })

    test('the steps offered to a template follow what its automation does', () => {
        const defs = [
            {kind: 'project', optional: false},
            {kind: 'agent', optional: false},
            {kind: 'deploy', optional: true},
            {kind: 'browser', optional: true},
            {kind: 'done', optional: false},
        ]
        const plain = impliedSetupSteps({columns: [{property: 'Статус', column: 'В работе', action: 'agent'}], flows: []}, defs)
        expect(plain.map((s) => s.kind)).toEqual(['project', 'agent', 'done'])

        const publishing = impliedSetupSteps({
            columns: [{property: 'Статус', column: 'Деплой', action: 'deploy'}],
            flows: [{name: 'Фича', nodes: [{id: 'n', column: 'Тест', action: 'test'}], edges: []}],
        }, defs)
        expect(publishing.map((s) => s.kind)).toEqual(['project', 'agent', 'deploy', 'browser', 'done'])
    })

    // A route no card can name is drawn and never taken — the commonest way an
    // afternoon in the editor comes to nothing.
    test('a route with no option of its name is reported as unreachable', () => {
        const board = boardWith({})
        expect(routeOptionMissing(board, {name: 'Фича', nodes: [], edges: []})).toBe(true)
        expect(routeOptionMissing(board, {name: 'на ревью', nodes: [], edges: []})).toBe(false)
    })
})
