// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {Board, IPropertyTemplate} from '../../blocks/board'
import {Utils, IDType} from '../../utils'
import Button from '../../widgets/buttons/button'
import Dialog from '../dialog'

import {agentBindings} from './agentReposDialog'
import FlowDiagram, {StageCount} from './flowDiagram'

import './workflowsDialog.scss'

// A flow is the route a card takes across the board: stages (a column plus what
// runs there) joined by transitions. Both halves are edited here — the graph is
// the point, and a JSON blob would not be one.
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

    // Where the stage was left on the canvas. Absent means "lay it out for me".
    x?: number
    y?: number
}

export type FlowEdge = {
    from: string
    to: string
    on: string
}

export type Flow = {
    name: string
    boardId?: string
    repoName?: string
    property?: string
    nodes: FlowNode[]
    edges: FlowEdge[]
}

// FlowTrigger is one transition kind the engine implements. The list comes from
// Go, so the editor can never offer a transition that does nothing.
// FlowOverview is where the board's cards stand on one route.
export type FlowOverview = {
    flow: string
    cards: number
    stages: StageCount[]
}

export type FlowTrigger = {
    kind: string
    source: string
    label: string
}

// The two outcome triggers are a stage's own outputs and are edited as such;
// everything else is an extra edge the stage waits for.
export const SUCCESS = 'success'
export const FAILURE = 'failure'

const ACTIONS = ['none', 'agent', 'deploy', 'test']

export function isWorkflowsAvailable(): boolean {
    return Boolean(agentBindings()?.ListFlows)
}

type Props = {
    board: Board
    onClose: () => void
}

// edgeTarget is the stage an event leads to, or '' when the graph says nothing.
export function edgeTarget(edges: FlowEdge[], from: string, on: string): string {
    return edges.find((e) => e.from === from && e.on === on)?.to || ''
}

// setEdge replaces the transition (from, on); an empty target removes it.
export function setEdge(edges: FlowEdge[], from: string, on: string, to: string): FlowEdge[] {
    const rest = edges.filter((e) => !(e.from === from && e.on === on))
    return to ? [...rest, {from, to, on}] : rest
}

// waitEdges are the stage's non-outcome transitions, in graph order.
export function waitEdges(edges: FlowEdge[], from: string): FlowEdge[] {
    return edges.filter((e) => e.from === from && e.on !== SUCCESS && e.on !== FAILURE)
}

