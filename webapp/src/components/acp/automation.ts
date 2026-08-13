import {Board, IPropertyOption, IPropertyTemplate} from '../../blocks/board'

// What a board does, in the two halves the engine keeps apart: a **column**
// says what happens when a card lands in it, a **route** says where the card
// goes next. Both are edited over the board's own columns — the options of one
// select property — which is why they live in one module: a stage that is not a
// column of the board is a stage no card can ever stand on.
//
// Nothing here talks to Go or to the board store. The editor is the same
// whether it is pointed at the registry (a live board) or at a template's own
// properties, and both containers hand it these shapes.

export type FlowNode = {
    id: string
    column: string

    // The option the stage stands on, so renaming the column on the board
    // changes nothing. Empty in a route written before columns had ids.
    optionId?: string

    // Empty means "whatever the column does"; 'none' means the stage runs
    // nothing and waits for an event.
    action: string
    agentNames?: string[]
    deployName?: string

    // Where the stage works: 'owner' — the card's own workspace, so it sees the
    // card's branch; 'workdir' — the folder itself. Empty is the default for
    // what the stage does (Go's FlowNode.RunsIn).
    runIn?: string

    // Where the stage was left on the canvas. Absent means "lay it out for me".
    x?: number
    y?: number
}

export type FlowEdge = {
    from: string
    to: string
    on: string

    // A condition makes the transition ask about the card: several conditional
    // edges may share one (from, on) — the first that holds wins — and an edge
    // without one is the fallback. For the card.changed trigger the condition
    // is the event itself: which option firing it means.
    if?: EdgeCond
}

// EdgeCond is exactly one of two questions: does the card's select property
// carry this value, or did the agent's closing words contain this text.
export type EdgeCond = {
    property?: string
    value?: string
    commentContains?: string
}

export type Flow = {
    name: string
    boardId?: string
    projectName?: string
    property?: string
    nodes: FlowNode[]
    edges: FlowEdge[]
}

// FlowTrigger is one transition kind the engine implements. The list comes from
// Go, so the editor can never offer a transition that does nothing.
export type FlowTrigger = {
    kind: string
    source: string
    label: string
}

// ColumnSpec is what happens in one column — said once for the board, rather
// than repeated in every route that passes through it.
export type ColumnSpec = {
    boardId?: string
    propertyId?: string
    optionId?: string
    property: string
    column: string
    action: string
    agents?: string[]
    deployName?: string
    maxRunning?: number
}

// Automation is a board's whole answer: what its columns do and where its
// routes lead. It is what the editor edits and what a template carries.
export type Automation = {
    columns: ColumnSpec[]
    flows: Flow[]
}

// The two outcome triggers are a stage's own outputs and are drawn as such;
// everything else is an event the stage waits for.
export const SUCCESS = 'success'
export const FAILURE = 'failure'
export const BLOCKED = 'blocked'

// CARD_CHANGED is the board-side trigger: an option set on the card itself.
// Its edge must say which option through its condition.
export const CARD_CHANGED = 'card.changed'

export const ACTIONS = ['none', 'agent', 'deploy', 'test']

// OUTCOMES are the triggers produced by the stage's own action — the only ones
// where the agent spoke, and therefore the only ones a comment condition makes
// sense on.
export const OUTCOMES = [SUCCESS, FAILURE, BLOCKED]

// BoardColumn is a column as the board has it: an option of a select property.
// The editor never invents one — a column exists on the board first.
export type BoardColumn = {
    optionId: string
    name: string
    color?: string
}

// selectProperties are the properties a board can be organised in columns by.
export function selectProperties(board: Board): IPropertyTemplate[] {
    return (board.cardProperties || []).filter((p) => p.type === 'select')
}

// columnProperty is the property the automation is written against: the one it
// names, or the board's first select property.
export function columnProperty(board: Board, name?: string): IPropertyTemplate | undefined {
    const properties = selectProperties(board)
    return properties.find((p) => p.name === name) || properties[0]
}

export function boardColumns(board: Board, propertyName?: string): BoardColumn[] {
    const property = columnProperty(board, propertyName)
    return (property?.options || []).map((o: IPropertyOption) => ({optionId: o.id, name: o.value, color: o.color}))
}

// specFor is a column's saved behaviour: matched by the option it is, and only
// then by name — a spec written before the editor knew the ids carries none.
export function specFor(specs: ColumnSpec[], column: BoardColumn): ColumnSpec | undefined {
    return specs.find((s) => s.optionId && s.optionId === column.optionId) ||
        specs.find((s) => !s.optionId && s.column.toLowerCase() === column.name.toLowerCase())
}

