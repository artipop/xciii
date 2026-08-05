// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Board} from '../../blocks/board'

// A board made from a template carries its own automation in two of its own
// properties — the same two the Go side reads (internal/acp/boardseed.go). What
// that automation *does* is what decides which parts of the machine are worth
// asking about at all: a board of household chores runs an agent and nothing
// else, so a Dokku host and a browser are questions it should never be asked.
const COLUMNS_PROPERTY = 'acpColumns'
const FLOWS_PROPERTY = 'acpFlows'

// What happens when a card lands on a column or a stage.
export type AutomationAction = 'none' | 'agent' | 'deploy' | 'test'

type AutomationColumn = {column?: string, action?: string}
type AutomationFlow = {nodes?: AutomationColumn[]}

// What the trigger column is called on a board that ships none: the default the
// Go config carries (acp.DefaultConfig).
const DEFAULT_AGENT_COLUMN = 'In Progress'

// A property may also arrive as the JSON text of itself: the board store keeps
// free-form properties as strings on some paths, which is why Go reads them the
// same two ways.
function readProperty<T>(board: Board | undefined, name: string): T[] {
    const raw = board?.properties?.[name] as unknown
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw)
            return Array.isArray(parsed) ? parsed as T[] : []
        } catch {
            return []
        }
    }
    return Array.isArray(raw) ? raw as T[] : []
}

// boardCarriesAutomation reports whether this board was made from a template
// that ships columns and routes — there is nothing to set up for a board that
// runs nothing.
export function boardCarriesAutomation(board?: Board): boolean {
    return Boolean(board?.properties && board.properties[FLOWS_PROPERTY] !== undefined)
}

// boardActions is everything this board's own automation does. A stage that
// names no action does whatever its column does, so it adds nothing here.
export function boardActions(board?: Board): Set<AutomationAction> {
    const actions = new Set<AutomationAction>()
    const add = (action?: string) => {
        if (action) {
            actions.add(action as AutomationAction)
        }
    }
    readProperty<AutomationColumn>(board, COLUMNS_PROPERTY).forEach((column) => add(column.action))
    readProperty<AutomationFlow>(board, FLOWS_PROPERTY).forEach((flow) => (flow.nodes || []).forEach((node) => add(node.action)))
    return actions
}

// A board that ships nothing tells us nothing, so nothing is ruled out for it:
// the question is only hidden when the board is in a position to answer it.
function usesAction(board: Board | undefined, action: AutomationAction): boolean {
    return !boardCarriesAutomation(board) || boardActions(board).has(action)
}

// agentColumn is the column a card is dragged into to be worked on — which is
// the one thing every board has and every board names differently.
export function agentColumn(board?: Board): string {
    const column = readProperty<AutomationColumn>(board, COLUMNS_PROPERTY).find((c) => c.action === 'agent')
    return column?.column || DEFAULT_AGENT_COLUMN
}

export function boardDeploys(board?: Board): boolean {
    return usesAction(board, 'deploy')
}

export function boardTests(board?: Board): boolean {
    return usesAction(board, 'test')
}
