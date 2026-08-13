// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onMount} from 'solid-js'

import {Board} from '../../blocks/board'
import {useIntl} from '../../intl'

import Dialog from '../dialog'

import {agentBindings} from './bindings'
import WorkdirsPanel from './workdirsPanel'

import './workdirsDialog.scss'

// Where this board's agents work, on its own screen — reached from the board's
// ⋯ menu rather than folded into «Как работает эта доска…».
//
// It was a fold of that dialog, under the canvas, and that was wrong twice
// over: setting up where an agent works is not a question about columns and
// routes, and a fold under a canvas is a place nobody opens. Which of these
// screens a board is offered follows what it asks for (its setup plan), so a
// board of shopping lists is never offered a deploy host or a repository.

// The two answers a repository can be worked in, and the whole reason this
// dialog is not just a list of paths.
const MODES = ['worktree', 'branch']

type Props = {
    board: Board
    onClose: () => void
}

const WorkdirsDialog = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [gitMode, setGitMode] = createSignal('worktree')
    const [error, setError] = createSignal('')

    onMount(async () => {
        if (!bindings?.GetBoardGit) {
            return
        }
        try {
            setGitMode((JSON.parse(await bindings.GetBoardGit(props.board.id)) || {}).mode || 'worktree')
        } catch (e) {
            setError(String(e))
        }
    })

    // Saved on the click rather than with a button of its own: it is one of two
    // answers, and «сохранить» beside a pair of chips is a step for nothing.
    const saveGitMode = async (mode: string) => {
        setGitMode(mode)
        if (!bindings?.SetBoardGit) {
            return
        }
        try {
            await bindings.SetBoardGit(props.board.id, JSON.stringify({mode}))
        } catch (e) {
            setError(String(e))
        }
    }

    return (
        <Dialog
            class='WorkdirsDialog'
            title={<span>{intl.formatMessage({id: 'Workdirs.title', defaultMessage: 'Folders'})}</span>}
            onClose={props.onClose}
        >
            <div class='WorkdirsDialog__content'>
                {/* First, because it decides what everything under it means:
                    the same list of folders is a copy per card or a branch in
                    the folder itself depending on this answer. */}
                <div class='WorkdirsDialog__gitMode'>
                    <span class='WorkdirsDialog__gitModeLabel'>
                        {intl.formatMessage({id: 'Automation.git-mode', defaultMessage: 'In a repository an agent works'})}
                    </span>
                    <div class='WorkdirsDialog__gitModeChoices'>
                        <For each={MODES}>
                            {(mode) => (
                                <button
                                    type='button'
                                    class={`WorkdirsDialog__gitModeChip ${gitMode() === mode ? 'WorkdirsDialog__gitModeChip--on' : ''}`}
                                    onClick={() => saveGitMode(mode)}
                                >
                                    <span class='WorkdirsDialog__gitModeName'>
                                        {mode === 'worktree' ?
                                            intl.formatMessage({id: 'Automation.git-worktree', defaultMessage: 'in a copy of its own'}) :
                                            intl.formatMessage({id: 'Automation.git-branch', defaultMessage: 'in the folder itself'})}
                                    </span>
                                    <span class='WorkdirsDialog__gitModeWhy'>
                                        {mode === 'worktree' ?
                                            intl.formatMessage({id: 'Automation.git-worktree-why', defaultMessage: 'a branch and a checkout per card — several cards of one repository at once, and your own checkout is left alone'}) :
                                            intl.formatMessage({id: 'Automation.git-branch-why', defaultMessage: 'a branch in the folder itself — one card at a time, and you see the work in your editor as it happens'})}
                                    </span>
                                </button>
                            )}
                        </For>
                    </div>
                </div>

                <WorkdirsPanel board={props.board}/>

                <Show when={error()}>
                    <div class='WorkdirsDialog__error'>{error()}</div>
                </Show>
            </div>
        </Dialog>
    )
}

export default WorkdirsDialog