// blankSpec is what a column nobody has configured does: nothing.
export function blankSpec(boardId: string, property: IPropertyTemplate | undefined, column: BoardColumn): ColumnSpec {
    return {
        boardId,
        propertyId: property?.id,
        optionId: column.optionId,
        property: property?.name || '',
        column: column.name,
        action: 'none',
    }
}

// upsertSpec replaces a column's settings in the list, or appends them.
export function upsertSpec(specs: ColumnSpec[], spec: ColumnSpec): ColumnSpec[] {
    const at = specs.findIndex((s) => sameColumn(s, spec))
    if (at < 0) {
        return [...specs, spec]
    }
    return specs.map((s, i) => (i === at ? spec : s))
}

// sameColumn is the predicate Go keys the registry on: the same option of the
// same board, or — before either is known — the same name.
export function sameColumn(a: ColumnSpec, b: ColumnSpec): boolean {
    if (a.optionId && b.optionId) {
        return a.optionId === b.optionId
    }
    return a.column.toLowerCase() === b.column.toLowerCase()
}

// nodeFor is the stage a column stands as in a route, if the route goes through
// it at all.
export function nodeFor(flow: Flow | undefined, column: BoardColumn): FlowNode | undefined {
    if (!flow) {
        return undefined
    }
    return flow.nodes.find((n) => n.optionId && n.optionId === column.optionId) ||
        flow.nodes.find((n) => !n.optionId && n.column.toLowerCase() === column.name.toLowerCase())
}

// nodeId is what a column is called inside a route. The option's own id is used
// so the same column keeps the same stage across edits — the engine records the
// stage a card stands on, and a regenerated id would lose it.
export function nodeId(column: BoardColumn): string {
    return column.optionId || column.name
}

// withColumn puts a column on the route, if it is not on it already. A stage
// added this way overrides nothing: it does whatever its column does.
export function withColumn(flow: Flow, column: BoardColumn, at?: {x: number, y: number}): Flow {
    if (nodeFor(flow, column)) {
        return flow
    }
    const node: FlowNode = {
        id: nodeId(column),
        column: column.name,
        optionId: column.optionId,
        action: '',
        ...(at || {}),
    }
    return {...flow, nodes: [...flow.nodes, node]}
}

// withoutColumn takes a stage off the route, and its transitions with it: an
// edge to nowhere is exactly what the engine refuses to save.
export function withoutColumn(flow: Flow, id: string): Flow {
    return {
        ...flow,
        nodes: flow.nodes.filter((n) => n.id !== id),
        edges: flow.edges.filter((e) => e.from !== id && e.to !== id),
    }
}

// withNode changes one stage of a route.
export function withNode(flow: Flow, id: string, patch: Partial<FlowNode>): Flow {
    return {...flow, nodes: flow.nodes.map((n) => (n.id === id ? {...n, ...patch} : n))}
}

// Edges are addressed by their index in the flow: with conditions, several may
// share one (from, on), so the pair stops being an identity.

// edgeTarget is the stage an event leads to unconditionally, or '' when the
// graph says nothing — the fallback edge, in engine terms.
export function edgeTarget(edges: FlowEdge[], from: string, on: string): string {
    return edges.find((e) => e.from === from && e.on === on && !e.if)?.to || ''
}

// outgoing is everything a stage leads to, with the index each edge is edited
// by — outcomes first, which is the order a person reads them in.
export function outgoing(edges: FlowEdge[], from: string): Array<{edge: FlowEdge, index: number}> {
    const rank = (on: string) => {
        const at = OUTCOMES.indexOf(on)
        return at < 0 ? OUTCOMES.length : at
    }
    return edges.
        map((edge, index) => ({edge, index})).
        filter(({edge}) => edge.from === from).
        sort((a, b) => (rank(a.edge.on) - rank(b.edge.on)) || (a.index - b.index))
}

// withEdge changes one transition of a route.
export function withEdge(flow: Flow, index: number, patch: Partial<FlowEdge>): Flow {
    return {...flow, edges: flow.edges.map((e, i) => (i === index ? {...e, ...patch} : e))}
}

// withoutEdge removes one transition.
export function withoutEdge(flow: Flow, index: number): Flow {
    return {...flow, edges: flow.edges.filter((_, i) => i !== index)}
}

