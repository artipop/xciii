import {For, Show, createEffect, createMemo, createSignal} from 'solid-js'

import {useIntl, IntlShape} from '../../intl'

import {IPropertyTemplate} from '../../blocks/board'
import Button from '../../widgets/buttons/button'
import Select from '../../widgets/select'
import CompassIcon from '../../widgets/icons/compassIcon'

import FlowDiagram, {BLOCK_DRAG_TYPE, NODE_HEIGHT, NODE_WIDTH, StageCount, condLabel, edgeId, edgeIndexOf, stageLabel} from './flowDiagram'
import {
    ACTIONS,
    Automation,
    BoardColumn,
    CARD_CHANGED,
    ColumnSpec,
    Flow,
    FlowEdge,
    FlowNode,
    FlowTrigger,
    OUTCOMES,
    PropertyWrite,
    SUCCESS,
    blankSpec,
    columnsOf,
    nodeFor,
    outgoing,
    specFor,
    unwrittenConditions,
    upsertSpec,
    withColumn,
    withEdge,
    withNode,
    withoutColumn,
    withoutEdge,
} from './automation'

import './automationEditor.scss'

// The board's automation on one screen: the columns as they are on the board,
// the routes drawn over them, and one panel that edits whichever of the two is
// selected.
//
// It replaces two dialogs that each held half the answer — a column's settings
// on the board and a route's graph in a menu — because the question a person
// actually has is neither half: "what happens to a card here, and where does it
// go next". Both halves are now the same picture.
//
// Nothing here loads or saves. A live board hands it the registry, a template
// hands it its own properties, and both get back the whole automation to write.

type Named = {name: string}

type Props = {
    boardId: string

    // The select property the columns are options of, and the others a board
    // could be organised by instead.
    property?: IPropertyTemplate
    properties: IPropertyTemplate[]

    // Every property of the board — what a stage's writes and reads pick from.
    // Broader than `properties` on purpose: a preview URL wants a text field.
    allProperties?: IPropertyTemplate[]
    columns: BoardColumn[]

    automation: Automation
    triggers: FlowTrigger[]
    agents: Named[]
    deploys: Named[]

    // counts is where the board's cards actually stand, per route. Only a live
    // board has any; a template is a drawing.
    counts?: Record<string, StageCount[]>

    // worktrees says sessions get a worktree each, which is what lets a crew
    // work one column at the same time.
    worktrees?: boolean

    // The column the editor opens on — set when it was opened from that
    // column's own menu, so the answer is already on screen.
    focusColumnId?: string

    onChange: (next: Automation) => void
    onPropertyChange?: (property: IPropertyTemplate) => void

    // A column is the board's, not the automation's: making or renaming one
    // changes the board itself, which is why the editor asks rather than does.
    // onCreateColumn returns the created column, so a block dropped on the
    // canvas can become a stage without waiting for the board to come back.
    onCreateColumn?: (name: string) => Promise<BoardColumn | undefined>
    onRenameColumn?: (column: BoardColumn, name: string) => Promise<void>

    // onAddRouteOption puts the route's name among the options a card can name
    // it with. Without one, the route is drawn and never taken.
    onAddRouteOption?: (flow: Flow) => void
    routeOptionMissing?: (flow: Flow) => boolean

    // Registering an agent is the container's business — this editor knows
    // nothing about Go. Left out where there is nothing to register into: a
    // template is edited on a machine it will never run on.
    onAddAgent?: () => void
}

type Selection = {kind: 'node' | 'edge', id: string} | null

// COLUMNS_VIEW is the canvas with no route on it: what each column does, which
// is the half of the answer that holds for every card.
const COLUMNS_VIEW = ''

// How many columns stand in a row when there is no route to lay them out by.
const COLUMNS_PER_ROW = 5

// What a new column can be made as. 'none' is a plain column — a place cards
// stand, nothing runs.
const PALETTE = ['agent', 'deploy', 'test', 'none']

// promptPreview is the column's instructions squeezed into a placeholder: just
// enough to say what "as the column" would mean here.
const promptPreview = (prompt: string): string => {
    const line = prompt.split('\n')[0].trim()
    return line.length > 60 ? line.slice(0, 60) + '…' : line
}

