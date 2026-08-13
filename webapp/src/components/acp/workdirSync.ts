// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {Board, IPropertyTemplate, IPropertyOption} from '../../blocks/board'
import mutator from '../../mutator'
import {Utils, IDType} from '../../utils'

import {BOARD_PROP_BRANCH_PROPERTY, BOARD_PROP_PROJECT_PROPERTY, boardBranchProperty, legacyBoardProp} from './automation'

// Mirroring the folder registry into the board's own field, which is the only
// way a card can name a folder: the registry is the machine's, the field is the
// board's, and a folder nobody put in the field is a folder no card can pick.
//
// It lives here rather than in the folders panel because the panel is not the
// only place a folder is added — the setup wizard adds one too, and a folder
// added there used to reach the registry and stop, leaving the card's field
// empty and the person who had just answered the question with nothing to
// choose. Anything that adds a folder calls this.

// What the fields are *called* when this app has to make one. Names given at
// creation and never keys: the board records which property is which, so a
// person may rename either and a board in another language is not obliged to
// spell them this way.
export const WORKDIR_PROPERTY_TITLE = 'Папки'
export const BRANCH_PROPERTY_TITLE = 'Ветка'

// The name this app used to give the folder field. A board that still carries
// it is renamed, once, by the same rule that lets us create it: the name is
// ours, so changing it is not editing somebody's own field. Anything a person
// renamed it to is left alone — it is no longer this string.
const LEGACY_WORKDIR_PROPERTY_TITLE = 'Проекты'

// Workdir is a registry entry as the page reads it back (see workdirsPanel).
export type Workdir = {
    name: string
    path: string
    boardId?: string
    global?: boolean
    git?: boolean
    base?: string

    // How work here is arranged, resolved by Go: 'worktree', 'branch', or
    // 'plain' for a folder that is not a repository.
    mode?: string
    broken?: boolean
}

// findWorkdirProperty is the board's folder field, and it is the one the board
// says it is. Nothing is matched by name: a board that has not recorded one has
// not got one, and one is made.
export function findWorkdirProperty(board: Board, properties: IPropertyTemplate[]): IPropertyTemplate | undefined {
    const recorded = board.properties?.[BOARD_PROP_PROJECT_PROPERTY] ??
        board.properties?.[legacyBoardProp(BOARD_PROP_PROJECT_PROPERTY)!]
    if (typeof recorded !== 'string' || !recorded) {
        return undefined
    }
    return properties.find((p: IPropertyTemplate) => p.id === recorded)
}

// syncWorkdirsToBoard mirrors the registry into that field, creating it when
// the board has none. Add-only: existing options (which cards may reference)
// are never removed, and a board that already lists every folder is left
// untouched — this runs on its own, so it must not churn the board or the undo
// history. Returns how many options were added, so a caller that wants to say
// so can.
export async function syncWorkdirsToBoard(board: Board, registry: Workdir[]): Promise<{added: number, property?: IPropertyTemplate}> {
    if (registry.length === 0) {
        return {added: 0}
    }
    const property = findWorkdirProperty(board, board.cardProperties)

    // A folder marked "on every board" is offered to every board, and syncing
    // it would give a board of shopping lists a folder field it never asked
    // for. Such a folder only reaches a board that already knows about folders
    // — one that has the field, because a folder of its own put it there.
    const mine = registry.filter((r) => !r.global || property)
    if (mine.length === 0) {
        return {added: 0}
    }

    const existing = new Set((property?.options || []).map((o: IPropertyOption) => o.value.trim().toLowerCase()))
    const missing = mine.filter((r) => !existing.has(r.name.trim().toLowerCase()))

    // A board with a repository among its folders gets a field for the branch
    // its cards work on. It is made here, beside the folder field, because the
    // two exist for the same reason and a board of shopping lists must get
    // neither: what puts it there is a folder that is actually a repository.
    const wantsBranch = mine.some((r) => r.git) && !boardBranchProperty(board)
    const renaming = property?.name === LEGACY_WORKDIR_PROPERTY_TITLE
    if (property && missing.length === 0 && !wantsBranch && !renaming) {
        return {added: 0, property}
    }

    const newProperties: IPropertyTemplate[] = board.cardProperties.map((p) => ({
        ...p,
        options: [...p.options],
    }))
    let target = newProperties.find((p) => p.id === property?.id)
    if (!target) {
        target = {
            id: Utils.createGuid(IDType.BlockID),
            name: WORKDIR_PROPERTY_TITLE,
            type: 'multiSelect',
            options: [],
        }
        newProperties.push(target)
    }
    if (renaming) {
        target.name = WORKDIR_PROPERTY_TITLE
    }
    for (const workdir of missing) {
        target.options.push({
            id: Utils.createGuid(IDType.BlockID),
            value: workdir.name,
            color: 'propColorDefault',
        })
    }
    let branchProperty: IPropertyTemplate | undefined
    if (wantsBranch) {
        branchProperty = {
            id: Utils.createGuid(IDType.BlockID),
            name: BRANCH_PROPERTY_TITLE,
            type: 'text',
            options: [],
        }
        newProperties.push(branchProperty)
    }
    await mutator.updateBoardCardProperties(board.id, board.cardProperties, newProperties, 'sync workdirs')

    // Written after the fields exist, and only for a board that has just been
    // given one — the templates ship the pairs, and a board that already has
    // them is never patched, so opening the dialog leaves the undo history and
    // the websocket alone.
    if (!property || branchProperty) {
        const properties = {...board.properties}
        if (!property) {
            properties[BOARD_PROP_PROJECT_PROPERTY] = target.id
        }
        if (branchProperty) {
            properties[BOARD_PROP_BRANCH_PROPERTY] = branchProperty.id
        }
        await mutator.updateBoard({...board, properties}, board, 'remember the workdirs field')
    }
    return {added: missing.length, property: target}
}

// useWorkdirHere makes a folder somebody already registered available on this
// board. Which call that takes is the entry's business and not the caller's: a
// folder no board claimed is attached to this one, a folder another board owns
// becomes every board's, and a folder that is already this board's needs
// nothing at all.
export async function useWorkdirHere(entry: Workdir, boardId: string): Promise<void> {
    const bindings = (window as {go?: {main?: {App?: Record<string, (...args: unknown[]) => Promise<unknown>>}}}).go?.main?.App
    if (!bindings) {
        return
    }
    if (entry.global || entry.boardId === boardId) {
        return
    }
    if (!entry.boardId) {
        await bindings.AttachAgentWorkdir?.(entry.name, boardId)
        return
    }
    await bindings.ShareAgentWorkdir?.(entry.name)
}