// condIsComplete says the condition can actually decide something — the engine
// refuses half-filled ones, so the editor keeps them out of what it saves.
export function condIsComplete(cond: EdgeCond | undefined): boolean {
    if (!cond) {
        return true
    }
    if (cond.commentContains) {
        return !cond.property && !cond.value
    }
    return Boolean(cond.property && cond.value)
}

// columnsOf lists the columns a route goes through, in the board's own order —
// the route reads the way the board does.
export function columnsOf(flow: Flow | undefined, columns: BoardColumn[]): BoardColumn[] {
    return columns.filter((c) => Boolean(nodeFor(flow, c)))
}

// AutomationChanges is what has to be written to make the registry look like
// the draft. Routes are keyed by name, so a renamed route is a new one and the
// old is dropped — which is also what happens to the cards that named it.
export type AutomationChanges = {
    savedColumns: ColumnSpec[]
    removedColumns: ColumnSpec[]
    addedFlows: Flow[]
    updatedFlows: Flow[]
    removedFlows: Flow[]
}

export function automationChanges(before: Automation, after: Automation): AutomationChanges {
    const sameFlowName = (a: Flow, b: Flow) => a.name.trim().toLowerCase() === b.name.trim().toLowerCase()
    return {
        savedColumns: after.columns.filter((c) => {
            const was = before.columns.find((b) => sameColumn(b, c))
            return !was || JSON.stringify(was) !== JSON.stringify(c)
        }),
        removedColumns: before.columns.filter((c) => !after.columns.some((n) => sameColumn(n, c))),
        addedFlows: after.flows.filter((f) => !before.flows.some((b) => sameFlowName(b, f))),
        updatedFlows: after.flows.filter((f) => {
            const was = before.flows.find((b) => sameFlowName(b, f))
            return Boolean(was) && JSON.stringify(was) !== JSON.stringify(f)
        }),
        removedFlows: before.flows.filter((f) => !after.flows.some((n) => sameFlowName(n, f))),
    }
}

// The board properties a template carries its automation in — the same names Go
// reads (internal/acp/boardseed.go). A board made from the template brings them,
// and the first look at it takes them into the registry.
export const BOARD_PROP_COLUMNS = 'xciiiColumns'
export const BOARD_PROP_FLOWS = 'xciiiFlows'
export const BOARD_PROP_SETUP = 'xciiiSetup'

// What this board's agents are told first. Nothing here writes it — the page
// asks Go for it (GetBoardPrompt/SetBoardPrompt) and Go keeps it on the board —
// but it is named here because it is one of the keys a template carries, and
// anything that rebuilds a board's properties has to leave it alone.
export const BOARD_PROP_PROMPT = 'xciiiPrompt'

// How this board works in a folder that is a repository — a copy per card, or
// a branch in the folder itself. Nothing here writes it either (GetBoardGit/
// SetBoardGit), and it is named for the same reason the prompt is: a template
// carries it, and a save must leave it alone.
export const BOARD_PROP_GIT = 'xciiiGit'

// Which card property holds the folders, by id. A name would have been a
// worse answer twice over: the field is a person's to rename, and the name
// this app gives it is Russian, so a board in any other language could only
// ever have been matched by luck.
export const BOARD_PROP_PROJECT_PROPERTY = 'xciiiProjectProperty'

// And which one holds the branch a card's work is on, by id for the same
// reason. Go writes into it (workspace.go); the page is what creates it,
// because the board's card properties are the page's to patch.
export const BOARD_PROP_BRANCH_PROPERTY = 'xciiiBranchProperty'

// boardBranchProperty is the id of that field, or '' for a board without one.
export function boardBranchProperty(board: {properties?: Record<string, unknown>}): string {
    const recorded = board.properties?.[BOARD_PROP_BRANCH_PROPERTY]
    return typeof recorded === 'string' ? recorded : ''
}

// What these keys were called before. Every board made until now carries them,
// so they are read; they are never written, and a save drops them (see
// boardAutomationProperties), which is the same migration Go does.
//
// The prefix was `acp`, which claimed the agent integration owns all of this.
// It does not: a route can be made entirely of deterministic transitions — a
// branch merged, a card property changed — with no agent in it anywhere.
const LEGACY_BOARD_PROPS: Record<string, string> = {
    [BOARD_PROP_COLUMNS]: 'acpColumns',
    [BOARD_PROP_FLOWS]: 'acpFlows',
    [BOARD_PROP_SETUP]: 'acpSetup',
    [BOARD_PROP_PROMPT]: 'acpPrompt',
    [BOARD_PROP_PROJECT_PROPERTY]: 'acpProjectProperty',
}