const WorkflowsDialog = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [flows, setFlows] = createSignal<Flow[]>([])
    const [overview, setOverview] = createSignal<FlowOverview[]>([])
    const [templates, setTemplates] = createSignal<Flow[]>([])
    const [triggers, setTriggers] = createSignal<FlowTrigger[]>([])
    const [form, setForm] = createSignal<Flow | null>(null)
    const [editingName, setEditingName] = createSignal<string | null>(null)
    const [error, setError] = createSignal('')

    const selectProperties = () => props.board.cardProperties.filter((p: IPropertyTemplate) => p.type === 'select')

    // Columns are offered from the board itself: a stage pointing at a column
    // nobody has would only fail later, when a card cannot be moved into it.
    const columnOptions = () => {
        const property = selectProperties().find((p) => p.name === form()?.property) || selectProperties()[0]
        return property?.options?.map((o) => o.value) || []
    }

    const refresh = async () => {
        if (!bindings?.ListFlows) {
            return
        }
        try {
            setFlows(JSON.parse(await bindings.ListFlows(props.board.id)) || [])
            if (bindings.ListFlowTriggers) {
                setTriggers(JSON.parse(await bindings.ListFlowTriggers()) || [])
            }
            if (bindings.ListFlowTemplates) {
                setTemplates(JSON.parse(await bindings.ListFlowTemplates()) || [])
            }
            if (bindings.GetBoardFlowOverview) {
                setOverview(JSON.parse(await bindings.GetBoardFlowOverview(props.board.id)) || [])
            }
        } catch (e) {
            setError(String(e))
        }
    }

    onMount(() => {
        refresh()
    })

    const startAdd = () => {
        setForm({
            name: '',
            property: selectProperties()[0]?.name || '',
            nodes: [],
            edges: [],
        })
        setEditingName(null)
        setError('')
    }

    // A route the install ships with, opened in the editor rather than saved
    // behind the user's back: the graph is there to be looked at first.
    const startFromTemplate = (flow: Flow) => {
        setForm({...flow, nodes: [...(flow.nodes || [])], edges: [...(flow.edges || [])]})
        setEditingName(null)
        setError('')
    }

    const startEdit = (flow: Flow) => {
        setForm({...flow, nodes: [...(flow.nodes || [])], edges: [...(flow.edges || [])]})
        setEditingName(flow.name)
        setError('')
    }

    const saveForm = async () => {
        if (!bindings || !form()) {
            return
        }
        setError('')
        try {
            const entry = {...form()!, name: form()!.name.trim(), boardId: form()!.boardId || props.board.id}
            if (editingName()) {
                await bindings.UpdateFlow!(JSON.stringify(entry))
            } else {
                await bindings.AddFlow!(JSON.stringify(entry))
            }
            setForm(null)
            await refresh()
        } catch (e) {
            setError(String(e))
        }
    }

    const removeFlow = async (name: string) => {
        if (!bindings?.RemoveFlow) {
            return
        }
        setError('')
        try {
            await bindings.RemoveFlow(name)
            await refresh()
        } catch (e) {
            setError(String(e))
        }
    }

    const updateForm = (patch: Partial<Flow>) => setForm((f) => (f ? {...f, ...patch} : f))

    const updateNode = (id: string, patch: Partial<FlowNode>) => setForm((f) => (f ? {
        ...f,
        nodes: f.nodes.map((n) => (n.id === id ? {...n, ...patch} : n)),
    } : f))

    const addNode = () => setForm((f) => {
        if (!f) {
            return f
        }
        const used = new Set(f.nodes.map((n) => n.column))
        const free = columnOptions().find((c) => !used.has(c)) || ''
        return {...f, nodes: [...f.nodes, {id: Utils.createGuid(IDType.None), column: free, action: 'none'}]}
    })

    // Removing a stage takes its transitions with it, in and out: an edge to
    // nowhere is exactly what the engine refuses to save.
    const removeNode = (id: string) => setForm((f) => (f ? {
        ...f,
        nodes: f.nodes.filter((n) => n.id !== id),
        edges: f.edges.filter((e) => e.from !== id && e.to !== id),
    } : f))

    const changeEdge = (from: string, on: string, to: string) =>
        setForm((f) => (f ? {...f, edges: setEdge(f.edges, from, on, to)} : f))

    const replaceEdgeKind = (from: string, oldOn: string, newOn: string) => setForm((f) => {
        if (!f) {
            return f
        }
        const to = edgeTarget(f.edges, from, oldOn)
        return {...f, edges: setEdge(setEdge(f.edges, from, oldOn, ''), from, newOn, to)}
    })

    const waitTriggers = () => triggers().filter((t) => t.source !== 'outcome')

    // Only the shipped routes this registry does not already have: the point is
    // to fill a gap, not to offer a duplicate the engine would refuse.
    const missingTemplates = () => templates().filter(
        (t) => !flows().some((f) => f.name.toLowerCase() === t.name.toLowerCase()),
    )

    const nodeName = (id: string) => form()?.nodes.find((n) => n.id === id)?.column || id

    const stageTargets = (exclude: string) => (form()?.nodes || []).filter((n) => n.id !== exclude)

    return (
        <Dialog
            class='WorkflowsDialog'
            title={<span>{intl.formatMessage({id: 'Workflows.title', defaultMessage: 'Workflows'})}</span>}
            subtitle={<span>{intl.formatMessage({id: 'Workflows.subtitle', defaultMessage: 'The route a card takes across the board: what runs in each column, and which event moves the card on. A card without a matching flow keeps the standalone trigger columns.'})}</span>}
            onClose={props.onClose}
        >
            <div class='WorkflowsDialog__content'>
                <Show when={flows().length === 0 && !form()}>
                    <div class='WorkflowsDialog__empty'>
                        {intl.formatMessage({id: 'Workflows.empty', defaultMessage: 'No flows yet.'})}
                    </div>
                </Show>

                <Show when={!form()}>
                    <For each={flows()}>
                        {(flow) => {
                            const stages = () => overview().find((o) => o.flow === flow.name)
                            return (
                                <div
                                    class='WorkflowsDialog__flow'
                                >
                                    <div class='WorkflowsDialog__row'>
                                        <span class='WorkflowsDialog__name'>{flow.name}</span>
                                        <span class='WorkflowsDialog__route'>
                                            {stages() && stages()!.cards > 0 ? intl.formatMessage({id: 'Workflows.cards-on-route', defaultMessage: '{count} cards on this route'}, {count: stages()!.cards}) : intl.formatMessage({id: 'Workflows.no-cards', defaultMessage: 'no cards on this route'})}
                                        </span>
                                        <Button onClick={() => startEdit(flow)}>
                                            {intl.formatMessage({id: 'Workflows.edit', defaultMessage: 'Edit'})}
                                        </Button>
                                        <Button onClick={() => removeFlow(flow.name)}>
                                            {intl.formatMessage({id: 'Workflows.remove', defaultMessage: 'Remove'})}
                                        </Button>
                                    </div>
                                    <FlowDiagram
                                        nodes={flow.nodes || []}
                                        edges={flow.edges || []}
                                        triggers={triggers()}
                                        counts={stages()?.stages}
                                        height={220}
                                    />
                                </div>
                            )
                        }}
                    </For>
                </Show>

                <Show when={form()}>
                    <div class='WorkflowsDialog__form'>
                        <div class='WorkflowsDialog__formHeader'>
                            <label>
                                {intl.formatMessage({id: 'Workflows.name', defaultMessage: 'Name'})}
                                <input
                                    value={form()!.name}
                                    disabled={Boolean(editingName())}
                                    placeholder={intl.formatMessage({id: 'Workflows.name-placeholder', defaultMessage: 'Name (also matched against the card\'s options)'})}
                                    onInput={(e) => updateForm({name: e.currentTarget.value})}
                                />
                            </label>
                            <label>
                                {intl.formatMessage({id: 'Workflows.property', defaultMessage: 'Column property'})}
                                <select
                                    value={form()!.property || ''}
                                    onChange={(e) => updateForm({property: e.currentTarget.value})}
                                >
                                    <For each={selectProperties()}>
                                        {(p) => (
                                            <option
                                                value={p.name}
                                                selected={(form()!.property || '') === p.name}
                                            >{p.name}</option>
                                        )}
                                    </For>
                                </select>
                            </label>
                            <label>
                                {intl.formatMessage({id: 'Workflows.repoName', defaultMessage: 'Repository (optional)'})}
                                <input
                                    value={form()!.repoName || ''}
                                    placeholder={intl.formatMessage({id: 'Workflows.repoName-placeholder', defaultMessage: 'Registry name — cards of this repository use this flow'})}
                                    onInput={(e) => updateForm({repoName: e.currentTarget.value})}
                                />
                            </label>
                        </div>

                        <FlowDiagram
                            nodes={form()!.nodes}
                            edges={form()!.edges}
                            triggers={triggers()}
                            onChange={(nodes, edges) => updateForm({nodes, edges})}
                        />
                        <div class='WorkflowsDialog__hint'>
                            {intl.formatMessage({id: 'Workflows.canvas-hint', defaultMessage: 'Drag a stage to move it; pull from its right side to join stages (upper point — on success, lower — on failure), from the bottom point to wait for an event. Delete removes what is selected.'})}
                        </div>

                        <For each={form()!.nodes}>
                            {(node) => (
                                <div
                                    class='WorkflowsDialog__node'
                                >
                                    <div class='WorkflowsDialog__nodeHead'>
                                        <select
                                            value={node.column}
                                            onChange={(e) => updateNode(node.id, {column: e.currentTarget.value})}
                                        >
                                            <option value=''>{intl.formatMessage({id: 'Workflows.pick-column', defaultMessage: '— pick a column —'})}</option>
                                            <For each={columnOptions()}>
                                                {(c) => (
                                                    <option
                                                        value={c}
                                                        selected={node.column === c}
                                                    >{c}</option>
                                                )}
                                            </For>
                                        </select>
                                        <select
                                            value={node.action}
                                            onChange={(e) => updateNode(node.id, {action: e.currentTarget.value})}
                                        >
                                            <For each={ACTIONS}>
                                                {(a) => (
                                                    <option
                                                        value={a}
                                                        selected={node.action === a}
                                                    >{actionLabel(intl, a)}</option>
                                                )}
                                            </For>
                                        </select>
                                        <Button onClick={() => removeNode(node.id)}>
                                            {intl.formatMessage({id: 'Workflows.remove-stage', defaultMessage: 'Remove stage'})}
                                        </Button>
                                    </div>

                                    <div class='WorkflowsDialog__outcomes'>
                                        <label>
                                            {intl.formatMessage({id: 'Workflows.on-success', defaultMessage: '✅ on success →'})}
                                            <select
                                                value={edgeTarget(form()!.edges, node.id, SUCCESS)}
                                                onChange={(e) => changeEdge(node.id, SUCCESS, e.currentTarget.value)}
                                            >
                                                <option value=''>{intl.formatMessage({id: 'Workflows.stay', defaultMessage: '— stay here —'})}</option>
                                                <For each={stageTargets(node.id)}>
                                                    {(n) => (
                                                        <option
                                                            value={n.id}
                                                            selected={edgeTarget(form()!.edges, node.id, SUCCESS) === n.id}
                                                        >{n.column}</option>
                                                    )}
                                                </For>
                                            </select>
                                        </label>
                                        <label>
                                            {intl.formatMessage({id: 'Workflows.on-failure', defaultMessage: '❌ on failure →'})}
                                            <select
                                                value={edgeTarget(form()!.edges, node.id, FAILURE)}
                                                onChange={(e) => changeEdge(node.id, FAILURE, e.currentTarget.value)}
                                            >
                                                <option value=''>{intl.formatMessage({id: 'Workflows.stay', defaultMessage: '— stay here —'})}</option>
                                                <For each={stageTargets(node.id)}>
                                                    {(n) => (
                                                        <option
                                                            value={n.id}
                                                            selected={edgeTarget(form()!.edges, node.id, FAILURE) === n.id}
                                                        >{n.column}</option>
                                                    )}
                                                </For>
                                            </select>
                                        </label>
                                    </div>

                                    <For each={waitEdges(form()!.edges, node.id)}>
                                        {(edge) => (
                                            <div
                                                class='WorkflowsDialog__wait'
                                            >
                                                <select
                                                    value={edge.on}
                                                    onChange={(e) => replaceEdgeKind(node.id, edge.on, e.currentTarget.value)}
                                                >
                                                    <For each={waitTriggers()}>
                                                        {(t) => (
                                                            <option
                                                                value={t.kind}
                                                                selected={edge.on === t.kind}
                                                            >{t.label}</option>
                                                        )}
                                                    </For>
                                                </select>
                                                <span class='WorkflowsDialog__arrow'>{'→'}</span>
                                                <select
                                                    value={edge.to}
                                                    onChange={(e) => changeEdge(node.id, edge.on, e.currentTarget.value)}
                                                >
                                                    <For each={stageTargets(node.id)}>
                                                        {(n) => (
                                                            <option
                                                                value={n.id}
                                                                selected={edge.to === n.id}
                                                            >{n.column}</option>
                                                        )}
                                                    </For>
                                                </select>
                                                <Button onClick={() => changeEdge(node.id, edge.on, '')}>
                                                    {intl.formatMessage({id: 'Workflows.remove-wait', defaultMessage: 'Remove'})}
                                                </Button>
                                            </div>
                                        )}
                                    </For>

                                    <Button
                                        onClick={() => {
                                            const used = waitEdges(form()!.edges, node.id).map((e) => e.on)
                                            const free = waitTriggers().find((t) => !used.includes(t.kind))
                                            const target = stageTargets(node.id)[0]
                                            if (free && target) {
                                                changeEdge(node.id, free.kind, target.id)
                                            }
                                        }}
                                    >
                                        {intl.formatMessage({id: 'Workflows.add-wait', defaultMessage: 'Wait for an event…'})}
                                    </Button>
                                </div>
                            )}
                        </For>

                        <div class='WorkflowsDialog__formActions'>
                            <Button onClick={addNode}>
                                {intl.formatMessage({id: 'Workflows.add-stage', defaultMessage: 'Add stage'})}
                            </Button>
                            <Button
                                emphasis='primary'
                                onClick={saveForm}
                            >
                                {intl.formatMessage({id: 'Workflows.save', defaultMessage: 'Save'})}
                            </Button>
                            <Button onClick={() => setForm(null)}>
                                {intl.formatMessage({id: 'Workflows.cancel', defaultMessage: 'Cancel'})}
                            </Button>
                        </div>
                        <div class='WorkflowsDialog__hint'>
                            {intl.formatMessage({id: 'Workflows.hint', defaultMessage: 'A stage runs its action when a card lands in its column — dragged by a person or moved by the flow itself. Where a stage has no transition for what happened, the card stays put and says so.'})}
                        </div>
                        <Show when={form()!.nodes.length > 0 && nodeName(form()!.nodes[0].id) === ''}>
                            <div class='WorkflowsDialog__hint'>
                                {intl.formatMessage({id: 'Workflows.pick-columns-hint', defaultMessage: 'Every stage needs a column.'})}
                            </div>
                        </Show>
                    </div>
                </Show>

                <Show when={!form() && missingTemplates().length > 0}>
                    <div class='WorkflowsDialog__templates'>
                        <span class='WorkflowsDialog__hint'>
                            {intl.formatMessage({id: 'Workflows.templates', defaultMessage: 'Ready-made routes, the ones the board template names:'})}
                        </span>
                        <For each={missingTemplates()}>
                            {(flow) => (
                                <Button
                                    onClick={() => startFromTemplate(flow)}
                                >{flow.name}</Button>
                            )}
                        </For>
                    </div>
                </Show>

                <Show when={!form()}>
                    <div class='WorkflowsDialog__actions'>
                        <Button
                            emphasis='primary'
                            onClick={startAdd}
                        >
                            {intl.formatMessage({id: 'Workflows.add', defaultMessage: 'Add flow…'})}
                        </Button>
                    </div>
                </Show>

                <Show when={error()}>
                    <div class='WorkflowsDialog__error'>{error()}</div>
                </Show>
            </div>
        </Dialog>
    )
}

// actionLabel names what a stage does, in the reader's language.
function actionLabel(intl: {formatMessage: (d: {id: string, defaultMessage: string}) => string}, action: string): string {
    switch (action) {
    case 'agent':
        return intl.formatMessage({id: 'Workflows.action-agent', defaultMessage: 'agent works on the card'})
    case 'deploy':
        return intl.formatMessage({id: 'Workflows.action-deploy', defaultMessage: 'deploy the branch'})
    case 'test':
        return intl.formatMessage({id: 'Workflows.action-test', defaultMessage: 'test the preview'})
    default:
        return intl.formatMessage({id: 'Workflows.action-none', defaultMessage: 'nothing — wait for an event'})
    }
}

export default WorkflowsDialog
