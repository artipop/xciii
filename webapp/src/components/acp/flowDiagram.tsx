// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show, createEffect, createMemo} from 'solid-js'
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
} from '@dschz/solid-flow'

import {useIntl, IntlShape} from '../../intl'

import {FlowEdge, FlowNode, FlowTrigger, SUCCESS, FAILURE} from './workflowsDialog'

import '@dschz/solid-flow/dist/style.css'
import './flowDiagram.scss'

// The route drawn as a graph, which is what it is: stages left to right in the
// order the card travels, transitions as arrows — green for success, red for
// failure, grey and labelled for anything the stage waits on. Pan, zoom and
// drag are Solid Flow's; the layout below is ours, because a route read top to
// bottom in the editor should read left to right here.

export const NODE_WIDTH = 190
export const NODE_HEIGHT = 58
const GAP_X = 80
const GAP_Y = 24

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

    // counts turn the picture into a map of the board: how many cards are on
    // each stage, and how many of them are moving.
    counts?: StageCount[]

    // onChange makes it a builder rather than a picture: stages are dragged,
    // joined by pulling from an output, and removed with the keyboard. Absent
    // means the route is only being looked at.
    onChange?: (nodes: FlowNode[], edges: FlowEdge[]) => void
    height?: number
}

type StageData = {
    column: string
    action: string
    actionLabel: string
    count?: StageCount
    editable?: boolean
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
// something that happened in the repository.
export function edgeKind(on: string): string {
    if (on === SUCCESS) {
        return 'success'
    }
    if (on === FAILURE) {
        return 'failure'
    }
    return 'event'
}

// The three ways out of a stage. A route is drawn by pulling from one of them
// to another stage, so the handle carries the meaning of the transition and
// nothing has to be chosen afterwards — except which event, for the third.
export const HANDLE_SUCCESS = 'success'
export const HANDLE_FAILURE = 'failure'
export const HANDLE_EVENT = 'event'

// StageNode is one stage: the column a card sits in, what runs when it lands
// there, and — on a board being watched rather than edited — how many cards are
// standing on it.
const StageNode = (props: NodeProps) => {
    const data = () => props.data as StageData
    const count = () => data().count
    return (
        <div class={`FlowDiagram__stage FlowDiagram__stage--${data().action || 'none'}`}>
            <Handle
                type='target'
                position='left'
                isConnectable={Boolean(data().editable)}
            />
            <div class='FlowDiagram__column'>{data().column || '—'}</div>
            <div class='FlowDiagram__action'>{data().actionLabel}</div>
            <Show when={count() && count()!.cards > 0}>
                <span class='FlowDiagram__count'>
                    {count()!.cards}
                    <Show when={count()!.running > 0}>
                        <span class='FlowDiagram__running'>{'▶'}</span>
                    </Show>
                    <Show when={count()!.queued > 0}>
                        <span class='FlowDiagram__queued'>{'⏸'}</span>
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

// connectEdge is what pulling a connection means: the handle says which
// transition it is, and an event connection takes the first trigger the stage
// does not already wait for — the row under the canvas is where it is changed.
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
        const used = new Set(edges.filter((e) => e.from === from).map((e) => e.on))
        const free = waitTriggers.find((t) => !used.has(t.kind))
        if (!free) {
            return edges
        }
        on = free.kind
    }
    return [...edges.filter((e) => !(e.from === from && e.on === on)), {from, to, on}]
}

// stageLabel names what a stage does, in the reader's language. Kept short:
// this is a box on a canvas, not a form field.
function stageLabel(intl: IntlShape, action: string): string {
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

    const graph = createMemo(() => {
        const positions = layout(props.nodes, props.edges)
        const rfNodes: Node[] = props.nodes.map((node) => ({
            id: node.id,
            type: 'stage',
            position: positions.get(node.id) || {x: 0, y: 0},

            // Stated rather than measured: the box is a fixed size in CSS and
            // its handles sit at fixed points, so the arrows are drawn on the
            // first paint instead of after the browser reports a layout.
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
            handles: [
                {type: 'target', position: Position.Left, x: 0, y: NODE_HEIGHT / 2},
                {type: 'source', id: HANDLE_SUCCESS, position: Position.Right, x: NODE_WIDTH, y: NODE_HEIGHT * 0.3},
                {type: 'source', id: HANDLE_FAILURE, position: Position.Right, x: NODE_WIDTH, y: NODE_HEIGHT * 0.7},
                {type: 'source', id: HANDLE_EVENT, position: Position.Bottom, x: NODE_WIDTH / 2, y: NODE_HEIGHT},
            ],
            data: {
                column: node.column,
                action: node.action,
                actionLabel: stageLabel(intl, node.action),
                count: props.counts?.find((c) => c.nodeId === node.id),
                editable: editable(),
            },
            sourcePosition: Position.Right,
            targetPosition: Position.Left,
        }))

        const known = new Set(props.nodes.map((n) => n.id))
        const rfEdges: Edge[] = props.edges.filter((e) => known.has(e.from) && known.has(e.to)).map((edge) => {
            const kind = edgeKind(edge.on)
            const color = EDGE_COLOR[kind]
            const label = kind === 'event' ? (props.triggers.find((t) => t.kind === edge.on)?.label || edge.on) : ''
            return {
                id: `${edge.from}-${edge.on}`,
                source: edge.from,
                target: edge.to,
                sourceHandle: kind === 'event' ? HANDLE_EVENT : kind,
                type: 'smoothstep',
                class: `FlowDiagram__edge FlowDiagram__edge--${kind}`,
                label,
                style: {stroke: color, 'stroke-width': '1.5', 'stroke-dasharray': kind === 'event' ? '4 3' : undefined},
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

    const onConnect = (connection: Connection) => {
        if (!props.onChange) {
            return
        }
        props.onChange(props.nodes, connectEdge(props.edges, connection.source, connection.target, connection.sourceHandle, waitTriggers()))
    }

    const onNodeDragStop = ({targetNode}: {targetNode: Node | null}) => {
        if (!props.onChange || !targetNode) {
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
        props.onChange(props.nodes, props.edges.filter((e) => !gone.has(`${e.from}-${e.on}`)))
    }

    return (
        <Show when={props.nodes.length > 0}>
            <div
                class={`FlowDiagram${editable() ? ' FlowDiagram--editable' : ''}`}
                data-testid='flow-diagram'
                style={props.height ? {height: `${props.height}px`} : undefined}
            >
                <SolidFlow
                    nodes={drawnNodes}
                    edges={drawnEdges}
                    onConnect={onConnect}
                    onNodeDragStop={onNodeDragStop}
                    onNodesDelete={onNodesDelete}
                    onEdgesDelete={onEdgesDelete}
                    nodeTypes={nodeTypes}
                    nodesConnectable={editable()}
                    elementsSelectable={editable()}
                    edgesFocusable={editable()}
                    deleteKey={editable() ? ['Backspace', 'Delete'] : null}
                    fitView={true}
                    fitViewOptions={{padding: 0.2, maxZoom: 1}}
                    minZoom={0.3}
                    proOptions={{hideAttribution: false}}
                >
                    <Background/>
                    <Controls showLock={false}/>
                </SolidFlow>
            </div>
        </Show>
    )
}

export default FlowDiagram
