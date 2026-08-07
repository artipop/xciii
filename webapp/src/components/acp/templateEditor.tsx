// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onMount} from 'solid-js'

import {useIntl, IntlShape} from '../../intl'

import {Board, IPropertyOption, IPropertyTemplate} from '../../blocks/board'
import mutator from '../../mutator'
import {Utils, IDType} from '../../utils'
import Button from '../../widgets/buttons/button'
import Dialog from '../dialog'

import {agentBindings} from './agentProjectsDialog'
import AutomationEditor from './automationEditor'
import {
    Automation,
    BoardSetup,
    BoardSetupStep,
    Flow,
    FlowTrigger,
    SetupStepDef,
    boardAutomationProperties,
    boardColumns,
    columnProperty,
    impliedSetupSteps,
    readBoardAutomation,
    readBoardSetup,
    routeOptionMissing,
    selectProperties,
} from './automation'

import './templateEditor.scss'

// A template is a board that has not been made yet: its columns, what happens
// in each of them, the routes cards take across it, and the questions it needs
// answered about the machine before any of that can run.
//
// Focalboard's own answer to "edit a template" is to open the board and let you
// move cards around on it, which says nothing about the three things this
// product added. So a template is edited here instead, and the board behind is
// still the board — this dialog only ever writes what the board itself cannot
// show: the automation, and the setup the automation implies.
//
// It writes into the template board's own properties, which is where Go reads
// them from when a board is made from it (internal/acp/boardseed.go). A live
// board's automation lives in the registry instead — same editor, different
// container.

type Props = {
    board: Board
    onClose: () => void
    onSaved?: () => void
}

