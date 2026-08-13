import {Show, createEffect, createMemo, createSignal} from 'solid-js'
import {
    Background,
    Connection,
    Controls,
    Edge,
    Handle,
    MarkerType,
    Node,
    NodeProps,
    Position,
    SolidFlow,
    createEdgeStore,
    createNodeStore,
    useSolidFlow,
} from '@dschz/solid-flow'

import {useIntl, IntlShape} from '../../intl'

import CompassIcon from '../../widgets/icons/compassIcon'

import {BoardColumn, CARD_CHANGED, EdgeCond, FlowEdge, FlowNode, FlowTrigger, SUCCESS, FAILURE, nodeId} from './automation'

import '@dschz/solid-flow/dist/style.css'
import './flowDiagram.scss'

// The route drawn as a graph, which is what it is: the board's columns left to
// right in the order the card travels, transitions as arrows — green for
// success, red for failure, grey and labelled for anything the stage waits on.
// Pan, zoom and drag are Solid Flow's; the layout below is ours.
//
// Every box on this canvas is a column of the board, including the ones the
// route does not go through: those are drawn faded, under the route, and
// joining one to the route is what puts it on the route. There is no "add a
// stage, now choose its column" — a stage cards can stand on is a column, and
// the picture says so.

export const NODE_WIDTH = 190
export const NODE_HEIGHT = 58
const GAP_X = 80
const GAP_Y = 24

// How far under the route the columns it does not use are parked, and how
// close together — a shelf, so tighter than the graph above it.
const SPARE_GAP_Y = 90
const SPARE_GAP_X = GAP_X / 2

// StageCount is how many cards stand on a stage right now — the viewer's half
// of the canvas.
export type StageCount = {
    nodeId: string
    cards: number
    running: number
    queued: number
}

type Props = {
    nodes: FlowNode[]
    edges: FlowEdge[]
    triggers: FlowTrigger[]

    // spare are the board's other columns: on the canvas, faded, so the route
    // is drawn against the board it runs on rather than against a blank sheet.
    spare?: BoardColumn[]

    // counts turn the picture into a map of the board: how many cards are on
    // each stage, and how many of them are moving.
    counts?: StageCount[]

    // actionOf says what a stage does when its own action is empty — the
    // column's, which is where the behaviour actually lives.
    actionOf?: (node: FlowNode) => string

    // crewOf is who works the stage, for the second line of the box.
    crewOf?: (node: FlowNode) => string[]

    // onChange makes it a builder rather than a picture: stages are dragged,
    // joined by pulling from an output, and removed with the keyboard. Absent
    // means the route is only being looked at.
    onChange?: (nodes: FlowNode[], edges: FlowEdge[]) => void

    // onAddColumn is a faded column being joined to the route — by a click on
    // it, an arrow drawn to or from it, or a drag that carries it into the
    // graph (`at` is then where it was dropped).
    onAddColumn?: (column: BoardColumn, at?: {x: number, y: number}) => void

    // onDropBlock is a palette block landing on the canvas: a new column of
    // this kind, at this point. Absent means there is no palette.
    onDropBlock?: (kind: string, at: {x: number, y: number}) => void

    // selected/onSelect drive the inspector beside the canvas: what is selected
    // is what the panel is about.
    selected?: {kind: 'node' | 'edge', id: string} | null
    onSelect?: (selection: {kind: 'node' | 'edge', id: string} | null) => void
}

type StageData = {
    column: string
    action: string
    actionLabel: string
    crew?: string[]
    count?: StageCount
    editable?: boolean
    spare?: boolean
    selected?: boolean
}

