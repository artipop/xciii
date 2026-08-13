// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {Board, IPropertyTemplate, IPropertyOption} from '../../blocks/board'
import mutator from '../../mutator'
import {Utils, IDType} from '../../utils'
import Button from '../../widgets/buttons/button'
import {sendFlashMessage} from '../flashMessages'

import {agentBindings} from './bindings'
import {BOARD_PROP_BRANCH_PROPERTY, BOARD_PROP_PROJECT_PROPERTY, boardBranchProperty, legacyBoardProp} from './automation'

import './workdirsPanel.scss'

// What the property is *called* when this app has to make one. It is a name
// given at creation and never a key — the board records which property it is
// (BOARD_PROP_PROJECT_PROPERTY), so a person may rename the field and a board
// in another language is not obliged to spell it this way. The templates ship
// the property and the id together, so a board made from one never gets here.
//
// «Папки» rather than «Проекты»: what a card names is a folder on this machine,
// and calling it a project asked every board of household notes to have one.
// Boards made before this keep the name they carry — the field is found by the
// id the board recorded, never by what it is called.
const WORKDIR_PROPERTY_TITLE = 'Папки'

// And what the branch field is called when this app makes one. Same rule: a
// name given at creation, found afterwards by the id the board records.
const BRANCH_PROPERTY_TITLE = 'Ветка'

export type Workdir = {
    name: string
    path: string

    // The board it was added on, and — unless global — the only one that offers
    // it. Empty on entries written before workdirs belonged to a board.
    boardId?: string
    global?: boolean

    // What git says about the folder right now, asked per listing rather than
    // remembered: `git init` in a folder added last month makes it a
    // repository, and nothing in the registry changed.
    git?: boolean

    // What work here branches from. A setting, prefilled from the repository
    // when the folder was added.
    base?: string

    // Added as a repository, and the git is gone. The one state worth drawing:
    // everything that waits for a branch will fail on this folder.
    broken?: boolean
}

export function isWorkdirsAvailable(): boolean {
    return Boolean(agentBindings()?.ListAgentWorkdirs)
}

type Props = {
    board: Board

    // Fired after the registry changes, so the screen around it can decide
    // again whether this section is worth showing at all.
    onChange?: () => void
}

