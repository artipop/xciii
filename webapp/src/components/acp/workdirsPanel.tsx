// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {Board} from '../../blocks/board'
import Button from '../../widgets/buttons/button'
import CompassIcon from '../../widgets/icons/compassIcon'
import {sendFlashMessage} from '../flashMessages'

import {agentBindings} from './bindings'
import {Workdir, WORKDIR_PROPERTY_TITLE, findWorkdirProperty, syncWorkdirsToBoard, useWorkdirHere} from './workdirSync'

import './workdirsPanel.scss'

// The folders this board's agents work in — one card per folder, not one row.
//
// A row it was: name, kind, base branch, two mode buttons, the whole path and a
// «Удалить» button, seven controls on one line with nothing saying which
// question any of them answered — and the path, the least useful of them, took
// the most width. So a folder is a small card now: what it is called and what
// it is on the first line, where it is on the second, and — only for a
// repository — the two questions a repository actually has, each with its
// question written next to it.
//
// The sentence under the list went with it: it said again what the subtitle
// already says.

// A path, split so the ellipsis never eats the half that matters. The last
// segment is the folder itself and is always drawn; everything above it gives
// way. CSS alone cannot do this: truncating a path from the left needs
// `direction: rtl`, which then draws the leading «/» at the end.
export function pathParts(path: string): {head: string, tail: string} {
    const at = path.replace(/\/+$/, '').lastIndexOf('/')
    if (at <= 0) {
        return {head: '', tail: path}
    }
    return {head: path.slice(0, at), tail: path.slice(at)}
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

    // Which folder was asked to be removed. Asked because a mis-click costs
    // the folder's settings and leaves the cards that named it pointing at
    // nothing — the same reason ending a terminal is asked about.
    const [removing, setRemoving] = createSignal('')

    // A folder somebody has already added, picked again. Refusing it is a dead
    // end — the person would have to find the board it belongs to and change
    // it there — so the answer is a question: use it here too?
    const [taken, setTaken] = createSignal<Workdir | null>(null)
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
            if (!path) {
                return
            }
            const already = JSON.parse(await bindings.FindAgentWorkdir?.(path) || 'null')
            setTaken(already)
            setPendingPath(path)
            setPendingName(path.split('/').filter(Boolean).pop() || '')
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

    const useTaken = async () => {
        const entry = taken()
        if (!entry) {
            return
        }
        setError('')
        try {
            await useWorkdirHere(entry, props.board.id)
            setTaken(null)
            setPendingPath('')
            setPendingName('')
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

    // How a repository is worked in — for this board: a folder belongs to one
    // board anyway, and the one marked «на всех досках» is exactly where two
    // boards may want different answers.
    const setMode = async (name: string, mode: string) => {
        if (!bindings?.SetAgentWorkdirMode) {
            return
        }
        setError('')
        try {
            await bindings.SetAgentWorkdirMode(name, props.board.id, mode)
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
            setRemoving('')
            await refresh()
        } catch (e) {
            setError(String(e))
        }
    }

    const folderPath = (path: string) => (
        <div
            class='WorkdirsPanel__path'
            title={path}
        >
            <span class='WorkdirsPanel__pathHead'>{pathParts(path).head}</span>
            <span class='WorkdirsPanel__pathTail'>{pathParts(path).tail}</span>
        </div>
    )

    // The × and, once it is pressed, the question — the shape the terminals
    // list already uses for the one action that cannot be undone by repeating
    // it.
    const removeButton = (name: string) => (
        <Show
            when={removing() === name}
            fallback={
                <button
                    type='button'
                    class='WorkdirsPanel__iconButton'
                    title={intl.formatMessage({id: 'Workdirs.remove', defaultMessage: 'Remove'})}
                    aria-label={intl.formatMessage({id: 'Workdirs.remove', defaultMessage: 'Remove'})}
                    onClick={() => setRemoving(name)}
                >
                    <CompassIcon icon='close'/>
                </button>
            }
        >
            <div class='WorkdirsPanel__confirm'>
                <span class='WorkdirsPanel__confirmAsk'>
                    {intl.formatMessage({id: 'Workdirs.remove-ask', defaultMessage: 'Remove from the list?'})}
                </span>
                <button
                    type='button'
                    class='WorkdirsPanel__confirmYes'
                    onClick={() => removeRepo(name)}
                >
                    {intl.formatMessage({id: 'Workdirs.remove-yes', defaultMessage: 'Remove'})}
                </button>
                <button
                    type='button'
                    class='WorkdirsPanel__confirmNo'
                    onClick={() => setRemoving('')}
                >
                    {intl.formatMessage({id: 'Workdirs.cancel', defaultMessage: 'Cancel'})}
                </button>
            </div>
        </Show>
    )

    return (
        <div class='WorkdirsPanel'>
            <p class='WorkdirsPanel__subtitle'>
                {intl.formatMessage({id: 'Workdirs.subtitle', defaultMessage: 'Folders on your machine an agent of this board can work in. A card picks one of them in its "{property}" field.'}, {property: propertyTitle()})}
            </p>

            <div class='WorkdirsPanel__content'>
                <Show when={workdirs().length === 0 && !pendingPath()}>
                    <div class='WorkdirsPanel__empty'>
                        {intl.formatMessage({id: 'Workdirs.empty', defaultMessage: 'No folders added yet.'})}
                    </div>
                </Show>

                <ul class='WorkdirsPanel__list'>
                    <For each={workdirs()}>
                        {(workdir) => (
                            <li class='WorkdirsPanel__folder'>
                                <div class='WorkdirsPanel__folderMain'>
                                    <div class='WorkdirsPanel__head'>
                                        <span class='WorkdirsPanel__name'>{workdir.name}</span>

                                        {/* What the folder is, asked of git
                                            every time it is listed — a folder
                                            somebody ran `git init` in last week
                                            is a repository now, and the registry
                                            was never told. */}
                                        <Show when={workdir.git}>
                                            <span class='WorkdirsPanel__badge'>
                                                {intl.formatMessage({id: 'Workdirs.kind-git', defaultMessage: 'repository'})}
                                            </span>
                                        </Show>
                                        <Show when={workdir.broken}>
                                            <span class='WorkdirsPanel__badge WorkdirsPanel__badge--broken'>
                                                {intl.formatMessage({id: 'Workdirs.kind-broken', defaultMessage: 'added as a repository, no git in it'})}
                                            </span>
                                        </Show>
                                        <Show when={workdir.global}>
                                            <span class='WorkdirsPanel__badge'>
                                                {intl.formatMessage({id: 'Workdirs.global-badge', defaultMessage: 'all boards'})}
                                            </span>
                                        </Show>
                                    </div>

                                    {folderPath(workdir.path)}

                                    {/* The two questions a repository has, each
                                        with its question written beside it. As
                                        buttons rather than a select, because
                                        the answer is then readable while the
                                        list is being read. */}
                                    <Show when={workdir.git}>
                                        <div class='WorkdirsPanel__repo'>
                                            <div class='WorkdirsPanel__field'>
                                                <span class='WorkdirsPanel__label'>
                                                    {intl.formatMessage({id: 'Workdirs.mode-label', defaultMessage: 'The agent works'})}
                                                </span>
                                                <div class='WorkdirsPanel__modes'>
                                                    <For each={['worktree', 'branch']}>
                                                        {(mode) => (
                                                            <button
                                                                type='button'
                                                                class={`WorkdirsPanel__mode ${workdir.mode === mode ? 'WorkdirsPanel__mode--on' : ''}`}
                                                                title={mode === 'worktree' ?
                                                                    intl.formatMessage({id: 'Workdirs.mode-worktree-why', defaultMessage: 'a branch and a checkout per card — several cards of this repository at once, and your own checkout is left alone'}) :
                                                                    intl.formatMessage({id: 'Workdirs.mode-branch-why', defaultMessage: 'a branch in the folder itself — one card at a time, and you see the work in your editor as it happens'})}
                                                                onClick={() => setMode(workdir.name, mode)}
                                                            >
                                                                {mode === 'worktree' ?
                                                                    intl.formatMessage({id: 'Workdirs.mode-worktree', defaultMessage: 'in a copy of its own'}) :
                                                                    intl.formatMessage({id: 'Workdirs.mode-branch', defaultMessage: 'in the folder itself'})}
                                                            </button>
                                                        )}
                                                    </For>
                                                </div>
                                            </div>

                                            <div class='WorkdirsPanel__field'>
                                                <span class='WorkdirsPanel__label'>
                                                    {intl.formatMessage({id: 'Workdirs.base-label', defaultMessage: 'Work branches from'})}
                                                </span>
                                                <input
                                                    class='WorkdirsPanel__base'
                                                    value={workdir.base || ''}
                                                    aria-label={intl.formatMessage({id: 'Workdirs.base-label', defaultMessage: 'Work branches from'})}
                                                    title={intl.formatMessage({id: 'Workdirs.base-title', defaultMessage: 'Work here branches from this, and «merged» waits for it'})}
                                                    onChange={(e) => setBase(workdir.name, e.currentTarget.value)}
                                                />
                                            </div>
                                        </div>
                                    </Show>
                                </div>

                                {removeButton(workdir.name)}
                            </li>
                        )}
                    </For>
                </ul>

                {/* Folders the upgrade left without a board. Nothing offers
                    them, and their folders cannot simply be added again — the
                    path is taken — so this is the way back into use. */}
                <Show when={orphans().length > 0}>
                    <div class='WorkdirsPanel__orphans'>
                        <span class='WorkdirsPanel__sectionTitle'>
                            {intl.formatMessage({id: 'Workdirs.unattached', defaultMessage: 'Not on any board yet'})}
                        </span>
                        <ul class='WorkdirsPanel__list'>
                            <For each={orphans()}>
                                {(workdir) => (
                                    <li class='WorkdirsPanel__folder'>
                                        <div class='WorkdirsPanel__folderMain'>
                                            <div class='WorkdirsPanel__head'>
                                                <span class='WorkdirsPanel__name'>{workdir.name}</span>
                                            </div>
                                            {folderPath(workdir.path)}
                                        </div>
                                        <Button
                                            emphasis='primary'
                                            onClick={() => attach(workdir.name)}
                                        >
                                            {intl.formatMessage({id: 'Workdirs.attach', defaultMessage: 'Add to this board'})}
                                        </Button>
                                        {removeButton(workdir.name)}
                                    </li>
                                )}
                            </For>
                        </ul>
                    </div>
                </Show>

                {/* Picked a folder somebody has already added: the answer is
                    a question rather than a refusal, because "it is on another
                    board" is not a mistake — one checkout worked from two
                    boards is an ordinary arrangement. */}
                <Show when={taken()}>
                    {(entry) => (
                        <div class='WorkdirsPanel__pending'>
                            <span class='WorkdirsPanel__taken'>
                                {intl.formatMessage(
                                    {id: 'Workdirs.already-added', defaultMessage: 'This folder is already added as "{name}". Use it on this board too?'},
                                    {name: entry().name},
                                )}
                            </span>
                            <div class='WorkdirsPanel__pendingActions'>
                                <Button
                                    emphasis='primary'
                                    onClick={useTaken}
                                >
                                    {intl.formatMessage({id: 'Workdirs.use-here', defaultMessage: 'Use it here'})}
                                </Button>
                                <Button onClick={() => {
                                    setTaken(null)
                                    setPendingPath('')
                                }}
                                >
                                    {intl.formatMessage({id: 'Workdirs.cancel', defaultMessage: 'Cancel'})}
                                </Button>
                            </div>
                        </div>
                    )}
                </Show>

                <Show when={pendingPath() && !taken()}>
                    <div class='WorkdirsPanel__pending'>
                        {folderPath(pendingPath())}
                        <div class='WorkdirsPanel__field'>
                            <span class='WorkdirsPanel__label'>
                                {intl.formatMessage({id: 'Workdirs.name-label', defaultMessage: 'Called'})}
                            </span>
                            <input
                                class='WorkdirsPanel__nameInput'
                                value={pendingName()}
                                aria-label={intl.formatMessage({id: 'Workdirs.name-label', defaultMessage: 'Called'})}
                                placeholder={intl.formatMessage({id: 'Workdirs.name-placeholder', defaultMessage: 'Name (matches the option in "{property}")'}, {property: propertyTitle()})}
                                onInput={(e) => setPendingName(e.currentTarget.value)}
                            />
                        </div>

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

                        <div class='WorkdirsPanel__pendingActions'>
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

                <Show when={error()}>
                    <div class='WorkdirsPanel__error'>{error()}</div>
                </Show>
            </div>
        </div>
    )
}

export default WorkdirsPanel