// forward drops the transitions that lead back the way the card came — a failed
// check returning to the agent is a normal route, and laying it out as progress
// would push every later stage off to the right for ever.
function forward(nodes: FlowNode[], edges: FlowEdge[]): FlowEdge[] {
    const out = new Map<string, FlowEdge[]>(nodes.map((n) => [n.id, []]))
    for (const edge of edges) {
        if (out.has(edge.from) && out.has(edge.to) && edge.from !== edge.to) {
            (out.get(edge.from) as FlowEdge[]).push(edge)
        }
    }

    const kept: FlowEdge[] = []
    const state = new Map<string, 'open' | 'done'>()

    // Depth-first, iteratively: an edge into a stage still on the stack closes
    // a loop and is left out of the layout.
    const walk = (start: string) => {
        const stack: Array<{id: string, next: number}> = [{id: start, next: 0}]
        state.set(start, 'open')
        while (stack.length > 0) {
            const top = stack[stack.length - 1]
            const outgoing = out.get(top.id) as FlowEdge[]
            if (top.next >= outgoing.length) {
                state.set(top.id, 'done')
                stack.pop()
                continue
            }
            const edge = outgoing[top.next++]
            if (state.get(edge.to) === 'open') {
                continue
            }
            kept.push(edge)
            if (!state.has(edge.to)) {
                state.set(edge.to, 'open')
                stack.push({id: edge.to, next: 0})
            }
        }
    }

    // Start where a card would: at the stages nothing leads to, then at
    // whatever the walk has not reached (a route that is one closed loop).
    const reached = new Set(edges.map((e) => e.to))
    for (const node of nodes.filter((n) => !reached.has(n.id))) {
        walk(node.id)
    }
    for (const node of nodes) {
        if (!state.has(node.id)) {
            walk(node.id)
        }
    }
    return kept
}

// depths puts every stage as far right as the longest path that reaches it, so
// an arrow points forward wherever the route does.
export function depths(nodes: FlowNode[], edges: FlowEdge[]): Map<string, number> {
    const depth = new Map<string, number>(nodes.map((n) => [n.id, 0]))
    const dag = forward(nodes, edges)
    for (let pass = 0; pass < nodes.length; pass++) {
        let moved = false
        for (const edge of dag) {
            const next = (depth.get(edge.from) as number) + 1
            if ((depth.get(edge.to) as number) < next) {
                depth.set(edge.to, next)
                moved = true
            }
        }
        if (!moved) {
            break
        }
    }
    return depth
}

// layout places the stages in columns of equal depth, keeping the editor's own
// order within a column.
export function layout(nodes: FlowNode[], edges: FlowEdge[]): Map<string, {x: number, y: number}> {
    const depth = depths(nodes, edges)
    const taken = new Map<number, number>()
    const out = new Map<string, {x: number, y: number}>()
    for (const node of nodes) {
        // A stage that was placed by hand stays where it was put.
        if (node.x !== undefined && node.y !== undefined) {
            out.set(node.id, {x: node.x, y: node.y})
            continue
        }
        const column = depth.get(node.id) || 0
        const row = taken.get(column) || 0
        taken.set(column, row + 1)
        out.set(node.id, {
            x: column * (NODE_WIDTH + GAP_X),
            y: row * (NODE_HEIGHT + GAP_Y),
        })
    }
    return out
}

// spareLayout parks the board's unused columns in a row under the route, in the
// board's own order. They are a shelf, not part of the graph, so they are laid
// out by counting rather than by following arrows.
export function spareLayout(placed: Map<string, {x: number, y: number}>, spare: BoardColumn[]): Map<string, {x: number, y: number}> {
    let bottom = 0
    for (const position of placed.values()) {
        bottom = Math.max(bottom, position.y + NODE_HEIGHT)
    }
    const out = new Map<string, {x: number, y: number}>()
    spare.forEach((column, i) => {
        out.set(nodeId(column), {
            x: i * (NODE_WIDTH + SPARE_GAP_X),
            y: bottom + SPARE_GAP_Y,
        })
    })
    return out
}

// An arrow and its head must be one colour, and the head is drawn from a shared
// SVG marker that no class of ours can reach — so the colours are literals here
// rather than CSS variables. They are picked to read on a light and a dark
// board alike.
const EDGE_COLOR: Record<string, string> = {
    success: '#3db887',
    failure: '#d24b4e',
    event: '#8b8d94',
}

// edgeKind styles a transition by what produces it: the stage's own outcome, or
// something that happened in the project.
export function edgeKind(on: string): string {
    if (on === SUCCESS) {
        return 'success'
    }
    if (on === FAILURE) {
        return 'failure'
    }
    return 'event'
}