// legacyBoardProp is the old name of a key, for reading and for dropping.
export function legacyBoardProp(key: string): string | undefined {
    return LEGACY_BOARD_PROPS[key]
}

// BoardSetupStep is one question the template asks the machine when a board is
// made from it. Only the kind and the order are the template's to choose: what
// each step does is the app's, so a template can never ask for something no
// registry can hold.
export type BoardSetupStep = {
    kind: string
    hint?: string
    required?: boolean
}

export type BoardSetup = {
    steps: BoardSetupStep[]
}

// SetupStepDef is a step this build can carry out, as Go lists them.
export type SetupStepDef = {
    kind: string
    registry?: string
    optional: boolean
}

function readProperty<T>(board: Board, key: string, fallback: T): T {
    const properties = board.properties || {}
    const legacy = legacyBoardProp(key)
    const raw = properties[key] ?? (legacy ? properties[legacy] : undefined)
    if (raw === undefined || raw === null || raw === '') {
        return fallback
    }
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw) as T
        } catch {
            return fallback
        }
    }
    return raw as unknown as T
}

// readBoardAutomation is what a template board carries. A template is not run,
// so its own properties are the whole truth about it — unlike a live board,
// whose automation lives in the registry the moment it is first opened.
export function readBoardAutomation(board: Board): Automation {
    return {
        columns: readProperty<ColumnSpec[]>(board, BOARD_PROP_COLUMNS, []),
        flows: readProperty<Flow[]>(board, BOARD_PROP_FLOWS, []),
    }
}

export function readBoardSetup(board: Board): BoardSetup | undefined {
    const setup = readProperty<BoardSetup | undefined>(board, BOARD_PROP_SETUP, undefined)
    return setup && Array.isArray(setup.steps) ? setup : undefined
}

// writeBoardAutomation returns the board's properties with the automation in
// them. They are written as JSON text rather than as objects because that is
// what the board's property map is typed to hold, and Go reads either.
export function boardAutomationProperties(
    board: Board,
    automation: Automation,
    setup: BoardSetup | undefined,
): Record<string, string | string[]> {
    const properties = {...(board.properties || {})}

    // A board written by this app carries the current names only. Dropping the
    // old ones here is what migrates a board saved as a template: mutator's
    // patch turns a key that is gone into a deletedProperties entry.
    for (const key of Object.keys(LEGACY_BOARD_PROPS)) {
        const legacy = legacyBoardProp(key)
        if (legacy && properties[legacy] !== undefined && properties[key] === undefined) {
            properties[key] = properties[legacy]
        }
        if (legacy) {
            delete properties[legacy]
        }
    }

    properties[BOARD_PROP_COLUMNS] = JSON.stringify(automation.columns)
    properties[BOARD_PROP_FLOWS] = JSON.stringify(automation.flows)
    if (setup) {
        properties[BOARD_PROP_SETUP] = JSON.stringify(setup)
    } else {
        delete properties[BOARD_PROP_SETUP]
    }
    return properties
}

// impliedSetupSteps is what the app would ask for if the template said nothing
// — the same reasoning as Go's impliedSetup, and only ever used to fill the
// editor in when somebody chooses to name the steps by hand. Nothing runs off
// this copy: an undeclared template is still resolved on the Go side.
export function impliedSetupSteps(automation: Automation, defs: SetupStepDef[]): BoardSetupStep[] {
    const actions = new Set<string>()
    for (const column of automation.columns) {
        actions.add(column.action)
    }
    for (const flow of automation.flows) {
        for (const node of flow.nodes) {
            if (node.action) {
                actions.add(node.action)
            }
        }
    }
    const wanted = (kind: string) => {
        switch (kind) {
        case 'deploy':
            return actions.has('deploy')
        case 'browser':
            return actions.has('test')

        // Never implied, mirroring the Go side (impliedSetup in setup.go): no
        // arrangement of columns says cards should arrive by themselves. A
        // template that wants the step declares it by hand.
        case 'source':
            return false
        default:
            return true
        }
    }
    return defs.filter((d) => wanted(d.kind)).map((d) => ({kind: d.kind}))
}

// routeOptionMissing says the board has no option a card could name this route
// with. A route nothing can be put on is the commonest way an editor's work
// disappears: the graph saves, the cards never take it.
export function routeOptionMissing(board: Board, flow: Flow): boolean {
    const name = flow.name.trim().toLowerCase()
    if (!name) {
        return false
    }
    return !selectProperties(board).some((p) =>
        (p.options || []).some((o) => o.value.trim().toLowerCase() === name))
}
