// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {Board} from '../../blocks/board'
import mutator from '../../mutator'
import {IntlShape} from '../../intl'

import {agentBindings} from './bindings'
import {Automation, boardAutomationProperties, readBoardSetup} from './automation'

// Turning a board somebody has built into a template other boards can start
// from. The board part of it is Focalboard's own duplicate-as-template; what
// this adds is the half that lives outside the board — the columns' behaviour
// and the routes, which are registry entries of this machine and have to be
// read back out of Go and written into the copy's own properties.
//
// Without that a "template" made from a working board arrives with the columns
// drawn and nothing happening in them, which is the more confusing half of the
// two to be missing.

export function isSaveAsTemplateAvailable(): boolean {
    return Boolean(agentBindings()?.ExportBoardAutomation)
}

// exportAutomation reads what the board runs. A build with no agent side, or a
// board with nothing configured, gives an empty automation rather than an
// error: the template is still worth making for its columns alone.
export async function exportAutomation(boardId: string): Promise<Automation> {
    const bindings = agentBindings()
    if (!bindings?.ExportBoardAutomation) {
        return {columns: [], flows: []}
    }
    const raw = JSON.parse(await bindings.ExportBoardAutomation(boardId)) || {}
    return {columns: raw.acpColumns || [], flows: raw.acpFlows || []}
}

// saveBoardAsTemplate copies the board as a template and gives the copy the
// automation the original runs. It returns the template board, which is what
// the editor then opens.
export async function saveBoardAsTemplate(board: Board, intl: IntlShape): Promise<Board> {
    const automation = await exportAutomation(board.id)
    const copied = await mutator.duplicateBoard(
        board.id,
        intl.formatMessage({id: 'Mutator.new-template-from-board', defaultMessage: 'new template from board'}),
        true,
    )
    const template = copied.boards[0]
    if (!template) {
        throw new Error(intl.formatMessage({id: 'SaveAsTemplate.failed', defaultMessage: 'The board could not be copied.'}))
    }

    // The setup steps travel with it if the board declared any — a board made
    // from a template carries them, and this is that board going back.
    const updated: Board = {
        ...template,
        properties: boardAutomationProperties(template, automation, readBoardSetup(board)),
    }
    await mutator.updateBoard(updated, template, 'template automation')
    return updated
}