// edgeId names a transition on the canvas. Conditions allow several edges per
// (from, on), so the identity is the edge's index in the route — which is also
// how the inspector addresses it.
export function edgeId(edge: FlowEdge, index: number): string {
    return `${edge.from}-${edge.on}-${index}`
}

// edgeIndexOf reads the index back out of a canvas id.
export function edgeIndexOf(id: string): number {
    const at = id.lastIndexOf('-')
    return at < 0 ? -1 : Number(id.slice(at + 1))
}

// The three ways out of a stage. A route is drawn by pulling from one of them
// to another stage, so the handle carries the meaning of the transition and
// nothing has to be chosen afterwards — except which event, for the third.
export const HANDLE_SUCCESS = 'success'
export const HANDLE_FAILURE = 'failure'
export const HANDLE_EVENT = 'event'

// StageNode is one column: what runs when a card lands there, who works it,
// and — on a board being watched rather than edited — how many cards stand on
// it. A faded one is a column the route does not use yet.
const StageNode = (props: NodeProps) => {
    const data = () => props.data as StageData
    const count = () => data().count
    const classes = () => [
        'FlowDiagram__stage',
        `FlowDiagram__stage--${data().action || 'none'}`,
        data().spare ? 'FlowDiagram__stage--spare' : '',
        data().selected ? 'FlowDiagram__stage--selected' : '',
    ].filter(Boolean).join(' ')

    return (
        <div class={classes()}>
            <Handle
                type='target'
                position='left'
                isConnectable={Boolean(data().editable)}
            />
            <div class='FlowDiagram__column'>{data().column || '—'}</div>
            <div class='FlowDiagram__action'>
                {data().actionLabel}
                <Show when={data().crew && data().crew!.length > 0}>
                    <span class='FlowDiagram__crew'>{` · ${data().crew!.join(', ')}`}</span>
                </Show>
            </div>
            <Show when={count() && count()!.cards > 0}>
                <span class='FlowDiagram__count'>
                    {count()!.cards}
                    <Show when={count()!.running > 0}>
                        <span class='FlowDiagram__running'><CompassIcon icon='play'/></span>
                    </Show>
                    <Show when={count()!.queued > 0}>
                        <span class='FlowDiagram__queued'><CompassIcon icon='pause'/></span>
                    </Show>
                </span>
            </Show>
            <Handle
                id={HANDLE_SUCCESS}
                type='source'
                position='right'
                style={{top: '30%'}}
                class='FlowDiagram__out FlowDiagram__out--success'
                isConnectable={Boolean(data().editable)}
            />
            <Handle
                id={HANDLE_FAILURE}
                type='source'
                position='right'
                style={{top: '70%'}}
                class='FlowDiagram__out FlowDiagram__out--failure'
                isConnectable={Boolean(data().editable)}
            />
            <Handle
                id={HANDLE_EVENT}
                type='source'
                position='bottom'
                class='FlowDiagram__out FlowDiagram__out--event'
                isConnectable={Boolean(data().editable)}
            />
        </div>
    )
}

const nodeTypes = {stage: StageNode}

// The palette's drags travel as this content type, so a file dragged from the
// desktop is not mistaken for a block.
export const BLOCK_DRAG_TYPE = 'application/x-xciii-block'

// FlowHandle is the part of the canvas API the drop handling needs.
type FlowHandle = {
    screenToFlowPosition: (p: {x: number, y: number}) => {x: number, y: number}
}

// CanvasHook runs inside the canvas' context and hands its API out: the drop
// events land on the wrapper div, which is outside, and converting a drop
// point into graph coordinates is the canvas' own knowledge.
const CanvasHook = (props: {onReady: (flow: FlowHandle) => void}) => {
    props.onReady(useSolidFlow() as unknown as FlowHandle)
    return null
}

