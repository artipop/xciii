// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, Show, createEffect, createMemo, createSignal} from 'solid-js'

import {useIntl, IntlShape} from '../../intl'

import {IPropertyTemplate} from '../../blocks/board'
import Button from '../../widgets/buttons/button'
import Select from '../../widgets/select'

import FlowDiagram, {BLOCK_DRAG_TYPE, NODE_HEIGHT, NODE_WIDTH, StageCount, condLabel, edgeId, edgeIndexOf} from './flowDiagram'
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
    SUCCESS,
    blankSpec,
    columnsOf,
    nodeFor,
    outgoing,
    specFor,
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

// The canvas is the point of this screen, so it gets the room: a route with a
// failure branch and a shelf of unused columns is three rows deep.
const CANVAS_HEIGHT = 420

// The palette: what a block dropped on the canvas becomes. 'none' is a plain
// column — a place cards stand, nothing runs.
const PALETTE = ['agent', 'deploy', 'test', 'none']

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

    // A palette block dropped on the canvas: a new column of the board, doing
    // what the block says, standing where it was dropped.
    const dropBlock = async (kind: string, at: {x: number, y: number}) => {
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

            <div class='AutomationEditor__body'>
                <Show when={props.onCreateColumn}>
                    <div class='AutomationEditor__palette'>
                        <span class='AutomationEditor__label'>
                            {intl.formatMessage({id: 'Automation.palette', defaultMessage: 'Drag onto the canvas'})}
                        </span>
                        <For each={PALETTE}>
                            {(kind) => (
                                <div
                                    class={`AutomationEditor__block AutomationEditor__block--${kind}`}
                                    draggable={true}
                                    data-block={kind}
                                    onDragStart={(e) => {
                                        e.dataTransfer?.setData(BLOCK_DRAG_TYPE, kind)
                                    }}
                                >
                                    <span class='AutomationEditor__blockName'>{blockName(intl, kind)}</span>
                                    <span class='AutomationEditor__blockWhat'>{actionLabel(intl, kind)}</span>
                                </div>
                            )}
                        </For>
                    </div>
                </Show>

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
                        height={CANVAS_HEIGHT}
                        onChange={flow() ? onCanvasChange : undefined}
                        onAddColumn={addColumnToRoute}
                        onDropBlock={props.onCreateColumn ? dropBlock : undefined}
                    />
                    <div class='AutomationEditor__hint'>
                        <Show
                            when={flow()}
                            fallback={intl.formatMessage({id: 'Automation.columns-hint', defaultMessage: 'Every column of the board is here. Pick one to say what happens when a card lands in it, or drop a block from the palette to make a new one.'})}
                        >
                            {intl.formatMessage({id: 'Automation.route-hint', defaultMessage: 'Pull from the right side of a column to join it to the next one (upper point — on success, lower — on failure), from the bottom point to wait for an event. A faded column joins the route when you click or drag it.'})}
                        </Show>
                    </div>
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
                                    <div class='AutomationEditor__crew'>
                                        <span class='AutomationEditor__label'>
                                            {intl.formatMessage({id: 'Automation.crew', defaultMessage: 'Worked by'})}
                                        </span>
                                        <Show when={props.agents.length === 0}>
                                            <span class='AutomationEditor__hint'>
                                                {intl.formatMessage({id: 'Automation.no-agents', defaultMessage: 'No agents registered yet.'})}
                                            </span>
                                        </Show>

                                        {/* Registering one is two answers, and
                                            asking them here beats sending
                                            somebody to the settings and back
                                            with the column half-configured. */}
                                        <Show when={props.onAddAgent}>
                                            <button
                                                type='button'
                                                class='AutomationEditor__addAgent'
                                                onClick={() => props.onAddAgent?.()}
                                            >
                                                {intl.formatMessage({id: 'Automation.add-agent', defaultMessage: 'Add an agent…'})}
                                            </button>
                                        </Show>
                                        <For each={props.agents}>
                                            {(a) => (
                                                <label class='AutomationEditor__agent'>
                                                    <input
                                                        type='checkbox'
                                                        checked={(specOf(node())?.agents || []).includes(a.name)}
                                                        onChange={() => {
                                                            const crew = specOf(node())?.agents || []
                                                            updateNodeSpec(node(), {agents: crew.includes(a.name) ? crew.filter((n) => n !== a.name) : [...crew, a.name]})
                                                        }}
                                                    />
                                                    {a.name}
                                                </label>
                                            )}
                                        </For>
                                    </div>

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
                                            {intl.formatMessage({id: 'Automation.no-worktrees', defaultMessage: 'worktreeMode is “never”, so two agents cannot work one project at the same time: the crew will take cards one after another.'})}
                                        </div>
                                    </Show>
                                </Show>

                                <Show when={specOf(node())?.action === 'deploy'}>
                                    <label>
                                        {intl.formatMessage({id: 'Automation.deploy', defaultMessage: 'Deploy target'})}
                                        <Select
                                            value={specOf(node())?.deployName || ''}
                                            options={[
                                                {value: '', label: intl.formatMessage({id: 'Automation.deploy-default', defaultMessage: '— the card’s own —'})},
                                                ...props.deploys.map((d) => ({value: d.name, label: d.name})),
                                            ]}
                                            onChange={(deployName) => updateNodeSpec(node(), {deployName})}
                                            label={intl.formatMessage({id: 'Automation.deploy', defaultMessage: 'Deploy target'})}
                                        />
                                    </label>
                                </Show>

                                <Show when={flow()}>
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
                                                        <span class='AutomationEditor__arrow'>{'→'}</span>
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
                                                        >{'×'}</button>
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

                                    {/* An override is the exception, so it is
                                        folded away: what a column does is the
                                        board's answer, and a route only differs
                                        from it when somebody says so. */}
                                    <details
                                        class='AutomationEditor__override'
                                        open={Boolean(node().action)}
                                    >
                                        <summary>{intl.formatMessage({id: 'Automation.override', defaultMessage: 'Only on this route…'})}</summary>
                                        <Select
                                            value={node().action || ''}
                                            options={[
                                                {value: '', label: intl.formatMessage({id: 'Automation.override-none', defaultMessage: '— whatever the column does —'})},
                                                ...ACTIONS.map((a) => ({value: a, label: actionLabel(intl, a)})),
                                            ]}
                                            onChange={(action) => updateFlow(flow()!.name, (f) => withNode(f, node().id, {action}))}
                                            label={intl.formatMessage({id: 'Automation.override', defaultMessage: 'Only on this route…'})}
                                        />
                                    </details>
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
                                <label>
                                    {intl.formatMessage({id: 'Automation.route-project', defaultMessage: 'Project (optional)'})}
                                    <input
                                        value={current().projectName || ''}
                                        placeholder={intl.formatMessage({id: 'Automation.route-project-placeholder', defaultMessage: 'Cards of this project take this route'})}
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
                            {intl.formatMessage({id: 'Automation.empty-panel', defaultMessage: 'A column says what is done. A route says where the card goes afterwards. Pick a column to start.'})}
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