const WorkdirsPanel = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [workdirs, setWorkdirs] = createSignal<Workdir[]>([])
    const [orphans, setOrphans] = createSignal<Workdir[]>([])
    const [pendingPath, setPendingPath] = createSignal('')
    const [pendingName, setPendingName] = createSignal('')
    const [pendingGlobal, setPendingGlobal] = createSignal(false)
    const [error, setError] = createSignal('')

    // The board's workdir property, and it is the one the board says it is.
    // Nothing is matched by name: a board that has not recorded one has not got
    // one, and one is made.
    const findWorkdirProperty = (board: Board, properties: IPropertyTemplate[]) => {
        const recorded = board.properties?.[BOARD_PROP_PROJECT_PROPERTY] ??
            board.properties?.[legacyBoardProp(BOARD_PROP_PROJECT_PROPERTY)!]
        if (typeof recorded !== 'string' || !recorded) {
            return undefined
        }
        return properties.find((p: IPropertyTemplate) => p.id === recorded)
    }

    // The field a card names its folder in, quoted by the name this board gives
    // it: a board made before folders were called folders still says «Проекты»,
    // and a hint naming a field the board has not got sends somebody looking for
    // one that is not there.
    const propertyTitle = () => findWorkdirProperty(props.board, props.board.cardProperties)?.name || WORKDIR_PROPERTY_TITLE

    // syncToBoard mirrors the registry into that property, creating it when the
    // board has none. Add-only: existing options (which cards may reference) are
    // never removed, and a board that already lists every workdir is left
    // untouched — this runs on its own, so it must not churn the board or the
    // undo history.
    const syncToBoard = async (registry: Workdir[]) => {
        if (registry.length === 0) {
            return
        }
        const board = props.board
        const property = findWorkdirProperty(board, board.cardProperties)

        // A workdir marked "on every board" is offered to every board, and
        // syncing it would give a board of shopping lists a folder field it
        // never asked for. Such a workdir only reaches a board that already
        // knows about folders — one that has the field, because a workdir of
        // its own put it there.
        const mine = registry.filter((r) => !r.global || property)
        if (mine.length === 0) {
            return
        }

        const existing = new Set((property?.options || []).map((o: IPropertyOption) => o.value.trim().toLowerCase()))
        const missing = mine.filter((r) => !existing.has(r.name.trim().toLowerCase()))

        // A board with a repository among its folders gets a field for the
        // branch its cards work on. It is made here, beside the folder field,
        // because the two exist for the same reason and a board of shopping
        // lists must get neither: what puts it there is a folder that is
        // actually a repository.
        const wantsBranch = mine.some((r) => r.git) && !boardBranchProperty(board)
        if (property && missing.length === 0 && !wantsBranch) {
            return
        }

        try {
            const newProperties: IPropertyTemplate[] = board.cardProperties.map((p) => ({
                ...p,
                options: [...p.options],
            }))
            let target = newProperties.find((p) => p.id === property?.id)
            if (!target) {
                target = {
                    id: Utils.createGuid(IDType.BlockID),
                    name: WORKDIR_PROPERTY_TITLE,
                    type: 'multiSelect',
                    options: [],
                }
                newProperties.push(target)
            }
            for (const workdir of missing) {
                target.options.push({
                    id: Utils.createGuid(IDType.BlockID),
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

            // Written after the properties exist, and only for a board that has
            // just been given one — the templates ship the pairs, and a board
            // that already has them is never patched, so opening the dialog
            // leaves the undo history and the websocket alone.
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
            if (missing.length > 0) {
                sendFlashMessage({
                    content: intl.formatMessage(
                        {id: 'Workdirs.options-added', defaultMessage: 'Added {count, plural, one {# folder option} other {# folder options}} to "{property}"'},
                        {count: missing.length, property: target.name},
                    ),
                    severity: 'normal',
                })
            }
        } catch (e) {
            setError(String(e))
        }
    }

    const refresh = async () => {
        if (!bindings) {
            return
        }
        let registry: Workdir[] = []
        try {
            // This board's workdirs and the global ones — never somebody
            // else's, which is what used to end up in every board's field.
            registry = JSON.parse(await bindings.ListAgentWorkdirs(props.board.id)) || []
            setWorkdirs(registry)
        } catch (e) {
            setError(String(e))
            return
        }

        // Folders from before they belonged to a board: offered nowhere until
        // somebody says whose they are, and shown here so that "somebody" has
        // a place to say it.
        try {
            setOrphans(JSON.parse(await bindings.ListUnattachedWorkdirs?.() || '[]') || [])
        } catch {
            setOrphans([])
        }

        // The board’s folder field is kept in step on its own, so a workdir
        // this board has is selectable on a card without a second step.
        await syncToBoard(registry)
        props.onChange?.()
    }

    onMount(() => {
        refresh()
    })

    const pickDirectory = async () => {
        if (!bindings) {
            return
        }
        setError('')
        try {
            const path = await bindings.PickDirectory(intl.formatMessage({id: 'Workdirs.pick-title', defaultMessage: 'Choose a folder'}))
            if (path) {
                setPendingPath(path)
                setPendingName(path.split('/').filter(Boolean).pop() || '')
            }
        } catch (e) {
            setError(String(e))
        }
    }

    const confirmAdd = async () => {
        if (!bindings || !pendingPath()) {
            return
        }
        setError('')
        try {
            await bindings.AddAgentWorkdir(pendingName().trim(), pendingPath(), props.board.id, '', pendingGlobal())
            setPendingPath('')
            setPendingName('')
            setPendingGlobal(false)
            await refresh()
        } catch (e) {
            setError(String(e))
        }
    }

    const attach = async (name: string) => {
        if (!bindings?.AttachAgentWorkdir) {
            return
        }
        setError('')
        try {
            await bindings.AttachAgentWorkdir(name, props.board.id)
            await refresh()
        } catch (e) {
            setError(String(e))
        }
    }

    // Changed on blur rather than per keystroke: half a branch name is a
    // branch name nothing matches, and this is written to the config file.
    const setBase = async (name: string, branch: string) => {
        if (!bindings?.SetAgentWorkdirBase) {
            return
        }
        setError('')
        try {
            await bindings.SetAgentWorkdirBase(name, branch.trim())
            await refresh()
        } catch (e) {
            setError(String(e))
        }
    }

    const removeRepo = async (name: string) => {
        if (!bindings) {
            return
        }
        setError('')
        try {
            await bindings.RemoveAgentWorkdir(name)
            await refresh()
        } catch (e) {
            setError(String(e))
        }
    }

    return (
        <div class='WorkdirsPanel'>
            <div class='WorkdirsPanel__subtitle'>
                {intl.formatMessage({id: 'Workdirs.subtitle', defaultMessage: 'Folders on your machine an agent can work in. A card is matched to one by its "{property}" field. A board that runs no agents needs none of this.'}, {property: propertyTitle()})}
            </div>
            <div class='WorkdirsPanel__content'>
                <Show when={workdirs().length === 0 && !pendingPath()}>
                    <div class='WorkdirsPanel__empty'>
                        {intl.formatMessage({id: 'Workdirs.empty', defaultMessage: 'No folders added yet.'})}
                    </div>
                </Show>

                <For each={workdirs()}>
                    {(workdir) => (
                        <div
                            class='WorkdirsPanel__row'
                        >
                            <span class='WorkdirsPanel__name'>{workdir.name}</span>
                            <Show when={workdir.global}>
                                <span class='WorkdirsPanel__global'>
                                    {intl.formatMessage({id: 'Workdirs.global-badge', defaultMessage: 'all boards'})}
                                </span>
                            </Show>

                            {/* What the folder is, because it decides what work
                                in it looks like: a repository gets a branch of
                                its own, an ordinary folder is worked in as it
                                stands. The base branch is beside it because it
                                is the one thing about a repository somebody
                                changes — «develop» is an ordinary arrangement. */}
                            <Show
                                when={workdir.git}
                                fallback={
                                    <span class='WorkdirsPanel__kind'>
                                        <Show
                                            when={workdir.broken}
                                            fallback={intl.formatMessage({id: 'Workdirs.kind-plain', defaultMessage: 'folder'})}
                                        >
                                            <span class='WorkdirsPanel__broken'>
                                                {intl.formatMessage({id: 'Workdirs.kind-broken', defaultMessage: 'added as a repository, no git in it'})}
                                            </span>
                                        </Show>
                                    </span>
                                }
                            >
                                <span class='WorkdirsPanel__kind'>
                                    {intl.formatMessage({id: 'Workdirs.kind-git', defaultMessage: 'repository'})}
                                </span>
                                <input
                                    class='WorkdirsPanel__base'
                                    value={workdir.base || ''}
                                    title={intl.formatMessage({id: 'Workdirs.base-title', defaultMessage: 'Work here branches from this, and «merged» waits for it'})}
                                    onChange={(e) => setBase(workdir.name, e.currentTarget.value)}
                                />
                            </Show>

                            <span class='WorkdirsPanel__path'>{workdir.path}</span>
                            <Button
                                onClick={() => removeRepo(workdir.name)}
                                title={intl.formatMessage({id: 'Workdirs.remove', defaultMessage: 'Remove'})}
                            >
                                {intl.formatMessage({id: 'Workdirs.remove', defaultMessage: 'Remove'})}
                            </Button>
                        </div>
                    )}
                </For>

                {/* Folders the upgrade left without a board. Nothing offers
                    them, and their folders cannot simply be added again — the
                    path is taken — so this is the way back into use. */}
                <Show when={orphans().length > 0}>
                    <div class='WorkdirsPanel__orphans'>
                        <span class='WorkdirsPanel__orphansTitle'>
                            {intl.formatMessage({id: 'Workdirs.unattached', defaultMessage: 'Not on any board yet'})}
                        </span>
                        <For each={orphans()}>
                            {(workdir) => (
                                <div class='WorkdirsPanel__row'>
                                    <span class='WorkdirsPanel__name'>{workdir.name}</span>
                                    <span class='WorkdirsPanel__path'>{workdir.path}</span>
                                    <Button
                                        emphasis='primary'
                                        onClick={() => attach(workdir.name)}
                                    >
                                        {intl.formatMessage({id: 'Workdirs.attach', defaultMessage: 'Add to this board'})}
                                    </Button>
                                    <Button onClick={() => removeRepo(workdir.name)}>
                                        {intl.formatMessage({id: 'Workdirs.remove', defaultMessage: 'Remove'})}
                                    </Button>
                                </div>
                            )}
                        </For>
                    </div>
                </Show>

                <Show when={pendingPath()}>
                    <div class='WorkdirsPanel__row WorkdirsPanel__row--pending'>
                        <input
                            class='WorkdirsPanel__nameInput'
                            value={pendingName()}
                            placeholder={intl.formatMessage({id: 'Workdirs.name-placeholder', defaultMessage: 'Name (matches the option in "{property}")'}, {property: propertyTitle()})}
                            onInput={(e) => setPendingName(e.currentTarget.value)}
                        />
                        <span class='WorkdirsPanel__path'>{pendingPath()}</span>
                        {/* A workdir belongs to this board unless it is said to
                            belong to all of them — one checkout worked from
                            several boards is a real case, but it is the rare one. */}
                        <label class='WorkdirsPanel__globalToggle'>
                            <input
                                type='checkbox'
                                checked={pendingGlobal()}
                                onChange={(e) => setPendingGlobal(e.currentTarget.checked)}
                            />
                            {intl.formatMessage({id: 'Workdirs.global', defaultMessage: 'On every board'})}
                        </label>
                        <Button
                            emphasis='primary'
                            onClick={confirmAdd}
                        >
                            {intl.formatMessage({id: 'Workdirs.add', defaultMessage: 'Add'})}
                        </Button>
                        <Button onClick={() => setPendingPath('')}>
                            {intl.formatMessage({id: 'Workdirs.cancel', defaultMessage: 'Cancel'})}
                        </Button>
                    </div>
                </Show>

                <Show when={!pendingPath()}>
                    <div class='WorkdirsPanel__actions'>
                        <Button
                            emphasis='primary'
                            onClick={pickDirectory}
                        >
                            {intl.formatMessage({id: 'Workdirs.add-workdir', defaultMessage: 'Add a folder…'})}
                        </Button>
                    </div>
                </Show>

                <Show when={workdirs().length > 0}>
                    <div class='WorkdirsPanel__sync'>
                        <span>
                            {intl.formatMessage({id: 'Workdirs.sync-hint', defaultMessage: 'Every folder above is an option of this board’s "{property}" field, so a card picks one there. A folder added here belongs to this board unless it says otherwise.'}, {property: propertyTitle()})}
                        </span>
                    </div>
                </Show>

                <Show when={error()}>
                    <div class='WorkdirsPanel__error'>{error()}</div>
                </Show>
            </div>
        </div>
    )
}

export default WorkdirsPanel
