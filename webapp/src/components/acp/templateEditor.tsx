// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onMount} from 'solid-js'

import {useIntl, IntlShape} from '../../intl'

import {Board} from '../../blocks/board'
import mutator from '../../mutator'
import Button from '../../widgets/buttons/button'
import Dialog from '../dialog'

import {agentBindings} from './bindings'
import {actionLabel} from './automationEditor'
import {
    Automation,
    BoardSetup,
    BoardSetupStep,
    SetupStepDef,
    boardAutomationProperties,
    boardColumns,
    columnProperty,
    columnsOf,
    impliedSetupSteps,
    readBoardAutomation,
    readBoardSetup,
    specFor,
} from './automation'

import './templateEditor.scss'

// A template is a board that has not been made yet: its columns, what happens
// in each of them, the routes cards take across it, and the questions it needs
// answered about the machine before any of that can run.
//
// What is edited here is only the last of those, plus the three things the
// template list shows — its name, its icon and what it is for. The automation
// is **shown and not edited**: a template is made by building the board and
// saving it («Сохранить как шаблон…»), so the routes it carries are already the
// ones that worked, and the way to change them is to change the board and save
// it again. It was the whole route canvas in a scrolling dialog, which put a
// graph editor between somebody and the two fields they came to fill in — and
// gave the same routes two places to be edited, one of them the copy nobody was
// looking at.
//
// It writes into the template board's own properties, which is where Go reads
// them from when a board is made from it (internal/acp/boardseed.go).

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
    const [setup, setSetup] = createSignal<BoardSetup | undefined>(readBoardSetup(props.board))
    const [defs, setDefs] = createSignal<SetupStepDef[]>([])
    const [error, setError] = createSignal('')

    // The automation is the template's as it stands. Nothing here changes it;
    // it is read to be shown, to work out the questions the template implies,
    // and to be written back untouched when the rest is saved.
    const automation: Automation = readBoardAutomation(props.board)

    onMount(async () => {
        if (!bindings?.ListSetupSteps) {
            return
        }
        try {
            setDefs(JSON.parse(await bindings.ListSetupSteps()) || [])
        } catch (e) {
            setError(String(e))
        }
    })

    const columns = () => boardColumns(props.board, columnProperty(props.board)?.name)

    // What a column does, for the summary: the name alone where nothing runs,
    // and the sentence beside it where something does.
    const columnLine = () => columns().map((c) => {
        const action = specFor(automation.columns, c)?.action || 'none'
        return action === 'none' ? c.name : `${c.name} (${actionLabel(intl, action)})`
    })

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
                properties: boardAutomationProperties(props.board, automation, setup()),
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
            subtitle={<span>{intl.formatMessage({id: 'TemplateEditor.subtitle', defaultMessage: 'A board made from this template arrives with the columns and routes below. Its name, what it is for, and what it asks about this machine are set here.'})}</span>}
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

                {/* What the template carries, in the words the board uses. It is
                    read here and changed on a board: the routes came off one,
                    and «Как работает эта доска…» is where a route is drawn. */}
                <div class='TemplateEditor__carries'>
                    <div class='TemplateEditor__sectionTitle'>
                        {intl.formatMessage({id: 'TemplateEditor.carries', defaultMessage: 'What the template carries'})}
                    </div>
                    <div class='TemplateEditor__carriesRow'>
                        <span class='TemplateEditor__carriesLabel'>
                            {intl.formatMessage({id: 'TemplateEditor.columns', defaultMessage: 'Columns'})}
                        </span>
                        <span>{columnLine().join(' · ') || '—'}</span>
                    </div>
                    <For each={automation.flows}>
                        {(flow) => (
                            <div class='TemplateEditor__carriesRow'>
                                <span class='TemplateEditor__carriesLabel'>{flow.name}</span>
                                <span>{columnsOf(flow, columns()).map((c) => c.name).join(' → ') || '—'}</span>
                            </div>
                        )}
                    </For>
                    <div class='TemplateEditor__hint'>
                        {intl.formatMessage({id: 'TemplateEditor.carries-hint', defaultMessage: 'Columns and routes are edited on a board — "How this board works…" — and come back here when the board is saved as a template again.'})}
                    </div>
                </div>

                <div class='TemplateEditor__setup'>
                    <div class='TemplateEditor__sectionTitle'>
                        {intl.formatMessage({id: 'TemplateEditor.setup', defaultMessage: 'What to ask when a board is made from this'})}
                    </div>
                    <Show
                        when={setup()}
                        fallback={
                            <div class='TemplateEditor__hint'>
                                {intl.formatMessage({id: 'TemplateEditor.setup-implied', defaultMessage: 'Worked out from the automation above: a template that deploys asks where to, one that tests asks for a browser. Name the steps yourself if that is not what you want.'})}
                                <Button onClick={() => setSetup({steps: impliedSetupSteps(automation, defs())})}>
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
    case 'source':
        return intl.formatMessage({id: 'TemplateEditor.step-source', defaultMessage: 'Somewhere cards arrive from'})
    default:
        return intl.formatMessage({id: 'TemplateEditor.step-done', defaultMessage: 'How to use it (asks nothing)'})
    }
}

export default TemplateEditor