const AutomationEditor = (props: Props) => {
    const intl = useIntl()
    const [route, setRoute] = createSignal(COLUMNS_VIEW)

    // Whether the tab on screen is the one somebody asked for. Until it is, the
    // editor may still move off the columns view by itself (below).
    const [picked, setPicked] = createSignal(false)
    const showRoute = (name: string) => {
        setPicked(true)
        setRoute(name)
    }
    const [selected, setSelected] = createSignal<Selection>(
        props.focusColumnId ? {kind: 'node', id: props.focusColumnId} : null,
    )

    const flows = () => props.automation.flows
    const specs = () => props.automation.columns
    const flow = () => flows().find((f) => f.name === route())
    const waitTriggers = createMemo(() => props.triggers.filter((t) => t.source !== 'outcome'))

    // The stages on the canvas: the route's, or one box per column when no
    // route is chosen — the columns view is the same picture without arrows.
    const nodes = createMemo<FlowNode[]>(() => {
        const current = flow()
        if (current) {
            return current.nodes
        }

        // With no route there are no arrows to lay the columns out by, and a
        // graph layout would stack all ten in one tall column. A grid in the
        // board's own order reads the way the board does.
        return props.columns.map((c, i) => ({
            id: c.optionId || c.name,
            column: c.name,
            optionId: c.optionId,
            action: '',
            x: (i % COLUMNS_PER_ROW) * (NODE_WIDTH + 40),
            y: Math.floor(i / COLUMNS_PER_ROW) * (NODE_HEIGHT + 28),
        }))
    })

    const edges = () => flow()?.edges || []

    // The screen opens on a route rather than on the bare columns, once the
    // routes have arrived. The arrows are what somebody came here to read, and
    // ten boxes with nothing drawn between them read as a route that failed to
    // draw rather than as a different view of the same board. The columns are
    // one tab away — and they are still what a click on a column's own badge
    // opens, because that click is about one column and not about a route.
    createEffect(() => {
        const first = flows()[0]
        if (first && !picked() && !props.focusColumnId) {
            setRoute(first.name)
        }
    })

    // Columns the route does not go through are still on the canvas — faded.
    const spare = createMemo(() => (flow() ? props.columns.filter((c) => !nodeFor(flow(), c)) : []))

    const columnOf = (node: FlowNode): BoardColumn | undefined =>
        props.columns.find((c) => (node.optionId && c.optionId === node.optionId) ||
            c.name.toLowerCase() === node.column.toLowerCase())

    const specOf = (node: FlowNode): ColumnSpec | undefined => {
        const column = columnOf(node)
        return column ? specFor(specs(), column) : undefined
    }

    // What a stage does is the column's business unless the stage says
    // otherwise — the same order the engine resolves it in.
    const actionOf = (node: FlowNode) => node.action || specOf(node)?.action || 'none'
    const crewOf = (node: FlowNode) => (node.agentNames?.length ? node.agentNames : specOf(node)?.agents) || []

    const selectedNode = () => {
        const current = selected()
        return current?.kind === 'node' ? nodes().find((n) => n.id === current.id) : undefined
    }

    // An edge is addressed by its index in the route; the canvas id carries it.
    const selectedEdgeIndex = (): number => {
        const current = selected()
        if (current?.kind !== 'edge') {
            return -1
        }
        const index = edgeIndexOf(current.id)
        const edge = edges()[index]
        return edge && edgeId(edge, index) === current.id ? index : -1
    }

    const selectedEdge = () => edges()[selectedEdgeIndex()]

    const updateFlow = (name: string, patch: (f: Flow) => Flow) => {
        props.onChange({...props.automation, flows: flows().map((f) => (f.name === name ? patch(f) : f))})
    }

    const updateSpec = (column: BoardColumn, patch: Partial<ColumnSpec>, base?: Automation) => {
        const automation = base || props.automation
        const current = specFor(automation.columns, column) || blankSpec(props.boardId, props.property, column)
        props.onChange({
            ...automation,
            columns: upsertSpec(automation.columns, {
                ...current,
                ...patch,
                boardId: props.boardId,
                propertyId: props.property?.id || current.propertyId,
                property: props.property?.name || current.property,
                column: column.name,
                optionId: column.optionId,
            }),
        })
    }

    const updateNodeSpec = (node: FlowNode, patch: Partial<ColumnSpec>) => {
        const column = columnOf(node)
        if (column) {
            updateSpec(column, patch)
        }
    }

    const onCanvasChange = (nextNodes: FlowNode[], nextEdges: FlowEdge[]) => {
        const current = flow()
        if (!current) {
            return
        }
        updateFlow(current.name, (f) => ({...f, nodes: nextNodes, edges: nextEdges}))
    }

    const addColumnToRoute = (column: BoardColumn, at?: {x: number, y: number}) => {
        const current = flow()
        if (!current) {
            return
        }
        updateFlow(current.name, (f) => withColumn(f, column, at))
        setSelected({kind: 'node', id: column.optionId || column.name})
    }

    // A new column of the board, doing what the button said, standing where it
    // was dropped — or wherever the layout puts it, when it was clicked rather
    // than dragged.
    const dropBlock = async (kind: string, at?: {x: number, y: number}) => {
        if (!props.onCreateColumn) {
            return
        }
        const taken = new Set(props.columns.map((c) => c.name.toLowerCase()))
        let name = blockName(intl, kind)
        for (let n = 2; taken.has(name.toLowerCase()); n++) {
            name = `${blockName(intl, kind)} ${n}`
        }
        const column = await props.onCreateColumn(name)
        if (!column) {
            return
        }

        // One onChange for the whole outcome: the spec (what the column does)
        // and, on a route, the stage standing where the block landed.
        let next = props.automation
        const current = flow()
        if (current) {
            next = {
                ...next,
                flows: next.flows.map((f) => (f.name === current.name ? withColumn(f, column, at) : f)),
            }
        }
        if (kind === 'none') {
            props.onChange(next)
        } else {
            updateSpec(column, {action: kind}, next)
        }
        setSelected({kind: 'node', id: column.optionId || column.name})
    }

    const removeFromRoute = (node: FlowNode) => {
        const current = flow()
        if (!current) {
            return
        }
        updateFlow(current.name, (f) => withoutColumn(f, node.id))
        setSelected(null)
    }

    const patchEdge = (index: number, patch: Partial<FlowEdge>) => {
        const current = flow()
        if (!current) {
            return
        }
        updateFlow(current.name, (f) => withEdge(f, index, patch))
        const selection = selected()
        if (selection?.kind === 'edge' && edgeIndexOf(selection.id) === index) {
            const edge = {...current.edges[index], ...patch}
            setSelected({kind: 'edge', id: edgeId(edge, index)})
        }
    }

    const dropEdge = (index: number) => {
        const current = flow()
        if (!current) {
            return
        }
        updateFlow(current.name, (f) => withoutEdge(f, index))
        if (selected()?.kind === 'edge') {
            setSelected(null)
        }
    }

    const addTransition = (node: FlowNode) => {
        const current = flow()
        if (!current) {
            return
        }
        const used = new Set(outgoing(current.edges, node.id).map(({edge}) => edge.on))
        const kind = [...OUTCOMES, ...waitTriggers().map((t) => t.kind)].
            find((k) => k !== CARD_CHANGED && !used.has(k)) || SUCCESS
        const target = current.nodes.find((n) => n.id !== node.id)
        if (!target) {
            return
        }
        updateFlow(current.name, (f) => ({...f, edges: [...f.edges, {from: node.id, to: target.id, on: kind}]}))
        setSelected({kind: 'edge', id: edgeId({from: node.id, to: target.id, on: kind}, current.edges.length)})
    }

    // A fork: a second edge on the same event, told apart by its condition. The
    // condition starts empty and the panel opens on it — an empty condition is
    // exactly what the engine refuses, so it has to be filled to be saved.
    const addBranch = (index: number) => {
        const current = flow()
        const edge = current?.edges[index]
        if (!current || !edge) {
            return
        }
        const branch: FlowEdge = {...edge, if: {property: '', value: ''}}
        updateFlow(current.name, (f) => ({...f, edges: [...f.edges, branch]}))
        setSelected({kind: 'edge', id: edgeId(branch, current.edges.length)})
    }

    const addRoute = () => {
        const name = intl.formatMessage({id: 'Automation.new-route-name', defaultMessage: 'New route'})
        const taken = new Set(flows().map((f) => f.name.toLowerCase()))
        let unique = name
        for (let n = 2; taken.has(unique.toLowerCase()); n++) {
            unique = `${name} ${n}`
        }

        // A new route starts on the column an agent works in, if the board has
        // one: an empty canvas is a question, and this is the answer to it that
        // is right nearly every time.
        const working = props.columns.find((c) => specFor(specs(), c)?.action === 'agent')
        const blank: Flow = {
            name: unique,
            boardId: props.boardId,
            property: props.property?.name,
            nodes: [],
            edges: [],
        }
        props.onChange({...props.automation, flows: [...flows(), working ? withColumn(blank, working) : blank]})
        showRoute(unique)
        setSelected(null)
    }

    const renameRoute = (from: string, to: string) => {
        props.onChange({...props.automation, flows: flows().map((f) => (f.name === from ? {...f, name: to} : f))})
        showRoute(to)
    }

    const removeRoute = (name: string) => {
        props.onChange({...props.automation, flows: flows().filter((f) => f.name !== name)})
        showRoute(COLUMNS_VIEW)
        setSelected(null)
    }

    // Renaming a column happens on the board (through the container) and in the
    // draft at once: the specs and stages that name it must follow, or the
    // engine would look for a column that no longer exists.
    const renameColumn = async (node: FlowNode, name: string) => {
        const column = columnOf(node)
        if (!column || !name.trim() || name.trim() === column.name) {
            return
        }
        const trimmed = name.trim()
        await props.onRenameColumn?.(column, trimmed)
        props.onChange({
            ...props.automation,
            columns: specs().map((s) => (s.optionId === column.optionId ? {...s, column: trimmed} : s)),
            flows: flows().map((f) => ({
                ...f,
                nodes: f.nodes.map((n) => (n.optionId === column.optionId ? {...n, column: trimmed} : n)),
            })),
        })
    }

    const stageTargets = () => nodes().filter((n) => n.id !== selectedNode()?.id)

    // The select properties a condition may ask about. The route's own column
    // property is excluded: a change of that is a move, not a mark.
    const condProperties = () => props.properties.filter((p) => p.name !== (flow()?.property || props.property?.name))

    // Who works something, ticked off the registry. One component for both
    // answers a stage has — the column's crew and the stage's own — because
    // they are the same question asked of two owners, and two hand-written
    // lists are how the two drifted apart.
    const crewPicker = (
        label: string,
        chosen: () => string[],
        write: (next: string[]) => void,
        note?: () => string,
    ) => (
        <div class='AutomationEditor__crew'>
            <span class='AutomationEditor__label'>{label}</span>
            <Show when={props.agents.length === 0}>
                <span class='AutomationEditor__hint'>
                    {intl.formatMessage({id: 'Automation.no-agents', defaultMessage: 'No agents registered yet.'})}
                </span>
            </Show>
            <For each={props.agents}>
                {(a) => (
                    <label class='AutomationEditor__agent'>
                        <input
                            type='checkbox'
                            checked={chosen().includes(a.name)}
                            onChange={() => {
                                const crew = chosen()
                                write(crew.includes(a.name) ? crew.filter((n) => n !== a.name) : [...crew, a.name])
                            }}
                        />
                        {a.name}
                    </label>
                )}
            </For>
            <Show when={note?.()}>
                <span class='AutomationEditor__hint'>{note?.()}</span>
            </Show>

            {/* Registering one is two answers, and asking them here beats
                sending somebody to the settings and back with the stage
                half-configured. */}
            <Show when={props.onAddAgent}>
                <button
                    type='button'
                    class='AutomationEditor__addAgent'
                    onClick={() => props.onAddAgent?.()}
                >
                    {intl.formatMessage({id: 'Automation.add-agent', defaultMessage: 'Add an agent…'})}
                </button>
            </Show>
        </div>
    )

    // What an unticked stage crew means: the column's answer, named. Nothing to
    // say on a board where no agent is registered — the picker says that
    // already.
    const columnCrewNote = (node: FlowNode): string => {
        if (props.agents.length === 0) {
            return ''
        }
        const crew = specOf(node)?.agents || []
        if (crew.length === 0) {
            return intl.formatMessage({id: 'Automation.crew-column-none', defaultMessage: 'Nobody ticked, and the column names nobody either — whoever the board has will take it.'})
        }
        return intl.formatMessage(
            {id: 'Automation.crew-column', defaultMessage: 'Nobody ticked — the column’s crew works it: {crew}'},
            {crew: crew.join(', ')},
        )
    }

    // The properties a stage may write or read: every board property except the
    // column one — moving between columns is the route's own business.
    const dataProperties = () =>
        (props.allProperties || []).filter((p) => p.id !== props.property?.id).map((p) => p.name)

    // writesPicker edits a stage's declared outputs. For an agent stage each row
    // is a property plus «обязательно» — finish_work is refused without a
    // required one; a deploy or test stage writes one machine value (the
    // preview URL, the verdict), so it gets a single picker under the action's
    // own label. `note` names the inherited answer, the crew picker's shape.
    const writesPicker = (
        action: string,
        value: () => PropertyWrite[],
        write: (next: PropertyWrite[] | undefined) => void,
        note?: () => string,
    ) => {
        const machine = action === 'deploy' || action === 'test'
        let label = intl.formatMessage({id: 'Automation.writes', defaultMessage: 'Writes onto the card'})
        if (action === 'deploy') {
            label = intl.formatMessage({id: 'Automation.writes-deploy', defaultMessage: 'Preview address goes to the property'})
        } else if (action === 'test') {
            label = intl.formatMessage({id: 'Automation.writes-test', defaultMessage: 'Verdict goes to the property'})
        }
        const free = () => dataProperties().filter((name) => !value().some((w) => w.property === name))
        return (
            <div class='AutomationEditor__writes'>
                <span class='AutomationEditor__label'>{label}</span>
                <Show when={!machine}>
                    <For each={value()}>
                        {(w, i) => (
                            <div class='AutomationEditor__writeRow'>
                                <span class='AutomationEditor__writeName'>{w.property}</span>
                                <label class='AutomationEditor__writeRequired'>
                                    <input
                                        type='checkbox'
                                        checked={Boolean(w.required)}
                                        onChange={(e) => {
                                            const next = value().slice()
                                            next[i()] = {...w, required: e.currentTarget.checked || undefined}
                                            write(next)
                                        }}
                                    />
                                    {intl.formatMessage({id: 'Automation.write-required', defaultMessage: 'required'})}
                                </label>
                                <button
                                    type='button'
                                    class='AutomationEditor__writeRemove'
                                    title={intl.formatMessage({id: 'Automation.write-remove', defaultMessage: 'Remove'})}
                                    aria-label={intl.formatMessage({id: 'Automation.write-remove', defaultMessage: 'Remove'})}
                                    onClick={() => {
                                        const next = value().filter((_, at) => at !== i())
                                        write(next.length > 0 ? next : undefined)
                                    }}
                                >
                                    <CompassIcon icon='close'/>
                                </button>
                            </div>
                        )}
                    </For>
                </Show>
                <Select
                    value={machine ? (value()[0]?.property || '') : ''}
                    options={[
                        {value: '', label: machine ? intl.formatMessage({id: 'Automation.writes-nowhere', defaultMessage: '— nowhere —'}) : intl.formatMessage({id: 'Automation.writes-add', defaultMessage: '+ property…'})},
                        ...(machine ? dataProperties() : free()).map((name) => ({value: name, label: name})),
                    ]}
                    onChange={(name) => {
                        if (machine) {
                            write(name ? [{property: name}] : undefined)
                            return
                        }
                        if (name) {
                            write([...value(), {property: name}])
                        }
                    }}
                    label={label}
                />
                <Show when={note && note()}>
                    <span class='AutomationEditor__hint'>{note!()}</span>
                </Show>
            </div>
        )
    }

    // readsPicker is the mirror: what the stage is handed on the way in.
    const readsPicker = (
        value: () => string[],
        write: (next: string[] | undefined) => void,
        note?: () => string,
    ) => {
        const free = () => dataProperties().filter((name) => !value().includes(name))
        return (
            <div class='AutomationEditor__writes'>
                <span class='AutomationEditor__label'>
                    {intl.formatMessage({id: 'Automation.reads', defaultMessage: 'Gets from the card'})}
                </span>
                <For each={value()}>
                    {(name) => (
                        <div class='AutomationEditor__writeRow'>
                            <span class='AutomationEditor__writeName'>{name}</span>
                            <button
                                type='button'
                                class='AutomationEditor__writeRemove'
                                title={intl.formatMessage({id: 'Automation.write-remove', defaultMessage: 'Remove'})}
                                aria-label={intl.formatMessage({id: 'Automation.write-remove', defaultMessage: 'Remove'})}
                                onClick={() => {
                                    const next = value().filter((n) => n !== name)
                                    write(next.length > 0 ? next : undefined)
                                }}
                            >
                                <CompassIcon icon='close'/>
                            </button>
                        </div>
                    )}
                </For>
                <Select
                    value={''}
                    options={[
                        {value: '', label: intl.formatMessage({id: 'Automation.writes-add', defaultMessage: '+ property…'})},
                        ...free().map((name) => ({value: name, label: name})),
                    ]}
                    onChange={(name) => name && write([...value(), name])}
                    label={intl.formatMessage({id: 'Automation.reads', defaultMessage: 'Gets from the card'})}
                />
                <Show when={note && note()}>
                    <span class='AutomationEditor__hint'>{note!()}</span>
                </Show>
            </div>
        )
    }

    const deployPicker = (value: () => string, write: (next: string) => void, blank: string) => (
        <>
            <label>
                {intl.formatMessage({id: 'Automation.deploy', defaultMessage: 'Deploy target'})}
                <Select
                    value={value()}
                    options={[
                        {value: '', label: blank},
                        ...props.deploys.map((d) => ({value: d.name, label: d.name})),
                    ]}
                    onChange={write}
                    label={intl.formatMessage({id: 'Automation.deploy', defaultMessage: 'Deploy target'})}
                />
            </label>

            {/* The registry moved out of the app's settings, and this select is
                exactly where somebody discovers it is empty — so this is where
                the way to it is said. */}
            <Show when={props.deploys.length === 0}>
                <span class='AutomationEditor__hint'>
                    {intl.formatMessage({id: 'Automation.no-deploys', defaultMessage: 'No deploy targets yet — the board’s ⋯ menu, "Where to deploy".'})}
                </span>
            </Show>
        </>
    )

    // The condition editor, shared by the node panel's rows and the edge panel:
    // one select for the kind of question, then the question's own fields.
    const condEditor = (index: number, edge: FlowEdge) => {
        const cond = edge.if
        const isOutcome = OUTCOMES.includes(edge.on)
        const kind = () => {
            if (!cond) {
                return 'always'
            }
            return cond.commentContains === undefined ? 'property' : 'comment'
        }
        const setKind = (next: string) => {
            switch (next) {
            case 'always':
                patchEdge(index, {if: undefined})
                break
            case 'comment':
                patchEdge(index, {if: {commentContains: ''}})
                break
            default:
                patchEdge(index, {if: {property: condProperties()[0]?.name || '', value: ''}})
            }
        }
        const condProperty = () => condProperties().find((p) => p.name === cond?.property)

        return (
            <div class='AutomationEditor__cond'>
                <Show when={edge.on !== CARD_CHANGED}>
                    <Select
                        value={kind()}
                        options={[
                            {value: 'always', label: intl.formatMessage({id: 'Automation.cond-always', defaultMessage: 'always'})},
                            {value: 'property', label: intl.formatMessage({id: 'Automation.cond-property', defaultMessage: 'only if the card has…'})},
                            ...(isOutcome ? [{value: 'comment', label: intl.formatMessage({id: 'Automation.cond-comment', defaultMessage: 'only if the agent wrote…'})}] : []),
                        ]}
                        onChange={setKind}
                        label={intl.formatMessage({id: 'Automation.cond-when', defaultMessage: 'Condition'})}
                    />
                </Show>

                <Show when={kind() === 'property' || edge.on === CARD_CHANGED}>
                    <div class='AutomationEditor__condFields'>
                        <Select
                            value={cond?.property || ''}
                            options={[
                                {value: '', label: intl.formatMessage({id: 'Automation.cond-pick-property', defaultMessage: '— property —'})},
                                ...condProperties().map((p) => ({value: p.name, label: p.name})),
                            ]}
                            onChange={(next) => patchEdge(index, {if: {property: next, value: ''}})}
                            label={intl.formatMessage({id: 'Automation.cond-pick-property', defaultMessage: '— property —'})}
                        />
                        <span class='AutomationEditor__arrow'>{'='}</span>
                        <Select
                            value={cond?.value || ''}
                            options={[
                                {value: '', label: intl.formatMessage({id: 'Automation.cond-pick-value', defaultMessage: '— value —'})},
                                ...(condProperty()?.options || []).map((o) => ({value: o.value, label: o.value})),
                            ]}
                            onChange={(next) => patchEdge(index, {if: {property: cond?.property || '', value: next}})}
                            label={intl.formatMessage({id: 'Automation.cond-pick-value', defaultMessage: '— value —'})}
                        />
                    </div>
                </Show>

                <Show when={kind() === 'comment' && edge.on !== CARD_CHANGED}>
                    <input
                        value={cond?.commentContains || ''}
                        placeholder={intl.formatMessage({id: 'Automation.cond-comment-placeholder', defaultMessage: 'text in the agent’s closing comment'})}
                        onInput={(e) => patchEdge(index, {if: {commentContains: e.currentTarget.value}})}
                    />
                </Show>
            </div>
        )
    }

    return (
        <div class='AutomationEditor'>
            <div class='AutomationEditor__routes'>
                <button
                    type='button'
                    class={`AutomationEditor__route${route() === COLUMNS_VIEW ? ' AutomationEditor__route--active' : ''}`}
                    onClick={() => {
                        showRoute(COLUMNS_VIEW)
                        setSelected(null)
                    }}
                >
                    {intl.formatMessage({id: 'Automation.columns-view', defaultMessage: 'Columns'})}
                </button>
                <For each={flows()}>
                    {(f) => (
                        <button
                            type='button'
                            class={`AutomationEditor__route${route() === f.name ? ' AutomationEditor__route--active' : ''}`}
                            onClick={() => {
                                showRoute(f.name)
                                setSelected(null)
                            }}
                        >
                            {f.name}
                        </button>
                    )}
                </For>
                <button
                    type='button'
                    class='AutomationEditor__route AutomationEditor__route--add'
                    onClick={addRoute}
                >
                    {intl.formatMessage({id: 'Automation.add-route', defaultMessage: '+ route'})}
                </button>

                <Show when={props.properties.length > 1}>
                    <Select
                        class='AutomationEditor__property'
                        value={props.property?.name || ''}
                        options={props.properties.map((p) => ({value: p.name, label: p.name}))}
                        onChange={(name) => {
                            const next = props.properties.find((p) => p.name === name)
                            if (next) {
                                props.onPropertyChange?.(next)
                            }
                        }}
                        label={intl.formatMessage({id: 'Automation.property', defaultMessage: 'Columns are'})}
                    />
                </Show>
            </div>

            {/* Making a column is one line above the canvas rather than a
                column of blocks beside it: what each kind does is a sentence
                the panel says anyway, and repeating it four times took a sixth
                of the screen the picture is for. Clicking adds the column;
                dragging still places it where it lands. */}
            <Show when={props.onCreateColumn}>
                <div class='AutomationEditor__add'>
                    <span class='AutomationEditor__label'>
                        {intl.formatMessage({id: 'Automation.palette', defaultMessage: 'Add a column'})}
                    </span>
                    <For each={PALETTE}>
                        {(kind) => (
                            <button
                                type='button'
                                class={`AutomationEditor__block AutomationEditor__block--${kind}`}
                                draggable={true}
                                data-block={kind}
                                title={actionLabel(intl, kind)}
                                onDragStart={(e) => {
                                    e.dataTransfer?.setData(BLOCK_DRAG_TYPE, kind)
                                }}
                                onClick={() => dropBlock(kind)}
                            >
                                {blockName(intl, kind)}
                            </button>
                        )}
                    </For>
                </div>
            </Show>

            <div class='AutomationEditor__body'>
                <div class='AutomationEditor__canvas'>
                    <FlowDiagram
                        nodes={nodes()}
                        edges={edges()}
                        spare={spare()}
                        triggers={props.triggers}
                        counts={props.counts?.[route()]}
                        actionOf={actionOf}
                        crewOf={crewOf}
                        selected={selected()}
                        onSelect={setSelected}
                        onChange={flow() ? onCanvasChange : undefined}
                        onAddColumn={addColumnToRoute}
                        onDropBlock={props.onCreateColumn ? dropBlock : undefined}
                    />

                    {/* The hint stands while there is nothing to look at — an
                        empty route, or a board nobody has picked a column on —
                        and goes when the picture can answer for itself. It used
                        to be two lines under the canvas at all times, which is
                        two lines the route did not get. */}
                    <Show when={flow() ? edges().length === 0 : !selectedNode()}>
                        <p class='AutomationEditor__hint'>
                            <Show
                                when={flow()}
                                fallback={intl.formatMessage({id: 'Automation.columns-hint', defaultMessage: 'Every column of the board is here. Pick one to say what happens when a card lands in it.'})}
                            >
                                {intl.formatMessage({id: 'Automation.route-hint', defaultMessage: 'Pull from the right side of a column to join it to the next one (upper point — on success, lower — on failure), from the bottom point to wait for an event. A faded column joins the route when you click or drag it.'})}
                            </Show>
                        </p>
                    </Show>
                </div>

                <div class='AutomationEditor__panel'>
                    <Show when={selectedNode()}>
                        {(node) => (
                            <div class='AutomationEditor__section'>
                                <Show
                                    when={props.onRenameColumn}
                                    fallback={<div class='AutomationEditor__panelTitle'>{node().column}</div>}
                                >
                                    <input
                                        class='AutomationEditor__panelName'
                                        value={node().column}
                                        onChange={(e) => renameColumn(node(), e.currentTarget.value)}
                                    />
                                </Show>

                                {/* The columns view is about the column, so the
                                    panel is too: what it does wherever a card
                                    lands in it, and who works it on every
                                    route. */}
                                <Show when={!flow()}>
                                    <label>
                                        {intl.formatMessage({id: 'Automation.on-arrival', defaultMessage: 'When a card lands here'})}
                                        <Select
                                            value={specOf(node())?.action || 'none'}
                                            options={ACTIONS.map((a) => ({value: a, label: actionLabel(intl, a)}))}
                                            onChange={(action) => updateNodeSpec(node(), {action})}
                                            label={intl.formatMessage({id: 'Automation.on-arrival', defaultMessage: 'When a card lands here'})}
                                        />
                                    </label>

                                    <Show when={(specOf(node())?.action || 'none') !== 'none'}>
                                        {crewPicker(
                                            intl.formatMessage({id: 'Automation.crew', defaultMessage: 'Worked by'}),
                                            () => specOf(node())?.agents || [],
                                            (agents) => updateNodeSpec(node(), {agents}),
                                        )}

                                        <label>
                                            {intl.formatMessage({id: 'Automation.limit', defaultMessage: 'At once (0 — no limit)'})}
                                            <input
                                                type='number'
                                                min={0}
                                                value={specOf(node())?.maxRunning || 0}
                                                onInput={(e) => updateNodeSpec(node(), {maxRunning: Number(e.currentTarget.value)})}
                                            />
                                        </label>

                                        <Show when={props.worktrees === false && (specOf(node())?.agents || []).length > 1}>
                                            <div class='AutomationEditor__warning'>
                                                {intl.formatMessage({id: 'Automation.no-worktrees', defaultMessage: 'This board works on a branch in the folder itself, so two agents cannot work one repository at the same time: the crew will take cards one after another.'})}
                                            </div>
                                        </Show>
                                    </Show>

                                    <Show when={specOf(node())?.action === 'deploy'}>
                                        {deployPicker(
                                            () => specOf(node())?.deployName || '',
                                            (deployName) => updateNodeSpec(node(), {deployName}),
                                            intl.formatMessage({id: 'Automation.deploy-default', defaultMessage: '— the card’s own —'}),
                                        )}
                                    </Show>

                                    {/* What working in this column means, said
                                        to the agent before the card's task —
                                        and into a conversation somebody opens
                                        here. In whatever language the board
                                        works in: it is passed through as
                                        written. */}
                                    <Show when={(specOf(node())?.action || 'none') !== 'none'}>
                                        <label>
                                            {intl.formatMessage({id: 'Automation.column-prompt', defaultMessage: 'What the agent is told here'})}
                                            <textarea
                                                class='AutomationEditor__prompt'
                                                rows={4}
                                                value={specOf(node())?.prompt || ''}
                                                onChange={(e) => updateNodeSpec(node(), {prompt: e.currentTarget.value.trim() || undefined})}
                                            />
                                        </label>

                                        {/* The column's outputs and inputs: what
                                            a stage here writes is what an edge
                                            can branch on and a later stage can
                                            read off the card. */}
                                        {writesPicker(
                                            specOf(node())?.action || 'none',
                                            () => specOf(node())?.writes || [],
                                            (writes) => updateNodeSpec(node(), {writes}),
                                        )}
                                        {readsPicker(
                                            () => specOf(node())?.reads || [],
                                            (reads) => updateNodeSpec(node(), {reads}),
                                        )}
                                    </Show>
                                </Show>

                                {/* A route's panel is about the stage. Everything
                                    here is this stage's own answer, with the
                                    column's shown as what it falls back to —
                                    which is what puts a different agent on each
                                    node of one route. It was a fold called
                                    "only on this route…" under a second crew
                                    list, and two crews for one question read as
                                    a bug rather than as an override. */}
                                <Show when={flow()}>
                                    <label>
                                        {intl.formatMessage({id: 'Automation.stage-action', defaultMessage: 'What happens at this stage'})}
                                        <Select
                                            value={node().action || ''}
                                            options={[

                                                // The short name the box on the
                                                // canvas uses, not the sentence:
                                                // it has to fit in a select in a
                                                // 300px panel, and the sentence
                                                // was cut off mid-word.
                                                {
                                                    value: '',
                                                    label: intl.formatMessage(
                                                        {id: 'Automation.as-column', defaultMessage: '— as the column: {what} —'},
                                                        {what: stageLabel(intl, specOf(node())?.action || 'none')},
                                                    ),
                                                },
                                                ...ACTIONS.map((a) => ({value: a, label: actionLabel(intl, a)})),
                                            ]}
                                            onChange={(action) => updateFlow(flow()!.name, (f) => withNode(f, node().id, {action}))}
                                            label={intl.formatMessage({id: 'Automation.stage-action', defaultMessage: 'What happens at this stage'})}
                                        />
                                    </label>

                                    <Show when={actionOf(node()) !== 'none'}>
                                        {crewPicker(
                                            intl.formatMessage({id: 'Automation.route-crew', defaultMessage: 'Worked here by'}),
                                            () => node().agentNames || [],
                                            (agentNames) => updateFlow(flow()!.name, (f) =>
                                                withNode(f, node().id, {agentNames: agentNames.length > 0 ? agentNames : undefined})),
                                            () => (node().agentNames?.length ? '' : columnCrewNote(node())),
                                        )}

                                        {/* Where the stage works. It matters for
                                            a repository and nowhere else: a QA
                                            stage in the card's own workspace
                                            checks the work before anything is
                                            merged, one in the folder checks
                                            what is already published. */}
                                        <label>
                                            {intl.formatMessage({id: 'Automation.run-in', defaultMessage: 'The stage works'})}
                                            <Select
                                                value={node().runIn || ''}
                                                options={[
                                                    {value: '', label: intl.formatMessage({id: 'Automation.run-in-default', defaultMessage: '— as this kind of stage usually does —'})},
                                                    {value: 'owner', label: intl.formatMessage({id: 'Automation.run-in-owner', defaultMessage: 'on the card’s own branch'})},
                                                    {value: 'workdir', label: intl.formatMessage({id: 'Automation.run-in-workdir', defaultMessage: 'in the folder itself'})},
                                                ]}
                                                onChange={(runIn) => updateFlow(flow()!.name, (f) => withNode(f, node().id, {runIn: runIn || undefined}))}
                                                label={intl.formatMessage({id: 'Automation.run-in', defaultMessage: 'The stage works'})}
                                            />
                                        </label>
                                    </Show>

                                    <Show when={actionOf(node()) === 'deploy'}>
                                        {deployPicker(
                                            () => node().deployName || '',
                                            (deployName) => updateFlow(flow()!.name, (f) => withNode(f, node().id, {deployName})),
                                            intl.formatMessage({id: 'Automation.deploy-as-column', defaultMessage: '— as the column —'}),
                                        )}
                                    </Show>

                                    {/* The stage's own instructions, overriding
                                        the column's — «Ревью» on this route may
                                        brief its reviewer differently. Empty
                                        inherits, and the placeholder names the
                                        answer it falls back to. */}
                                    <Show when={actionOf(node()) !== 'none'}>
                                        <label>
                                            {intl.formatMessage({id: 'Automation.stage-prompt', defaultMessage: 'What the agent is told at this stage'})}
                                            <textarea
                                                class='AutomationEditor__prompt'
                                                rows={4}
                                                value={node().prompt || ''}
                                                placeholder={specOf(node())?.prompt ? intl.formatMessage({id: 'Automation.prompt-as-column', defaultMessage: '— as the column: “{prompt}” —'}, {prompt: promptPreview(specOf(node())!.prompt!)}) : intl.formatMessage({id: 'Automation.prompt-as-column-none', defaultMessage: '— as the column: nothing extra —'})}
                                                onChange={(e) => updateFlow(flow()!.name, (f) => withNode(f, node().id, {prompt: e.currentTarget.value.trim() || undefined}))}
                                            />
                                        </label>

                                        {/* The stage's own outputs and inputs,
                                            overriding the column's — shown
                                            resolved, written to the node. */}
                                        {writesPicker(
                                            actionOf(node()),
                                            () => node().writes || specOf(node())?.writes || [],
                                            (writes) => updateFlow(flow()!.name, (f) => withNode(f, node().id, {writes})),
                                        )}
                                        {readsPicker(
                                            () => node().reads || specOf(node())?.reads || [],
                                            (reads) => updateFlow(flow()!.name, (f) => withNode(f, node().id, {reads})),
                                        )}
                                    </Show>

                                    {/* The way to the other half of the answer.
                                        Without it "as the column" names a place
                                        with no door to it. */}
                                    <button
                                        type='button'
                                        class='AutomationEditor__addAgent'
                                        onClick={() => showRoute(COLUMNS_VIEW)}
                                    >
                                        {intl.formatMessage({id: 'Automation.open-column', defaultMessage: 'Settings of the column itself…'})}
                                    </button>

                                    <div class='AutomationEditor__transitions'>
                                        <span class='AutomationEditor__label'>
                                            {intl.formatMessage({id: 'Automation.transitions', defaultMessage: 'From here the card goes'})}
                                        </span>
                                        <For each={outgoing(edges(), node().id)}>
                                            {({edge, index}) => (
                                                <div class='AutomationEditor__transition'>
                                                    <div class='AutomationEditor__transitionRow'>
                                                        <Select
                                                            value={edge.on}
                                                            options={props.triggers.map((t) => ({value: t.kind, label: t.label}))}
                                                            onChange={(on) => patchEdge(index, {on})}
                                                            label={intl.formatMessage({id: 'Automation.transition-on', defaultMessage: 'When'})}
                                                        />
                                                        <span class='AutomationEditor__arrow'><CompassIcon icon='arrow-right'/></span>
                                                        <Select
                                                            value={edge.to}
                                                            options={stageTargets().map((n) => ({value: n.id, label: n.column}))}
                                                            onChange={(to) => patchEdge(index, {to})}
                                                            label={intl.formatMessage({id: 'Automation.transition-to', defaultMessage: 'The card moves to'})}
                                                        />
                                                        <button
                                                            type='button'
                                                            class='AutomationEditor__remove'
                                                            title={intl.formatMessage({id: 'Automation.remove-transition', defaultMessage: 'Remove'})}
                                                            onClick={() => dropEdge(index)}
                                                        ><CompassIcon icon='close'/></button>
                                                    </div>

                                                    {/* The rule, right under its arrow: the fork is
                                                        drawn by conditions, so this is where a route
                                                        stops being a straight line. */}
                                                    {condEditor(index, edge)}

                                                    <Show when={OUTCOMES.includes(edge.on) && !edge.if}>
                                                        <button
                                                            type='button'
                                                            class='AutomationEditor__branch'
                                                            onClick={() => addBranch(index)}
                                                        >
                                                            {intl.formatMessage({id: 'Automation.add-branch', defaultMessage: '+ branch on a condition'})}
                                                        </button>
                                                    </Show>
                                                </div>
                                            )}
                                        </For>
                                        <Button onClick={() => addTransition(node())}>
                                            {intl.formatMessage({id: 'Automation.add-transition', defaultMessage: 'Add a transition'})}
                                        </Button>
                                        <Button onClick={() => removeFromRoute(node())}>
                                            {intl.formatMessage({id: 'Automation.remove-from-route', defaultMessage: 'Take off this route'})}
                                        </Button>
                                    </div>
                                </Show>
                            </div>
                        )}
                    </Show>

                    <Show when={selectedEdge()}>
                        {(edge) => (
                            <div class='AutomationEditor__section'>
                                <div class='AutomationEditor__panelTitle'>
                                    {intl.formatMessage({id: 'Automation.transition', defaultMessage: 'Transition'})}
                                    <Show when={condLabel(intl, edge().if)}>
                                        <span class='AutomationEditor__condBadge'>{condLabel(intl, edge().if)}</span>
                                    </Show>
                                </div>
                                <label>
                                    {intl.formatMessage({id: 'Automation.transition-on', defaultMessage: 'When'})}
                                    <Select
                                        value={edge().on}
                                        options={props.triggers.map((t) => ({value: t.kind, label: t.label}))}
                                        onChange={(on) => patchEdge(selectedEdgeIndex(), {on})}
                                        label={intl.formatMessage({id: 'Automation.transition-on', defaultMessage: 'When'})}
                                    />
                                </label>
                                {condEditor(selectedEdgeIndex(), edge())}
                                <label>
                                    {intl.formatMessage({id: 'Automation.transition-to', defaultMessage: 'The card moves to'})}
                                    <Select
                                        value={edge().to}
                                        options={nodes().filter((n) => n.id !== edge().from).map((n) => ({value: n.id, label: n.column}))}
                                        onChange={(to) => patchEdge(selectedEdgeIndex(), {to})}
                                        label={intl.formatMessage({id: 'Automation.transition-to', defaultMessage: 'The card moves to'})}
                                    />
                                </label>
                                <Button onClick={() => dropEdge(selectedEdgeIndex())}>
                                    {intl.formatMessage({id: 'Automation.remove-transition', defaultMessage: 'Remove'})}
                                </Button>
                            </div>
                        )}
                    </Show>

                    <Show when={!selectedNode() && !selectedEdge() ? flow() : undefined}>
                        {(current) => (
                            <div class='AutomationEditor__section'>
                                <div class='AutomationEditor__panelTitle'>
                                    {intl.formatMessage({id: 'Automation.route', defaultMessage: 'Route'})}
                                </div>
                                <label>
                                    {intl.formatMessage({id: 'Automation.route-name', defaultMessage: 'Name'})}
                                    <input
                                        value={current().name}
                                        onChange={(e) => renameRoute(current().name, e.currentTarget.value.trim() || current().name)}
                                    />
                                </label>
                                <div class='AutomationEditor__hint'>
                                    {intl.formatMessage({id: 'Automation.route-name-hint', defaultMessage: 'A card takes this route by naming it — the option of the same name on the card.'})}
                                </div>
                                <Show when={props.routeOptionMissing?.(current()) && props.onAddRouteOption}>
                                    <div class='AutomationEditor__warning'>
                                        {intl.formatMessage({id: 'Automation.route-option-missing', defaultMessage: 'No card can name this route: the board has no option called that.'})}
                                        <Button onClick={() => props.onAddRouteOption?.(current())}>
                                            {intl.formatMessage({id: 'Automation.add-route-option', defaultMessage: 'Add the option'})}
                                        </Button>
                                    </div>
                                </Show>

                                {/* The dataflow check: an edge waiting on a
                                    property nothing on this route writes may be
                                    a person's own click — or a route that
                                    quietly never moves. Named, not refused. */}
                                <For each={unwrittenConditions(current(), specs(), props.property?.name)}>
                                    {(property) => (
                                        <div class='AutomationEditor__warning'>
                                            {intl.formatMessage(
                                                {id: 'Automation.unwritten-condition', defaultMessage: 'A transition reads «{property}», but no stage of this route writes it. Fine if a person sets it by hand; otherwise mark the stage that produces it in "Writes onto the card".'},
                                                {property},
                                            )}
                                        </div>
                                    )}
                                </For>
                                <label>
                                    {intl.formatMessage({id: 'Automation.route-project', defaultMessage: 'Folder (optional)'})}
                                    <input
                                        value={current().projectName || ''}
                                        placeholder={intl.formatMessage({id: 'Automation.route-project-placeholder', defaultMessage: 'Cards of this folder take this route'})}
                                        onChange={(e) => updateFlow(current().name, (f) => ({...f, projectName: e.currentTarget.value.trim()}))}
                                    />
                                </label>
                                <div class='AutomationEditor__hint'>
                                    {intl.formatMessage(
                                        {id: 'Automation.route-columns', defaultMessage: 'Goes through: {columns}'},
                                        {columns: columnsOf(current(), props.columns).map((c) => c.name).join(' → ') || '—'},
                                    )}
                                </div>
                                <Button onClick={() => removeRoute(current().name)}>
                                    {intl.formatMessage({id: 'Automation.remove-route', defaultMessage: 'Delete this route'})}
                                </Button>
                            </div>
                        )}
                    </Show>

                    {/* One sentence, so not a `__section`: that class is a
                        column flex container, and a bare string inside one is
                        laid out at its full one-line width rather than wrapped
                        — which is what pushed the panel's content half again
                        past its own edge. */}
                    <Show when={!selectedNode() && !selectedEdge() && !flow()}>
                        <p class='AutomationEditor__hint'>
                            {intl.formatMessage({id: 'Automation.empty-panel', defaultMessage: 'Settings of the selected column or route appear here. Pick a column to start.'})}
                        </p>
                    </Show>
                </div>
            </div>
        </div>
    )
}