const TemplateEditor = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [title, setTitle] = createSignal(props.board.title)
    const [icon, setIcon] = createSignal(props.board.icon || '')
    const [description, setDescription] = createSignal(props.board.description || '')
    const [automation, setAutomation] = createSignal<Automation>(readBoardAutomation(props.board))
    const [setup, setSetup] = createSignal<BoardSetup | undefined>(readBoardSetup(props.board))
    const [defs, setDefs] = createSignal<SetupStepDef[]>([])
    const [triggers, setTriggers] = createSignal<FlowTrigger[]>([])
    const [agents, setAgents] = createSignal<Array<{name: string}>>([])
    const [deploys, setDeploys] = createSignal<Array<{name: string}>>([])
    const [property, setProperty] = createSignal<IPropertyTemplate | undefined>(columnProperty(props.board))
    const [error, setError] = createSignal('')

    onMount(async () => {
        if (!bindings) {
            return
        }
        try {
            if (bindings.ListSetupSteps) {
                setDefs(JSON.parse(await bindings.ListSetupSteps()) || [])
            }
            if (bindings.ListFlowTriggers) {
                setTriggers(JSON.parse(await bindings.ListFlowTriggers()) || [])
            }
            if (bindings.ListAgents) {
                setAgents(JSON.parse(await bindings.ListAgents()) || [])
            }
            if (bindings.ListDeployTargets) {
                setDeploys(JSON.parse(await bindings.ListDeployTargets()) || [])
            }
        } catch (e) {
            setError(String(e))
        }
    })

    // A template's automation names no board: the board it will run on does not
    // exist yet, and stamping this one's id in would tie every copy to the
    // template. Go fills it in when the copy is first opened.
    const columns = () => boardColumns(props.board, property()?.name)

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
                'add column to template',
            )
        } catch (e) {
            setError(String(e))
        }
    }

    const addRouteOption = async (flow: Flow) => {
        setError('')
        const names = new Set(automation().flows.map((f) => f.name.trim().toLowerCase()))
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

    const steps = () => setup()?.steps || []
    const stepAt = (kind: string) => steps().find((s) => s.kind === kind)

    const setStep = (kind: string, patch: Partial<BoardSetupStep> | null) => {
        const current = steps()
        if (patch === null) {
            setSetup({steps: current.filter((s) => s.kind !== kind)})
            return
        }
        if (!current.some((s) => s.kind === kind)) {
            // Kept in the app's own order rather than the order they were
            // ticked: the wizard walks them in the order the work needs them.
            const order = defs().map((d) => d.kind)
            const next = [...current, {kind, ...patch}]
            next.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
            setSetup({steps: next})
            return
        }
        setSetup({steps: current.map((s) => (s.kind === kind ? {...s, ...patch} : s))})
    }

    const save = async () => {
        setError('')
        try {
            const next: Board = {
                ...props.board,
                title: title().trim() || props.board.title,
                icon: icon(),
                description: description(),
                properties: boardAutomationProperties(props.board, automation(), setup()),
            }
            await mutator.updateBoard(next, props.board, 'edit template')
            props.onSaved?.()
            props.onClose()
        } catch (e) {
            setError(String(e))
        }
    }

    return (
        <Dialog
            class='TemplateEditor'
            title={<span>{intl.formatMessage({id: 'TemplateEditor.title', defaultMessage: 'Template'})}</span>}
            subtitle={<span>{intl.formatMessage({id: 'TemplateEditor.subtitle', defaultMessage: 'What a board made from this template arrives knowing: its columns, what happens in them, the routes cards take, and what it has to ask about this machine.'})}</span>}
            onClose={props.onClose}
        >
            <div class='TemplateEditor__content'>
                <div class='TemplateEditor__meta'>
                    <label class='TemplateEditor__icon'>
                        {intl.formatMessage({id: 'TemplateEditor.icon', defaultMessage: 'Icon'})}
                        <input
                            value={icon()}
                            maxLength={2}
                            onInput={(e) => setIcon(e.currentTarget.value)}
                        />
                    </label>
                    <label class='TemplateEditor__name'>
                        {intl.formatMessage({id: 'TemplateEditor.name', defaultMessage: 'Name'})}
                        <input
                            value={title()}
                            onInput={(e) => setTitle(e.currentTarget.value)}
                        />
                    </label>
                    <label class='TemplateEditor__description'>
                        {intl.formatMessage({id: 'TemplateEditor.description', defaultMessage: 'What it is for'})}
                        <input
                            value={description()}
                            placeholder={intl.formatMessage({id: 'TemplateEditor.description-placeholder', defaultMessage: 'One line, shown beside the template'})}
                            onInput={(e) => setDescription(e.currentTarget.value)}
                        />
                    </label>
                </div>

                <AutomationEditor
                    boardId=''
                    property={property()}
                    properties={selectProperties(props.board)}
                    columns={columns()}
                    automation={automation()}
                    triggers={triggers()}
                    agents={agents()}
                    deploys={deploys()}
                    onChange={setAutomation}
                    onPropertyChange={setProperty}
                    onAddBoardColumn={addBoardColumn}
                    onAddRouteOption={addRouteOption}
                    routeOptionMissing={(flow) => routeOptionMissing(props.board, flow)}
                />

                <div class='TemplateEditor__setup'>
                    <div class='TemplateEditor__sectionTitle'>
                        {intl.formatMessage({id: 'TemplateEditor.setup', defaultMessage: 'What to ask when a board is made from this'})}
                    </div>
                    <Show
                        when={setup()}
                        fallback={
                            <div class='TemplateEditor__hint'>
                                {intl.formatMessage({id: 'TemplateEditor.setup-implied', defaultMessage: 'Worked out from the automation above: a template that deploys asks where to, one that tests asks for a browser. Name the steps yourself if that is not what you want.'})}
                                <Button onClick={() => setSetup({steps: impliedSetupSteps(automation(), defs())})}>
                                    {intl.formatMessage({id: 'TemplateEditor.setup-declare', defaultMessage: 'Name the steps'})}
                                </Button>
                            </div>
                        }
                    >
                        <For each={defs()}>
                            {(def) => (
                                <div class='TemplateEditor__step'>
                                    <label class='TemplateEditor__stepOn'>
                                        <input
                                            type='checkbox'
                                            checked={Boolean(stepAt(def.kind))}
                                            disabled={def.kind === 'done'}
                                            onChange={(e) => setStep(def.kind, e.currentTarget.checked ? {} : null)}
                                        />
                                        {stepTitle(intl, def.kind)}
                                    </label>
                                    <Show when={stepAt(def.kind) && def.kind !== 'done'}>
                                        <input
                                            class='TemplateEditor__stepHint'
                                            value={stepAt(def.kind)?.hint || ''}
                                            placeholder={intl.formatMessage({id: 'TemplateEditor.step-hint', defaultMessage: 'A line of your own beside the question'})}
                                            onInput={(e) => setStep(def.kind, {hint: e.currentTarget.value})}
                                        />
                                        <Show when={def.optional}>
                                            <label class='TemplateEditor__stepRequired'>
                                                <input
                                                    type='checkbox'
                                                    checked={Boolean(stepAt(def.kind)?.required)}
                                                    onChange={(e) => setStep(def.kind, {required: e.currentTarget.checked})}
                                                />
                                                {intl.formatMessage({id: 'TemplateEditor.step-required', defaultMessage: 'cannot be skipped'})}
                                            </label>
                                        </Show>
                                    </Show>
                                </div>
                            )}
                        </For>
                        <Button onClick={() => setSetup(undefined)}>
                            {intl.formatMessage({id: 'TemplateEditor.setup-auto', defaultMessage: 'Work them out from the automation again'})}
                        </Button>
                    </Show>
                </div>

                <div class='TemplateEditor__actions'>
                    <Button
                        emphasis='primary'
                        onClick={save}
                    >
                        {intl.formatMessage({id: 'TemplateEditor.save', defaultMessage: 'Save template'})}
                    </Button>
                    <Button onClick={props.onClose}>
                        {intl.formatMessage({id: 'TemplateEditor.cancel', defaultMessage: 'Cancel'})}
                    </Button>
                </div>

                <Show when={error()}>
                    <div class='TemplateEditor__error'>{error()}</div>
                </Show>
            </div>
        </Dialog>
    )
}

// stepTitle names a setup step the way the wizard asks it.
export function stepTitle(intl: IntlShape, kind: string): string {
    switch (kind) {
    case 'project':
        return intl.formatMessage({id: 'TemplateEditor.step-project', defaultMessage: 'A folder to work in'})
    case 'agent':
        return intl.formatMessage({id: 'TemplateEditor.step-agent', defaultMessage: 'An agent to pick cards up'})
    case 'deploy':
        return intl.formatMessage({id: 'TemplateEditor.step-deploy', defaultMessage: 'Somewhere to deploy to'})
    case 'browser':
        return intl.formatMessage({id: 'TemplateEditor.step-browser', defaultMessage: 'A browser for test runs'})
    default:
        return intl.formatMessage({id: 'TemplateEditor.step-done', defaultMessage: 'How to use it (asks nothing)'})
    }
}

export default TemplateEditor
