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
import {sendFlashMessage} from '../flashMessages'

import './agentProjectsDialog.scss'

// The dedicated card property the registry syncs into. Cards are mapped to a
// project by an option of this (multiSelect) property.
//
// A project is a git project, and the code still calls it one — that is what
// it is. What a person sees is "проект", because the board is not only for
// software: the thing a card sends an agent into happens to be a project.
const PROJECT_PROPERTY_NAME = 'Проекты'

// What the property was called before, so a board that already has one is
// renamed rather than given a second. Only the name changes: the property keeps
// its id and its options, and a card refers to an option by id, so nothing a
// card points at moves. The Go side matches a card to a project by the option's
// *value*, never by the property's name, so it is not affected either.
const LEGACY_PROJECT_PROPERTY_NAMES = ['Repositories']

export type AgentProject = {
    name: string
    path: string

    // The board it was added on, and — unless global — the only one that offers
    // it. Empty on entries written before projects belonged to a board.
    boardId?: string
    global?: boolean
}

// agentBindings returns the Wails-injected ACP bindings, or undefined in
// browser/plugin deployments (mirrors the webSocketBaseURL guard pattern).
export function agentBindings() {
    return (window as unknown as import('../../types').IAppWindow).go?.main?.App
}

export function isAgentProjectsAvailable(): boolean {
    return Boolean(agentBindings()?.ListAgentProjects)
}

type Props = {
    board: Board
    onClose: () => void
}

const AgentProjectsDialog = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [projects, setProjects] = createSignal<AgentProject[]>([])
    const [pendingPath, setPendingPath] = createSignal('')
    const [pendingName, setPendingName] = createSignal('')
    const [pendingGlobal, setPendingGlobal] = createSignal(false)
    const [error, setError] = createSignal('')

    // The board's project property, under its current name or the one it had
    // before the rename.
    const findProjectProperty = (properties: IPropertyTemplate[]) => {
        const names = [PROJECT_PROPERTY_NAME, ...LEGACY_PROJECT_PROPERTY_NAMES].map((n) => n.toLowerCase())
        return properties.find((p: IPropertyTemplate) =>
            names.includes(p.name.trim().toLowerCase()) &&
            (p.type === 'select' || p.type === 'multiSelect'))
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
        const property = findProjectProperty(board.cardProperties)
        const existing = new Set((property?.options || []).map((o: IPropertyOption) => o.value.trim().toLowerCase()))
        const missing = registry.filter((r) => !existing.has(r.name.trim().toLowerCase()))
        const needsRename = Boolean(property) && property?.name !== PROJECT_PROPERTY_NAME
        if (property && missing.length === 0 && !needsRename) {
            return
        }

        try {
            const newProperties: IPropertyTemplate[] = board.cardProperties.map((p) => ({
                ...p,
                options: [...p.options],
            }))
            let target = findProjectProperty(newProperties)
            if (target) {
                // A board from before the rename keeps the property, its id and
                // its options; only the label a person reads changes.
                target.name = PROJECT_PROPERTY_NAME
            } else {
                target = {
                    id: Utils.createGuid(IDType.BlockID),
                    name: PROJECT_PROPERTY_NAME,
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
            if (missing.length > 0) {
                sendFlashMessage({
                    content: intl.formatMessage(
                        {id: 'AgentProjects.options-added', defaultMessage: 'Added {count} project option(s) to "{property}"'},
                        {count: missing.length, property: PROJECT_PROPERTY_NAME},
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

        // The board's "Projects" field is kept in step on its own, so a project
        // this board has is selectable on a card without a second step.
        await syncToBoard(registry)
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
        <Dialog
            class='AgentProjectsDialog'
            title={<span>{intl.formatMessage({id: 'AgentProjects.title', defaultMessage: 'Projects'})}</span>}
            subtitle={<span>{intl.formatMessage({id: 'AgentProjects.subtitle', defaultMessage: 'Projects on your machine an agent can work in. A card is matched to one by its "Projects" field.'})}</span>}
            onClose={props.onClose}
        >
            <div class='AgentReposDialog__content'>
                <Show when={projects().length === 0 && !pendingPath()}>
                    <div class='AgentReposDialog__empty'>
                        {intl.formatMessage({id: 'AgentProjects.empty', defaultMessage: 'No projects registered yet.'})}
                    </div>
                </Show>

                <For each={projects()}>
                    {(project) => (
                        <div
                            class='AgentReposDialog__row'
                        >
                            <span class='AgentReposDialog__name'>{project.name}</span>
                            <Show when={project.global}>
                                <span class='AgentReposDialog__global'>
                                    {intl.formatMessage({id: 'AgentProjects.global-badge', defaultMessage: 'all boards'})}
                                </span>
                            </Show>
                            <span class='AgentReposDialog__path'>{project.path}</span>
                            <Button
                                onClick={() => removeRepo(project.name)}
                                title={intl.formatMessage({id: 'AgentProjects.remove', defaultMessage: 'Remove'})}
                            >
                                {intl.formatMessage({id: 'AgentProjects.remove', defaultMessage: 'Remove'})}
                            </Button>
                        </div>
                    )}
                </For>

                <Show when={pendingPath()}>
                    <div class='AgentReposDialog__row AgentReposDialog__row--pending'>
                        <input
                            class='AgentReposDialog__nameInput'
                            value={pendingName()}
                            placeholder={intl.formatMessage({id: 'AgentProjects.name-placeholder', defaultMessage: 'Name (matches the "Projects" option)'})}
                            onInput={(e) => setPendingName(e.currentTarget.value)}
                        />
                        <span class='AgentReposDialog__path'>{pendingPath()}</span>
                        {/* A project belongs to this board unless it is said to
                            belong to all of them — one checkout worked from
                            several boards is a real case, but it is the rare one. */}
                        <label class='AgentReposDialog__globalToggle'>
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
                    <div class='AgentReposDialog__actions'>
                        <Button
                            emphasis='primary'
                            onClick={pickDirectory}
                        >
                            {intl.formatMessage({id: 'AgentProjects.add-project', defaultMessage: 'Add project…'})}
                        </Button>
                    </div>
                </Show>

                <Show when={projects().length > 0}>
                    <div class='AgentReposDialog__sync'>
                        <span>
                            {intl.formatMessage({id: 'AgentProjects.sync-hint', defaultMessage: 'Every project above is an option of this board’s "Projects" field, so a card picks one there. A project added here belongs to this board unless it says otherwise.'})}
                        </span>
                    </div>
                </Show>

                <Show when={error()}>
                    <div class='AgentReposDialog__error'>{error()}</div>
                </Show>
            </div>
        </Dialog>
    )
}

export default AgentProjectsDialog
