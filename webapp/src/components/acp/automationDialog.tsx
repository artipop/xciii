// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {Board, IPropertyTemplate, IPropertyOption} from '../../blocks/board'
import mutator from '../../mutator'
import {Utils, IDType} from '../../utils'
import Button from '../../widgets/buttons/button'
import Dialog from '../dialog'

import {agentBindings} from './agentProjectsDialog'
import AutomationEditor from './automationEditor'
import {StageCount} from './flowDiagram'
import {
    Automation,
    BoardColumn,
    Flow,
    FlowTrigger,
    automationChanges,
    boardColumns,
    columnProperty,
    routeOptionMissing,
    selectProperties,
} from './automation'

import './automationDialog.scss'

// What a live board runs, edited against the registry that runs it. The
// editor itself is in automationEditor.tsx and knows nothing about Go; this is
// the half that loads, saves and touches the board.
//
// The board's structure and the board's automation are saved at different
// moments, and deliberately: a column is the board's own (adding one shows up
// on the board at once, for everybody), while what happens in it is a machine
// setting that is only worth writing when the whole picture makes sense —
// which is what the engine checks when Save is pressed.

// FlowOverview is where the board's cards stand on one route.
type FlowOverview = {
    flow: string
    cards: number
    stages: StageCount[]
}

export function isAutomationAvailable(): boolean {
    return Boolean(agentBindings()?.ListFlows)
}

type Props = {
    board: Board

    // The column the dialog opens on, when it was opened from that column's
    // own menu on the board.
    focusColumnId?: string
    onClose: () => void
    onSaved?: () => void
}