// blockName is what a palette block's column is called until somebody renames
// it — the noun, where actionLabel is the sentence.
export function blockName(intl: IntlShape, kind: string): string {
    switch (kind) {
    case 'agent':
        return intl.formatMessage({id: 'Automation.block-agent', defaultMessage: 'Agent'})
    case 'deploy':
        return intl.formatMessage({id: 'Automation.block-deploy', defaultMessage: 'Deploy'})
    case 'test':
        return intl.formatMessage({id: 'Automation.block-test', defaultMessage: 'Test'})
    default:
        return intl.formatMessage({id: 'Automation.block-none', defaultMessage: 'Column'})
    }
}

// actionLabel names what happens in a column, in the reader's language.
export function actionLabel(intl: IntlShape, action: string): string {
    switch (action) {
    case 'agent':
        return intl.formatMessage({id: 'Automation.action-agent', defaultMessage: 'an agent works on the card'})
    case 'deploy':
        return intl.formatMessage({id: 'Automation.action-deploy', defaultMessage: 'deploy the card’s branch'})
    case 'test':
        return intl.formatMessage({id: 'Automation.action-test', defaultMessage: 'test the preview'})
    default:
        return intl.formatMessage({id: 'Automation.action-none', defaultMessage: 'nothing — the card waits'})
    }
}

export default AutomationEditor