// connectEdge is what pulling a connection means: the handle says which
// transition it is, and an event connection takes the first trigger the stage
// does not already wait for — the inspector is where it is changed.
export function connectEdge(
    edges: FlowEdge[],
    from: string,
    to: string,
    handle: string | null | undefined,
    waitTriggers: FlowTrigger[],
): FlowEdge[] {
    if (!from || !to || from === to) {
        return edges
    }
    let on = handle || HANDLE_SUCCESS
    if (on === HANDLE_EVENT) {
        // card.changed is never auto-picked: it is meaningless without its
        // condition, which the inspector is where to state.
        const used = new Set(edges.filter((e) => e.from === from).map((e) => e.on))
        const free = waitTriggers.find((t) => t.kind !== CARD_CHANGED && !used.has(t.kind))
        if (!free) {
            return edges
        }
        on = free.kind
    }

    // Pulling the same output again redraws the unconditional edge; the
    // conditional ones are the fork's branches and stay as they are.
    return [...edges.filter((e) => !(e.from === from && e.on === on && !e.if)), {from, to, on}]
}

// condLabel is a condition as an edge caption: the question, not a sentence.
export function condLabel(intl: IntlShape, cond: EdgeCond | undefined): string {
    if (!cond) {
        return ''
    }
    if (cond.commentContains) {
        return intl.formatMessage({id: 'FlowDiagram.cond-comment', defaultMessage: 'agent said «{text}»'}, {text: cond.commentContains})
    }
    return `${cond.property} = ${cond.value}`
}

// stageLabel names what a stage does, in the reader's language. Kept short:
// this is a box on a canvas, not a form field.
export function stageLabel(intl: IntlShape, action: string): string {
    switch (action) {
    case 'agent':
        return intl.formatMessage({id: 'FlowDiagram.action-agent', defaultMessage: 'agent'})
    case 'deploy':
        return intl.formatMessage({id: 'FlowDiagram.action-deploy', defaultMessage: 'deploy'})
    case 'test':
        return intl.formatMessage({id: 'FlowDiagram.action-test', defaultMessage: 'test'})
    default:
        return intl.formatMessage({id: 'FlowDiagram.action-none', defaultMessage: 'waits'})
    }
}

