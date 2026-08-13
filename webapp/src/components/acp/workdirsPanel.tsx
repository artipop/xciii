// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {Board} from '../../blocks/board'
import Button from '../../widgets/buttons/button'
import {sendFlashMessage} from '../flashMessages'

import {agentBindings} from './bindings'
import {Workdir, WORKDIR_PROPERTY_TITLE, findWorkdirProperty, syncWorkdirsToBoard} from './workdirSync'

import './workdirsPanel.scss'

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

    // The field a card names its folder in, quoted by the name this board gives
    // it: a board made before folders were called folders still says «Проекты»,
    // and a hint naming a field the board has not got sends somebody looking for
    // one that is not there.
    const propertyTitle = () => findWorkdirProperty(props.board, props.board.cardProperties)?.name || WORKDIR_PROPERTY_TITLE

    // The registry into the board's own field, said out loud: a person who
    // just added a folder wants to know the card can now name it.
    const syncWorkdirs = async (registry: Workdir[]) => {
        try {
            const {added, property} = await syncWorkdirsToBoard(props.board, registry)
            if (added > 0) {
                sendFlashMessage({
                    content: intl.formatMessage(
                        {id: 'Workdirs.options-added', defaultMessage: 'Added {count, plural, one {# folder option} other {# folder options}} to "{property}"'},
                        {count: added, property: property?.name || propertyTitle()},
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
        await syncWorkdirs(registry)
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
                {intl.formatMessage({id: 'Workdirs.subtitle', defaultMessage: 'Folders on your machine an agent can work in. A card is matched to one by its "{property}" field. A folder under git is a repository — every card gets a branch of its own in it.'}, {property: propertyTitle()})}
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