const AutomationDialog = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [saved, setSaved] = createSignal<Automation>({columns: [], flows: []})
    const [draft, setDraft] = createSignal<Automation>({columns: [], flows: []})
    const [triggers, setTriggers] = createSignal<FlowTrigger[]>([])
    const [agents, setAgents] = createSignal<Array<{name: string}>>([])
    const [deploys, setDeploys] = createSignal<Array<{name: string}>>([])
    const [ready, setReady] = createSignal<Flow[]>([])
    const [counts, setCounts] = createSignal<Record<string, StageCount[]>>({})
    const [worktrees, setWorktrees] = createSignal(true)
    const [property, setProperty] = createSignal<IPropertyTemplate | undefined>(columnProperty(props.board))
    const [error, setError] = createSignal('')
    const [dirty, setDirty] = createSignal(false)

    const columns = (): BoardColumn[] => boardColumns(props.board, property()?.name)

    const refresh = async () => {
        if (!bindings?.ListFlows) {
            return
        }
        try {
            // What the board carries of its own becomes registry entries here
            // rather than on the first card move: an editor that showed nothing
            // for a board straight out of a template would be lying about it.
            await bindings.SeedBoardAutomation?.(props.board.id)

            const loaded: Automation = {
                columns: JSON.parse(await bindings.ListBoardColumns!(props.board.id)) || [],
                flows: JSON.parse(await bindings.ListFlows(props.board.id)) || [],
            }
            setSaved(loaded)
            setDraft(loaded)
            setDirty(false)
            if (bindings.ListFlowTriggers) {
                setTriggers(JSON.parse(await bindings.ListFlowTriggers()) || [])
            }
            if (bindings.ListAgents) {
                setAgents(JSON.parse(await bindings.ListAgents()) || [])
            }
            if (bindings.ListDeployTargets) {
                setDeploys(JSON.parse(await bindings.ListDeployTargets()) || [])
            }
            if (bindings.GetWorktreeMode) {
                setWorktrees((await bindings.GetWorktreeMode()) !== 'never')
            }
            if (bindings.ListFlowTemplates) {
                setReady(JSON.parse(await bindings.ListFlowTemplates()) || [])
            }
            if (bindings.GetBoardFlowOverview) {
                const overview: FlowOverview[] = JSON.parse(await bindings.GetBoardFlowOverview(props.board.id)) || []
                setCounts(Object.fromEntries(overview.map((o) => [o.flow, o.stages])))
            }
        } catch (e) {
            setError(String(e))
        }
    }

    onMount(() => {
        refresh()
    })

    const change = (next: Automation) => {
        setDraft(next)
        setDirty(true)
    }

    // A column is a option of the board's own property, so adding one is a
    // board edit and lands immediately — the automation around it is what waits
    // for Save.
    const addBoardColumn = async (name: string) => {
        const target = property()
        if (!target) {
            return
        }
        setError('')
        try {
            await mutator.insertPropertyOption(
                props.board.id,
                props.board.cardProperties,
                target,
                {id: Utils.createGuid(IDType.BlockID), value: name, color: 'propColorDefault'} as IPropertyOption,
                'add column',
            )
        } catch (e) {
            setError(String(e))
        }
    }

    // The option a card names its route with. Which property it goes in is the
    // board's business: the one that already names routes, or a new one if the
    // board has never had any.
    const addRouteOption = async (flow: Flow) => {
        setError('')
        const names = new Set(draft().flows.map((f) => f.name.trim().toLowerCase()))
        const holder = selectProperties(props.board).find((p) =>
            p.name !== property()?.name && (p.options || []).some((o) => names.has(o.value.trim().toLowerCase())))
        const option = {id: Utils.createGuid(IDType.BlockID), value: flow.name, color: 'propColorDefault'} as IPropertyOption
        try {
            if (holder) {
                await mutator.insertPropertyOption(props.board.id, props.board.cardProperties, holder, option, 'add route option')
                return
            }
            const created: IPropertyTemplate = {
                id: Utils.createGuid(IDType.BlockID),
                name: intl.formatMessage({id: 'Automation.route-property', defaultMessage: 'Route'}),
                type: 'select',
                options: [option],
            }
            await mutator.updateBoardCardProperties(
                props.board.id,
                props.board.cardProperties,
                [...props.board.cardProperties, created],
                'add route property',
            )
        } catch (e) {
            setError(String(e))
        }
    }

    // Everything the draft changed, in the order that keeps the registry
    // consistent while it is being written: a renamed route arrives before the
    // one it replaces is dropped.
    const save = async () => {
        if (!bindings) {
            return
        }
        setError('')
        const changes = automationChanges(saved(), draft())
        const failures: string[] = []
        const attempt = async (what: () => Promise<unknown>) => {
            try {
                await what()
            } catch (e) {
                failures.push(String(e))
            }
        }

        // One write at a time, and in this order: a renamed route has to arrive
        // before the one it replaces is dropped, and a refusal has to stop
        // being written over. Sequential is the point, not an oversight.
        /* eslint-disable no-await-in-loop */
        for (const spec of changes.savedColumns) {
            await attempt(() => bindings.SaveBoardColumn!(JSON.stringify(spec)))
        }
        for (const spec of changes.removedColumns) {
            await attempt(() => bindings.RemoveBoardColumn!(props.board.id, spec.optionId || '', spec.column))
        }
        for (const flow of changes.addedFlows) {
            await attempt(() => bindings.AddFlow!(JSON.stringify({...flow, boardId: props.board.id})))
        }
        for (const flow of changes.updatedFlows) {
            await attempt(() => bindings.UpdateFlow!(JSON.stringify({...flow, boardId: props.board.id})))
        }
        for (const flow of changes.removedFlows) {
            await attempt(() => bindings.RemoveFlow!(props.board.id, flow.name))
        }
        /* eslint-enable no-await-in-loop */

        // Whatever happened, the registry is now the truth — reloading is what
        // shows which half of a refused save did land.
        await refresh()
        if (failures.length > 0) {
            setError(failures.join('\n'))
            return
        }
        props.onSaved?.()
        props.onClose()
    }

    // A shipped route is offered only when this board has every column it
    // names: a route drawn over columns that are not there is not a start, it
    // is a puzzle.
    const offered = () => ready().filter((flow) =>
        !draft().flows.some((f) => f.name.toLowerCase() === flow.name.toLowerCase()) &&
        flow.nodes.every((n) => columns().some((c) => c.name.toLowerCase() === n.column.toLowerCase())))

    const takeReady = (flow: Flow) => {
        change({...draft(), flows: [...draft().flows, {...flow, boardId: props.board.id}]})
    }

    return (
        <Dialog
            class='AutomationDialog'
            title={<span>{intl.formatMessage({id: 'Automation.title', defaultMessage: 'How this board works'})}</span>}
            subtitle={<span>{intl.formatMessage({id: 'Automation.subtitle', defaultMessage: 'A column says what is done to a card that lands in it. A route says where the card goes afterwards.'})}</span>}
            onClose={props.onClose}
        >
            <div class='AutomationDialog__content'>
                <AutomationEditor
                    boardId={props.board.id}
                    property={property()}
                    properties={selectProperties(props.board)}
                    columns={columns()}
                    automation={draft()}
                    triggers={triggers()}
                    agents={agents()}
                    deploys={deploys()}
                    counts={counts()}
                    worktrees={worktrees()}
                    focusColumnId={props.focusColumnId}
                    onChange={change}
                    onPropertyChange={setProperty}
                    onAddBoardColumn={addBoardColumn}
                    onAddRouteOption={addRouteOption}
                    routeOptionMissing={(flow) => routeOptionMissing(props.board, flow)}
                />

                <Show when={offered().length > 0}>
                    <div class='AutomationDialog__ready'>
                        <span class='AutomationDialog__hint'>
                            {intl.formatMessage({id: 'Automation.ready-routes', defaultMessage: 'Ready-made routes for these columns:'})}
                        </span>
                        <For each={offered()}>
                            {(flow) => (
                                <Button onClick={() => takeReady(flow)}>{flow.name}</Button>
                            )}
                        </For>
                    </div>
                </Show>

                <div class='AutomationDialog__actions'>
                    <Button
                        emphasis='primary'
                        onClick={save}
                    >
                        {intl.formatMessage({id: 'Automation.save', defaultMessage: 'Save'})}
                    </Button>
                    <Button onClick={props.onClose}>
                        {intl.formatMessage({id: 'Automation.cancel', defaultMessage: 'Close'})}
                    </Button>
                    <Show when={dirty()}>
                        <span class='AutomationDialog__hint'>
                            {intl.formatMessage({id: 'Automation.unsaved', defaultMessage: 'Unsaved changes'})}
                        </span>
                    </Show>
                </div>

                <Show when={error()}>
                    <div class='AutomationDialog__error'>{error()}</div>
                </Show>
            </div>
        </Dialog>
    )
}

export default AutomationDialog