const FlowDiagram = (props: Props) => {
    const intl = useIntl()
    const editable = () => Boolean(props.onChange)
    const waitTriggers = createMemo(() => props.triggers.filter((t) => t.source !== 'outcome'))
    const spare = () => props.spare || []

    // A faded column is on the canvas but not in the route, so it is looked up
    // by the id it would have as a stage.
    const spareById = createMemo(() => new Map(spare().map((c) => [nodeId(c), c])))

    const graph = createMemo(() => {
        const positions = layout(props.nodes, props.edges)
        const sparePositions = spareLayout(positions, spare())
        const box = (id: string, data: StageData, position: {x: number, y: number}): Node => ({
            id,
            type: 'stage',
            position,

            // Stated rather than measured: the box is a fixed size in CSS and
            // its handles sit at fixed points, so the arrows are drawn on the
            // first paint instead of after the browser reports a layout.
            //
            // Every handle states its own size too, and must. The canvas works
            // out where an arrow starts by adding the handle's width and height
            // to its corner, and the library's own defaulting of those two
            // writes them back into the node — but these nodes live in a Solid
            // store, whose proxy ignores a write from outside its setter. The
            // defaults were dropped silently, `x + undefined` came out NaN, and
            // every path was drawn as `MNaN NaN…`, which a browser renders as
            // nothing at all: the stages appeared and not one arrow between them.
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
            handles: [
                {type: 'target', position: Position.Left, x: 0, y: NODE_HEIGHT / 2, width: 1, height: 1},
                {type: 'source', id: HANDLE_SUCCESS, position: Position.Right, x: NODE_WIDTH, y: NODE_HEIGHT * 0.3, width: 1, height: 1},
                {type: 'source', id: HANDLE_FAILURE, position: Position.Right, x: NODE_WIDTH, y: NODE_HEIGHT * 0.7, width: 1, height: 1},
                {type: 'source', id: HANDLE_EVENT, position: Position.Bottom, x: NODE_WIDTH / 2, y: NODE_HEIGHT, width: 1, height: 1},
            ],
            data,
            sourcePosition: Position.Right,
            targetPosition: Position.Left,
        })

        const rfNodes: Node[] = props.nodes.map((node) => {
            const action = node.action || props.actionOf?.(node) || 'none'
            return box(node.id, {
                column: node.column,
                action,
                actionLabel: stageLabel(intl, action),
                crew: props.crewOf?.(node),
                count: props.counts?.find((c) => c.nodeId === node.id),
                editable: editable(),
                selected: props.selected?.kind === 'node' && props.selected.id === node.id,
            }, positions.get(node.id) || {x: 0, y: 0})
        })

        for (const column of spare()) {
            const id = nodeId(column)
            rfNodes.push(box(id, {
                column: column.name,
                action: 'spare',
                actionLabel: intl.formatMessage({id: 'FlowDiagram.not-on-route', defaultMessage: 'not on this route'}),
                editable: editable(),
                spare: true,
            }, sparePositions.get(id) || {x: 0, y: 0}))
        }

        const known = new Set(props.nodes.map((n) => n.id))
        const rfEdges: Edge[] = props.edges.
            map((edge, index) => ({edge, index})).
            filter(({edge}) => known.has(edge.from) && known.has(edge.to)).
            map(({edge, index}) => {
                const kind = edgeKind(edge.on)
                const color = EDGE_COLOR[kind]

                // The caption is what decides where the card goes: the event
                // for a wait, the condition for a fork — both where the arrow
                // is, not three clicks away.
                const parts: string[] = []
                if (kind === 'event') {
                    parts.push(props.triggers.find((t) => t.kind === edge.on)?.label || edge.on)
                }
                const cond = condLabel(intl, edge.if)
                if (cond) {
                    parts.push(edge.on === CARD_CHANGED ? cond : intl.formatMessage({id: 'FlowDiagram.cond-if', defaultMessage: 'if {cond}'}, {cond}))
                }
                const chosen = props.selected?.kind === 'edge' && props.selected.id === edgeId(edge, index)
                return {
                    id: edgeId(edge, index),
                    source: edge.from,
                    target: edge.to,
                    sourceHandle: kind === 'event' ? HANDLE_EVENT : kind,
                    type: 'smoothstep',
                    class: `FlowDiagram__edge FlowDiagram__edge--${kind}${chosen ? ' FlowDiagram__edge--selected' : ''}`,
                    label: parts.join(' · '),
                    style: {stroke: color, 'stroke-width': chosen ? '3' : '1.5', 'stroke-dasharray': kind === 'event' ? '4 3' : undefined},
                    markerEnd: {type: MarkerType.ArrowClosed, width: 16, height: 16, color},
                }
            })
        return {rfNodes, rfEdges}
    })

    // Stages can always be dragged apart when arrows overlap: the canvas moves
    // them inside these stores. Where the route is being edited the position is
    // part of it and is saved; where it is only being read, the move is the
    // reader's and is forgotten when the route next arrives through props.
    // The stores are typed by node-type name for authoring by hand; the graph
    // above already produces the library's Node/Edge shapes, so the input
    // union is narrowed back to them.
    const [drawnNodes, setDrawnNodes] = createNodeStore([]) as unknown as [Node[], (nodes: Node[]) => void]
    const [drawnEdges, setDrawnEdges] = createEdgeStore([]) as unknown as [Edge[], (edges: Edge[]) => void]

    createEffect(() => {
        setDrawnNodes(graph().rfNodes)
        setDrawnEdges(graph().rfEdges)
    })

    // An arrow drawn to or from a faded column puts it on the route first: the
    // gesture says "this column is part of this route", and asking for a second
    // one afterwards would be asking twice.
    const joinSpares = (...ids: string[]) => {
        for (const id of ids) {
            const column = spareById().get(id)
            if (column) {
                props.onAddColumn?.(column)
            }
        }
    }

    const onConnect = (connection: Connection) => {
        if (!props.onChange) {
            return
        }
        joinSpares(connection.source, connection.target)
        props.onChange(props.nodes, connectEdge(props.edges, connection.source, connection.target, connection.sourceHandle, waitTriggers()))
    }

    const onNodeDragStop = ({targetNode}: {targetNode: Node | null}) => {
        if (!props.onChange || !targetNode) {
            return
        }

        // A faded column carried into the graph joins the route where it was
        // let go — the same gesture as dropping a palette block.
        const column = spareById().get(targetNode.id)
        if (column) {
            props.onAddColumn?.(column, {x: targetNode.position.x, y: targetNode.position.y})
            return
        }
        props.onChange(props.nodes.map((n) => (n.id === targetNode.id ? {...n, x: targetNode.position.x, y: targetNode.position.y} : n)), props.edges)
    }

    const onNodesDelete = (deleted: Node[]) => {
        if (!props.onChange) {
            return
        }
        const gone = new Set(deleted.map((n) => n.id))
        props.onChange(
            props.nodes.filter((n) => !gone.has(n.id)),

            // A transition to a stage that is no longer there is exactly what
            // the engine refuses to save.
            props.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
        )
    }

    const onEdgesDelete = (deleted: Edge[]) => {
        if (!props.onChange) {
            return
        }
        const gone = new Set(deleted.map((e) => e.id))
        props.onChange(props.nodes, props.edges.filter((e, i) => !gone.has(edgeId(e, i))))
    }

    const onNodeClick = ({node}: {node: Node}) => {
        const column = spareById().get(node.id)
        if (column) {
            props.onAddColumn?.(column)
            return
        }
        props.onSelect?.({kind: 'node', id: node.id})
    }

    // The canvas API arrives from inside the canvas (CanvasHook); the drop
    // events arrive on the wrapper. Between them a palette block becomes a
    // stage exactly under the pointer.
    const [flowHandle, setFlowHandle] = createSignal<FlowHandle | null>(null)

    const dropPoint = (e: DragEvent) => {
        const at = {x: e.clientX, y: e.clientY}
        const handle = flowHandle()

        // Without the canvas API (jsdom, or a not-yet-mounted canvas) the drop
        // still works — the block lands at a default spot instead of the exact
        // pointer position.
        return handle ? handle.screenToFlowPosition(at) : {x: 0, y: 0}
    }

    const onDragOver = (e: DragEvent) => {
        if (props.onDropBlock && e.dataTransfer?.types.includes(BLOCK_DRAG_TYPE)) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
        }
    }

    const onDrop = (e: DragEvent) => {
        const kind = e.dataTransfer?.getData(BLOCK_DRAG_TYPE)
        if (!kind || !props.onDropBlock) {
            return
        }
        e.preventDefault()
        const at = dropPoint(e)
        props.onDropBlock(kind, {x: at.x - (NODE_WIDTH / 2), y: at.y - (NODE_HEIGHT / 2)})
    }

    return (
        <Show when={props.nodes.length > 0 || spare().length > 0}>
            <div
                class={`FlowDiagram${editable() ? ' FlowDiagram--editable' : ''}`}
                data-testid='flow-diagram'
                onDragOver={onDragOver}
                onDrop={onDrop}
            >
                <SolidFlow
                    nodes={drawnNodes}
                    edges={drawnEdges}
                    onConnect={onConnect}
                    onNodeDragStop={onNodeDragStop}
                    onNodesDelete={onNodesDelete}
                    onEdgesDelete={onEdgesDelete}
                    onNodeClick={onNodeClick}
                    onEdgeClick={({edge}: {edge: Edge}) => props.onSelect?.({kind: 'edge', id: edge.id})}
                    onPaneClick={() => props.onSelect?.(null)}
                    nodeTypes={nodeTypes}
                    nodesConnectable={editable()}
                    elementsSelectable={editable()}
                    edgesFocusable={editable()}
                    deleteKey={editable() ? ['Backspace', 'Delete'] : null}
                    fitView={true}
                    fitViewOptions={{padding: 0.2, maxZoom: 1}}
                    minZoom={0.3}

                    // Solid Flow is MIT and its own attribution says to feel free to
                    // remove it; the canvas is small and the plate sits over the cards.
                    proOptions={{hideAttribution: true}}
                >
                    <Background/>
                    <Controls showLock={false}/>
                    <CanvasHook onReady={setFlowHandle}/>
                </SolidFlow>
            </div>
        </Show>
    )
}

export default FlowDiagram
