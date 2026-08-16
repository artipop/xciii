// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {Board, IPropertyTemplate, IPropertyOption} from '../../blocks/board'
import {Card} from '../../blocks/card'
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
export const WORKDIR_PROPERTY_TITLE = 'Папка'
export const BRANCH_PROPERTY_TITLE = 'Ветка'

// The names this app has given the folder field before now, newest last. A
// board that still carries one is renamed, once, by the same rule that lets us
// create it: the name is ours, so changing it is not editing somebody's own
// field. Anything a person renamed it to is left alone — it is none of these.
const OUR_WORKDIR_TITLES = ['Проекты', 'Папки', WORKDIR_PROPERTY_TITLE]

// namedByUs says whether the field still carries a name we gave it, and may
// therefore be renamed under its owner.
function namedByUs(name?: string): boolean {
    return OUR_WORKDIR_TITLES.includes((name || '').trim())
}

// Workdir is a registry entry as the page reads it back (see workdirsPanel).
export type Workdir = {
    // What a card points at. The board's option for this folder is created
    // under it, so the card names its folder by an id and what the folder is
    // *called* stays a label — free to change, and free to stop being a folder
    // name at all when a place to work is a repository to clone or a drive.
    // Empty only for an entry read from a Go side older than the field.
    id?: string
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
    const renaming = Boolean(property) && namedByUs(property!.name) && property!.name !== WORKDIR_PROPERTY_TITLE
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

            // One choice, because a card is one workspace: it claims one
            // directory, works one branch and hands its agent one cwd. See
            // narrowWorkdirProperty for what a second value used to mean.
            type: 'select',
            options: [],
        }
        newProperties.push(target)
    }
    if (renaming) {
        target.name = WORKDIR_PROPERTY_TITLE
    }
    for (const workdir of missing) {
        target.options.push({
            // The registry's id, not a fresh one: this is what makes the card's
            // value a reference to the entry rather than a copy of its name.
            id: workdir.id || Utils.createGuid(IDType.BlockID),
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

// soleWorkdirOption is the board's folder field and its one option, when the
// field has exactly one. That is the case where filling a card in is not a
// guess: the list a person would open has a single entry, and leaving the field
// empty costs them a click and tells them nothing.
//
// Counted off the field rather than off the registry, because the field is what
// a card can hold. Options are never taken away — cards reference them — so a
// board that has known two folders offers two, and two is a question only the
// person can answer.
export function soleWorkdirOption(board: Board): {propertyId: string, optionId: string} | undefined {
    const property = findWorkdirProperty(board, board.cardProperties)
    if (property?.type !== 'select' || property.options.length !== 1) {
        return undefined
    }
    return {propertyId: property.id, optionId: property.options[0].id}
}

// narrowWorkdirProperty makes the folder field a single choice on a board that
// still carries it as a multiSelect.
//
// Two folders on a card never meant two. A card claims one workspace, works one
// branch — which the board keeps in one text field — and hands its agent one
// cwd; `resolveWorkdir` took the first of the selected options and dropped the
// rest, so the choice was already being made for the person, and made in
// silence. Narrowing the field is what puts that choice back on the card, and
// it is why this edits somebody's board rather than leaving the two types to
// live side by side.
//
// The rename rides along: the plural was the type talking. A field somebody
// renamed keeps their name — that half was never ours.
//
// Idempotent, and it writes only for a board that still has the old field.
export async function narrowWorkdirProperty(board: Board, cards: Card[]): Promise<boolean> {
    const property = findWorkdirProperty(board, board.cardProperties)
    if (!property || property.type !== 'multiSelect') {
        return false
    }

    // changePropertyTypeAndName is the board's own conversion: between select
    // and multiSelect it keeps the options — which cards reference — and leaves
    // every card the first of the values it had, which is the folder the agent
    // was already being sent to.
    const name = namedByUs(property.name) ? WORKDIR_PROPERTY_TITLE : property.name
    await mutator.changePropertyTypeAndName(board, cards, property, 'select', name)
    return true
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
