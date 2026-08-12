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
import {sendFlashMessage} from '../flashMessages'

import {agentBindings} from './bindings'
import {BOARD_PROP_PROJECT_PROPERTY, legacyBoardProp} from './automation'

import './agentProjectsPanel.scss'

// What the property is *called* when this app has to make one. It is a name
// given at creation and never a key — the board records which property it is
// (BOARD_PROP_PROJECT_PROPERTY), so a person may rename the field and a board
// in another language is not obliged to spell it this way. The templates ship
// the property and the id together, so a board made from one never gets here.
//
// A project is a git project, and the code still calls it one — that is what
// it is. What a person sees is "проект", because the board is not only for
// software: the thing a card sends an agent into happens to be a project.
const PROJECT_PROPERTY_TITLE = 'Проекты'

export type AgentProject = {
    name: string
    path: string

    // The board it was added on, and — unless global — the only one that offers
    // it. Empty on entries written before projects belonged to a board.
    boardId?: string
    global?: boolean
}

export function isAgentProjectsAvailable(): boolean {
    return Boolean(agentBindings()?.ListAgentProjects)
}

type Props = {
    board: Board

    // Fired after the registry changes, so the screen around it can decide
    // again whether this section is worth showing at all.
    onChange?: () => void
}

const AgentProjectsPanel = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [projects, setProjects] = createSignal<AgentProject[]>([])
    const [orphans, setOrphans] = createSignal<AgentProject[]>([])
    const [pendingPath, setPendingPath] = createSignal('')
    const [pendingName, setPendingName] = createSignal('')
    const [pendingGlobal, setPendingGlobal] = createSignal(false)
    const [error, setError] = createSignal('')

    // The board's project property, and it is the one the board says it is.
    // Nothing is matched by name: a board that has not recorded one has not got
    // one, and one is made.
    const findProjectProperty = (board: Board, properties: IPropertyTemplate[]) => {
        const recorded = board.properties?.[BOARD_PROP_PROJECT_PROPERTY] ??
            board.properties?.[legacyBoardProp(BOARD_PROP_PROJECT_PROPERTY)!]
        if (typeof recorded !== 'string' || !recorded) {
            return undefined
        }
        return properties.find((p: IPropertyTemplate) => p.id === recorded)
    }

    // syncToBoard mirrors the registry into that property, creating it when the
    // board has none. Add-only: existing options (which cards may reference) are
    // never removed, and a board that already lists every project is left
    // untouched — this runs on its own, so it must not churn the board or the
    // undo history.
    const syncToBoard = async (registry: AgentProject[]) => {
        if (registry.length === 0) {
            return
        }
        const board = props.board
        const property = findProjectProperty(board, board.cardProperties)

        // A project marked "on every board" is offered to every board, and
        // syncing it would give a board of shopping lists a "Projects" field it
        // never asked for. Such a project only reaches a board that already
        // knows about folders — one that has the field, because a project of
        // its own put it there.
        const mine = registry.filter((r) => !r.global || property)
        if (mine.length === 0) {
            return
        }

        const existing = new Set((property?.options || []).map((o: IPropertyOption) => o.value.trim().toLowerCase()))
        const missing = mine.filter((r) => !existing.has(r.name.trim().toLowerCase()))
        if (property && missing.length === 0) {
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
                    name: PROJECT_PROPERTY_TITLE,
                    type: 'multiSelect',
                    options: [],
                }
                newProperties.push(target)
            }
            for (const project of missing) {
                target.options.push({
                    id: Utils.createGuid(IDType.BlockID),
                    value: project.name,
                    color: 'propColorDefault',
                })
            }
            await mutator.updateBoardCardProperties(board.id, board.cardProperties, newProperties, 'sync projects')

            // Written after the property exists, and only for a board that has
            // just been given one — the templates ship the pair, and a board
            // that already has it is never patched, so opening the dialog
            // leaves the undo history and the websocket alone.
            if (!property) {
                await mutator.updateBoard(
                    {...board, properties: {...board.properties, [BOARD_PROP_PROJECT_PROPERTY]: target.id}},
                    board,
                    'remember the projects field',
                )
            }
            if (missing.length > 0) {
                sendFlashMessage({
                    content: intl.formatMessage(
                        {id: 'AgentProjects.options-added', defaultMessage: 'Added {count, plural, one {# project option} other {# project options}} to "{property}"'},
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
        let registry: AgentProject[] = []
        try {
            // This board's projects and the global ones — never somebody
            // else's, which is what used to end up in every board's field.
            registry = JSON.parse(await bindings.ListAgentProjects(props.board.id)) || []
            setProjects(registry)
        } catch (e) {
            setError(String(e))
            return
        }

        // Projects from before they belonged to a board: offered nowhere until
        // somebody says whose they are, and shown here so that "somebody" has
        // a place to say it.
        try {
            setOrphans(JSON.parse(await bindings.ListUnattachedProjects?.() || '[]') || [])
        } catch {
            setOrphans([])
        }

        // The board's "Projects" field is kept in step on its own, so a project
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
            const path = await bindings.PickDirectory(intl.formatMessage({id: 'AgentProjects.pick-title', defaultMessage: 'Choose a project folder'}))
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
            await bindings.AddAgentProject(pendingName().trim(), pendingPath(), props.board.id, pendingGlobal())
            setPendingPath('')
            setPendingName('')
            setPendingGlobal(false)
            await refresh()
        } catch (e) {
            setError(String(e))
        }
    }

    const attach = async (name: string) => {
        if (!bindings?.AttachAgentProject) {
            return
        }
        setError('')
        try {
            await bindings.AttachAgentProject(name, props.board.id)
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
            await bindings.RemoveAgentProject(name)
            await refresh()
        } catch (e) {
            setError(String(e))
        }
    }

    return (
        <div class='AgentProjectsPanel'>
            <div class='AgentProjectsPanel__subtitle'>
                {intl.formatMessage({id: 'AgentProjects.subtitle', defaultMessage: 'Folders on your machine an agent can work in. A card is matched to one by its "Projects" field. A board that runs no agents needs none of this.'})}
            </div>
            <div class='AgentProjectsPanel__content'>
                <Show when={projects().length === 0 && !pendingPath()}>
                    <div class='AgentProjectsPanel__empty'>
                        {intl.formatMessage({id: 'AgentProjects.empty', defaultMessage: 'No projects registered yet.'})}
                    </div>
                </Show>

                <For each={projects()}>
                    {(project) => (
                        <div
                            class='AgentProjectsPanel__row'
                        >
                            <span class='AgentProjectsPanel__name'>{project.name}</span>
                            <Show when={project.global}>
                                <span class='AgentProjectsPanel__global'>
                                    {intl.formatMessage({id: 'AgentProjects.global-badge', defaultMessage: 'all boards'})}
                                </span>
                            </Show>
                            <span class='AgentProjectsPanel__path'>{project.path}</span>
                            <Button
                                onClick={() => removeRepo(project.name)}
                                title={intl.formatMessage({id: 'AgentProjects.remove', defaultMessage: 'Remove'})}
                            >
                                {intl.formatMessage({id: 'AgentProjects.remove', defaultMessage: 'Remove'})}
                            </Button>
                        </div>
                    )}
                </For>

                {/* Projects the upgrade left without a board. Nothing offers
                    them, and their folders cannot simply be added again — the
                    path is taken — so this is the way back into use. */}
                <Show when={orphans().length > 0}>
                    <div class='AgentProjectsPanel__orphans'>
                        <span class='AgentProjectsPanel__orphansTitle'>
                            {intl.formatMessage({id: 'AgentProjects.unattached', defaultMessage: 'Not on any board yet'})}
                        </span>
                        <For each={orphans()}>
                            {(project) => (
                                <div class='AgentProjectsPanel__row'>
                                    <span class='AgentProjectsPanel__name'>{project.name}</span>
                                    <span class='AgentProjectsPanel__path'>{project.path}</span>
                                    <Button
                                        emphasis='primary'
                                        onClick={() => attach(project.name)}
                                    >
                                        {intl.formatMessage({id: 'AgentProjects.attach', defaultMessage: 'Add to this board'})}
                                    </Button>
                                    <Button onClick={() => removeRepo(project.name)}>
                                        {intl.formatMessage({id: 'AgentProjects.remove', defaultMessage: 'Remove'})}
                                    </Button>
                                </div>
                            )}
                        </For>
                    </div>
                </Show>

                <Show when={pendingPath()}>
                    <div class='AgentProjectsPanel__row AgentProjectsPanel__row--pending'>
                        <input
                            class='AgentProjectsPanel__nameInput'
                            value={pendingName()}
                            placeholder={intl.formatMessage({id: 'AgentProjects.name-placeholder', defaultMessage: 'Name (matches the "Projects" option)'})}
                            onInput={(e) => setPendingName(e.currentTarget.value)}
                        />
                        <span class='AgentProjectsPanel__path'>{pendingPath()}</span>
                        {/* A project belongs to this board unless it is said to
                            belong to all of them — one checkout worked from
                            several boards is a real case, but it is the rare one. */}
                        <label class='AgentProjectsPanel__globalToggle'>
                            <input
                                type='checkbox'
                                checked={pendingGlobal()}
                                onChange={(e) => setPendingGlobal(e.currentTarget.checked)}
                            />
                            {intl.formatMessage({id: 'AgentProjects.global', defaultMessage: 'On every board'})}
                        </label>
                        <Button
                            emphasis='primary'
                            onClick={confirmAdd}
                        >
                            {intl.formatMessage({id: 'AgentProjects.add', defaultMessage: 'Add'})}
                        </Button>
                        <Button onClick={() => setPendingPath('')}>
                            {intl.formatMessage({id: 'AgentProjects.cancel', defaultMessage: 'Cancel'})}
                        </Button>
                    </div>
                </Show>

                <Show when={!pendingPath()}>
                    <div class='AgentProjectsPanel__actions'>
                        <Button
                            emphasis='primary'
                            onClick={pickDirectory}
                        >
                            {intl.formatMessage({id: 'AgentProjects.add-project', defaultMessage: 'Add project…'})}
                        </Button>
                    </div>
                </Show>

                <Show when={projects().length > 0}>
                    <div class='AgentProjectsPanel__sync'>
                        <span>
                            {intl.formatMessage({id: 'AgentProjects.sync-hint', defaultMessage: 'Every project above is an option of this board’s "Projects" field, so a card picks one there. A project added here belongs to this board unless it says otherwise.'})}
                        </span>
                    </div>
                </Show>

                <Show when={error()}>
                    <div class='AgentProjectsPanel__error'>{error()}</div>
                </Show>
            </div>
        </div>
    )
}

export default AgentProjectsPanel
