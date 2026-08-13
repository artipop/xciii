// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {Board} from '../../blocks/board'
import mutator from '../../mutator'
import {IntlShape} from '../../intl'

import {agentBindings} from './bindings'
import {Automation, boardAutomationProperties, readBoardAutomation, readBoardSetup} from './automation'

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
    const registry = await exportAutomation(board.id)

    // A board's automation reaches the registry when something first reads it
    // (SeedBoardAutomation), so a board made from a template and saved straight
    // back has all of it on the board and none of it in the registry. Writing
    // the registry's answer over the copy then erased the very thing the
    // template was being made for — the copy carries the board's own keys,
    // because duplicateBoard copies the properties too.
    const carried = readBoardAutomation(board)
    const automation = registry.columns.length > 0 || registry.flows.length > 0 ? registry : carried

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
    //
    // The name travels too. Focalboard's duplicate-as-template calls the copy
    // "New board template", which is right for a template made from nothing and
    // wrong for this: what was saved is a board somebody built and named, and
    // the dialog that opens next is where the name is changed if it needs to be.
    const updated: Board = {
        ...template,
        title: board.title || template.title,
        properties: boardAutomationProperties(template, automation, readBoardSetup(board)),
    }
    await mutator.updateBoard(updated, template, 'template automation')
    return updated
}
