// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {Board} from '../../blocks/board'
import CompassIcon from '../../widgets/icons/compassIcon'

import {agentBindings} from './bindings'

import './folderChoices.scss'

// «В какой папке будет работать агент?» — asked in one shape wherever it is
// asked: beside a card (cardTerminal.tsx) and in «Обсудить с агентом»
// (planningDialog.tsx).
//
// Every answer is a chip, and that is the whole design. It used to be a row of
// folder chips *plus* two full-width buttons — one for the board's drafts folder
// and one for the native picker — so the answer a person mostly wanted was a
// small chip beside two large controls, and which of the three was the same kind
// of thing as the others was anybody's guess. Now the folders are chips, the
// board's own drafts folder is a chip among them, and registering a new folder is
// a quiet «Добавить папку…» link — exactly the shape «Добавить агента…» has in
// the question before this one.
//
// The folders offered are the board's own (its registered projects and the ones
// marked "on every board"), not every folder on the machine: this is one board's
// conversation, and a folder that is not on it is one click away through the
// picker, which registers it here.

type Props = {

    // Whose folders to offer, and where a folder added by hand is registered.
    board: Board

    // Called with the answer: a project's name, or '' for the board's own drafts
    // folder, which is what Go resolves an empty name into.
    onPick: (projectName: string) => void
    disabled?: boolean
}

type NamedEntry = {name: string}

const FolderChoices = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [projects, setProjects] = createSignal<NamedEntry[]>([])
    const [error, setError] = createSignal('')

    const load = async () => {
        if (!bindings?.ListAgentProjects) {
            return
        }
        try {
            setProjects(JSON.parse(await bindings.ListAgentProjects(props.board.id)) || [])
        } catch (e: any) {
            // A registry we could not read leaves the drafts folder as the
            // answer, which is better than a dialog that refuses to draw.
            setError(String(e?.message || e))
        }
    }

    onMount(load)

    // A folder is two answers — where it is and what to call it — and the native
    // picker gives both. It is registered on this board (never globally: that is
    // a checkbox in the settings), and picking is itself the answer.
    const addFolder = async () => {
        if (!bindings?.PickDirectory || !bindings.AddAgentProject) {
            return
        }
        try {
            const path = await bindings.PickDirectory(intl.formatMessage({id: 'CardTerminal.pick-project', defaultMessage: 'Choose a folder to work in'}))
            if (!path) {
                return
            }
            const name = path.split('/').filter(Boolean).pop() || path
            await bindings.AddAgentProject(name, path, props.board.id, false)
            await load()
            props.onPick(name)
        } catch (e: any) {
            setError(String(e?.message || e))
        }
    }

    return (
        <div class='FolderChoices'>
            <div class='FolderChoices__chips'>
                <For each={projects()}>
                    {(project) => (
                        <button
                            type='button'
                            class='FolderChoices__chip'
                            disabled={props.disabled}
                            onClick={() => props.onPick(project.name)}
                        >
                            {project.name}
                        </button>
                    )}
                </For>

                {/* The board's own drafts folder, a chip like the rest of them:
                    a conversation about wording, a brief or a plan needs a place
                    to write, not a repository. */}
                <button
                    type='button'
                    class='FolderChoices__chip FolderChoices__chip--drafts'
                    disabled={props.disabled}
                    onClick={() => props.onPick('')}
                >
                    <CompassIcon icon='notebook-outline'/>
                    {intl.formatMessage({id: 'CardTerminal.board-drafts', defaultMessage: 'The board’s drafts'})}
                </button>

                <Show when={Boolean(bindings?.PickDirectory)}>
                    <button
                        type='button'
                        class='FolderChoices__add'
                        disabled={props.disabled}
                        onClick={addFolder}
                    >
                        {intl.formatMessage({id: 'CardTerminal.add-folder', defaultMessage: 'Add a folder…'})}
                    </button>
                </Show>
            </div>

            <div class='FolderChoices__note'>
                {intl.formatMessage({
                    id: 'CardTerminal.board-drafts-note',
                    defaultMessage: 'The board’s drafts is the board’s own folder, where its agents keep what they write for its cards — briefs, drafts, notes. There is no code in it.',
                })}
            </div>

            <Show when={error()}>
                <div class='FolderChoices__error'>{error()}</div>
            </Show>
        </div>
    )
}

export default FolderChoices
